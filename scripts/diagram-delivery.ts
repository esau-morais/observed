import { Effect, Schema } from 'effect';
import type { Comparison } from '../src/comparison-model';
import {
  diagramManifestSchema,
  diagramResultHash,
  diagramRevisions,
  type DiagramManifest,
  type DiagramSide,
} from '../src/diagrams/model';
import { readVerifiedArtifact } from '../src/evidence';

export type DiagramDelivery = {
  observation: DiagramManifest['observation'];
  images: ReadonlyMap<string, string>;
  notes: ReadonlyMap<string, string>;
};

export async function deliverDiagrams(options: {
  directory: string;
  result: Comparison;
  publish: ((file: string, bytes: Uint8Array) => Promise<string>) | null;
  skipReason: string;
}): Promise<DiagramDelivery | null> {
  if (options.result.mode === 'preview') {
    return null;
  }

  const images = new Map<string, string>();
  const notes = new Map<string, string>();
  const unavailable = (reason: string): DiagramDelivery => ({
    observation: { kind: 'unavailable', reason },
    images,
    notes,
  });
  const read = await Effect.runPromise(
    readVerifiedArtifact(options.directory, {
      id: 'diagrams',
      path: 'diagrams.json',
      description: 'Diagram observations',
    }),
  );
  if (read.kind === 'unavailable') {
    return unavailable(read.reason);
  }

  const decoded = Schema.decodeUnknownExit(
    Schema.fromJsonString(diagramManifestSchema),
  )(new TextDecoder().decode(read.bytes));
  if (decoded._tag === 'Failure') {
    return unavailable('The diagram manifest is incomplete or unsupported.');
  }

  const manifest = decoded.value;
  if (manifest.resultHash !== diagramResultHash(options.result)) {
    return unavailable(
      'The diagram observations do not belong to this result.',
    );
  }

  if (manifest.observation.kind === 'complete') {
    const revisions = diagramRevisions(options.result);
    if (
      revisions.kind !== 'commits' ||
      revisions.baseCommit !== manifest.observation.baseCommit ||
      revisions.candidateCommit !== manifest.observation.candidateCommit
    ) {
      return unavailable(
        'The diagram commits do not match the captured revisions.',
      );
    }

    for (const pair of manifest.observation.pairs) {
      for (const side of [pair.base, pair.candidate]) {
        if (side.kind !== 'rendered') {
          continue;
        }

        const image = await Effect.runPromise(
          readVerifiedArtifact(options.directory, {
            id: 'diagram-png',
            description: 'Rendered diagram',
            ...side.png,
          }),
        );
        if (image.kind === 'unavailable') {
          notes.set(side.png.path, `Unavailable: ${image.reason}`);
        } else if (options.publish === null) {
          notes.set(side.png.path, options.skipReason);
        } else {
          try {
            images.set(
              side.png.path,
              await options.publish(side.png.path, image.bytes),
            );
          } catch {
            notes.set(
              side.png.path,
              'Rendered diagram in the evidence bundle; image publication was unavailable.',
            );
          }
        }
      }
    }
  }

  return { observation: manifest.observation, images, notes };
}

export function diagramSection(
  delivery: DiagramDelivery | null | undefined,
  escape: (text: string) => string,
): string | null {
  if (delivery === null || delivery === undefined) {
    return null;
  }

  const { observation, images, notes } = delivery;
  if (observation.kind !== 'complete') {
    return `Observation · Diagrams ${observation.kind === 'not-run' ? 'not run' : 'unavailable'}: ${escape(observation.reason)}`;
  }

  const escapeCell = (text: string) =>
    escape(text).replace(/(\\*)\|/g, (match: string, slashes: string) =>
      slashes.length % 2 === 0 ? `\\${match}` : match,
    );
  const sideText = (side: DiagramSide, label: string) => {
    if (side.kind === 'absent') {
      return `Absent · ${label === 'Base' ? 'added' : 'removed'}`;
    }

    if (side.kind === 'unavailable') {
      return `Unavailable: ${escapeCell(side.reason)}`;
    }

    const url = images.get(side.png.path);

    return url !== undefined && /^https:\/\/[^\s<>()[\]]+$/.test(url)
      ? `![${label} diagram observation](${url})`
      : escapeCell(
          notes.get(side.png.path) ??
            'Rendered diagram in the evidence bundle; inline image unavailable.',
        );
  };

  return observation.pairs.length === 0
    ? null
    : observation.pairs
        .map((pair) =>
          [
            `**Observation · ${escape(pair.file)} · ${escape(pair.heading === '' ? 'Untitled' : pair.heading)} · diagram ${pair.order} · ${pair.change}**`,
            `| Base ${observation.baseCommit.slice(0, 8)} | Candidate ${observation.candidateCommit.slice(0, 8)} |`,
            '| --- | --- |',
            `| ${sideText(pair.base, 'Base')} | ${sideText(pair.candidate, 'Candidate')} |`,
          ].join('\n'),
        )
        .join('\n\n');
}
