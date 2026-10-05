import { Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { changedMermaidBlocks, mermaidBlocks } from '../src/diagrams/markdown';
import {
  diagramManifestSchema,
  diagramResultHash,
  diagramRevisions,
  type DiagramManifest,
} from '../src/diagrams/model';
import { deliverDiagrams, diagramSection } from '../scripts/diagram-delivery';
import { inlineText, summarize } from '../scripts/github-action';
import { compareCaptures } from '../src/comparison';
import { json, sha256 } from '../src/encoding';
import { comparisonSchema } from '../src/comparison-model';

const fixture = (side: string) =>
  readFile(
    path.join(import.meta.dirname, `fixtures/diagrams/${side}.md`),
    'utf8',
  );

test('pairs changed fences by heading and order without showing unchanged diagrams', async () => {
  const base = await fixture('base');
  const candidate = await fixture('candidate');
  const pairs = changedMermaidBlocks(base, candidate);
  expect(pairs.map(({ heading, change }) => [heading, change])).toEqual([
    ['Changed', 'changed'],
    ['Removed', 'removed'],
    ['Parse error', 'changed'],
    ['Old heading', 'removed'],
    ['Renamed and moved heading', 'added'],
    ['Added', 'added'],
  ]);
  expect(changedMermaidBlocks(base, `${base}\nProse only.`)).toEqual([]);
  expect(
    changedMermaidBlocks(
      '## One\n```mermaid\nA\n```\n## Two\n```mermaid\nB\n```',
      '## Two\n```mermaid\nB\n```\n## One\n```mermaid\nA\n```',
    ),
  ).toEqual([]);
});

test('ignores example fences and keeps order below ATX and setext headings', () => {
  expect(
    mermaidBlocks(
      '````md\n# Ignored\n```mermaid\nno\n```\n````\nReal\n====\n~~~mermaid\nA\n~~~\n```mermaid\nB\n```',
    ),
  ).toEqual([
    { heading: 'Real', order: 1, source: 'A' },
    { heading: 'Real', order: 2, source: 'B' },
  ]);
});

test('finds nested fences but ignores HTML comments and indented code examples', () => {
  expect(
    mermaidBlocks(
      '<!--\n```mermaid\nhidden\n```\n-->\n\n    ```mermaid\n    example\n    ```\n\n> ## Quoted\n> ```mermaid\n> A\n> ```\n\n- item\n\n  ```mermaid\n  B\n  ```',
    ),
  ).toEqual([
    { heading: 'Quoted', order: 1, source: 'A' },
    { heading: 'Quoted', order: 2, source: 'B' },
  ]);
});

const baseCommit = '9122c511113761f2bb7664d971b372b7010d25aa';
const candidateCommit = '99ee1c6aac63b54ff358cd3f9dd7145825cedf4c';

async function comparisonResult() {
  const fixture = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(
    await readFile(
      path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
      'utf8',
    ),
  );
  const journey = fixture.journeys[0];
  if (journey === undefined) {
    throw new Error('Expected a fixture journey');
  }

  return compareCaptures({
    base: journey.base,
    candidate: journey.candidate,
    evaluatedAt: fixture.evaluatedAt,
    visual: {
      kind: 'unavailable',
      reason: 'No screenshots in this fixture test',
    },
  });
}

test('diagram observations cannot change a verdict or turn unknown, incomplete or not-run input into a pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observed-diagram-test-'));
  const result = await comparisonResult();
  const before = json(result);
  const complete: DiagramManifest['observation'] = {
    kind: 'complete',
    baseCommit,
    candidateCommit,
    producer: { name: 'mermaid', version: '12.1.0' },
    conditions: null,
    pairs: [
      {
        file: 'docs/flow.md',
        heading: 'Flow',
        order: 1,
        change: 'added',
        base: { kind: 'absent' },
        candidate: { kind: 'unavailable', reason: 'Parse error' },
      },
    ],
  };
  try {
    for (const observation of [
      { kind: 'unknown' },
      { kind: 'complete' },
      { kind: 'not-run', reason: 'Candidate is a worktree.' },
      complete,
    ]) {
      await writeFile(
        path.join(root, 'diagrams.json'),
        json({
          schemaVersion: 1,
          resultHash: diagramResultHash(result),
          observation,
        }),
      );
      const diagrams = await deliverDiagrams({
        directory: root,
        result,
        publish: null,
        skipReason: 'No publication',
      });
      const section = diagramSection(diagrams, inlineText);
      expect(section).toContain('Observation');
      expect(section).not.toMatch(/\b(pass(?:ed)?|none)\b/i);
      const summary = summarize({
        output: json({ directory: root, result }),
        exitCode: 2,
        artifact: 'observed',
        page: null,
        surface: { kind: 'comment' },
        diagrams,
      });
      expect(summary.kind).toBe('regression');
      expect(summary.markdown).toContain(section);
      expect(json(result)).toBe(before);
    }

    expect(
      diagramSection(
        {
          observation: { ...complete, pairs: [] },
          images: new Map(),
          notes: new Map(),
        },
        inlineText,
      ),
    ).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('delivery rejects stale manifests and changed image bytes before publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observed-diagram-test-'));
  const result = await comparisonResult();
  const observation: DiagramManifest['observation'] = {
    kind: 'complete',
    baseCommit,
    candidateCommit,
    producer: { name: 'mermaid', version: '12.1.0' },
    conditions: null,
    pairs: [
      {
        file: 'a.md',
        heading: 'x | @here',
        order: 1,
        change: 'added',
        base: { kind: 'absent' },
        candidate: {
          kind: 'rendered',
          conditions: {
            configuration: { theme: 'default' },
            configurationHash: sha256(json({ theme: 'default' })),
            theme: 'default',
            fontFamily: 'sans-serif',
          },
          svg: { path: 'diagrams/0-candidate.svg', sha256: sha256('svg') },
          png: { path: 'diagrams/0-candidate.png', sha256: sha256('expected') },
        },
      },
    ],
  };
  const publish = () => {
    throw new Error('Must not publish unverified bytes');
  };

  try {
    await mkdir(path.join(root, 'diagrams'));
    await writeFile(path.join(root, 'diagrams/0-candidate.png'), 'tampered');
    await writeFile(
      path.join(root, 'diagrams.json'),
      json({
        schemaVersion: 1,
        resultHash: diagramResultHash(result),
        observation,
      }),
    );
    const read = await deliverDiagrams({
      directory: root,
      result,
      publish,
      skipReason: '',
    });
    expect(diagramSection(read, inlineText)).toContain('Unavailable:');
    expect(read?.images.size).toBe(0);
    await writeFile(
      path.join(root, 'diagrams.json'),
      json({ schemaVersion: 1, resultHash: sha256('old'), observation }),
    );
    expect(
      (
        await deliverDiagrams({
          directory: root,
          result,
          publish,
          skipReason: '',
        })
      )?.observation.kind,
    ).toBe('unavailable');
    const decodeWithSvgPath = (svgPath: string) =>
      Schema.decodeUnknownSync(diagramManifestSchema)({
        schemaVersion: 1,
        resultHash: sha256(''),
        observation: {
          ...observation,
          pairs: [
            {
              ...observation.pairs[0],
              candidate: {
                kind: 'rendered',
                conditions: {
                  configuration: { theme: 'default' },
                  configurationHash: sha256(json({ theme: 'default' })),
                  theme: 'default',
                  fontFamily: 'sans-serif',
                },
                svg: { path: svgPath, sha256: sha256('') },
                png: { path: 'diagrams/0-candidate.png', sha256: sha256('') },
              },
            },
          ],
        },
      });
    expect(() => decodeWithSvgPath('../secret')).toThrow();
    expect(() => decodeWithSvgPath('diagrams/0-candidate.svg')).not.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('diagram delivery accepts the saved comparison after the action decodes it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observed-diagram-test-'));
  const result = await comparisonResult();
  const decoded = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(json(result));
  const observation: DiagramManifest['observation'] = {
    kind: 'complete',
    baseCommit,
    candidateCommit,
    producer: { name: 'mermaid', version: '12.1.0' },
    conditions: null,
    pairs: [],
  };
  try {
    await writeFile(
      path.join(root, 'diagrams.json'),
      json({
        schemaVersion: 1,
        resultHash: diagramResultHash(result),
        observation,
      }),
    );
    const delivery = await deliverDiagrams({
      directory: root,
      result: decoded,
      publish: null,
      skipReason: 'No publication',
    });
    expect(delivery?.observation.kind).toBe('complete');
    expect(diagramSection(delivery, inlineText)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deeply nested Markdown does not abort diagram observation', () => {
  const quote = '> '.repeat(12_000);
  const source = ['```mermaid', 'flowchart LR', '  A --> B', '```']
    .map((line) => quote + line)
    .join('\n');
  expect(mermaidBlocks(source)).toEqual([
    { heading: '', order: 1, source: 'flowchart LR\n  A --> B' },
  ]);
});

test('a URL in a parse error cannot create a table cell', () => {
  const section = diagramSection(
    {
      observation: {
        kind: 'complete',
        baseCommit,
        candidateCommit,
        producer: { name: 'mermaid', version: '12.1.0' },
        conditions: null,
        pairs: [
          {
            file: 'README.md',
            heading: 'Flow',
            order: 1,
            change: 'added',
            base: { kind: 'absent' },
            candidate: {
              kind: 'unavailable',
              reason: 'Parse error: https://example.test/a|b',
            },
          },
        ],
      },
      images: new Map(),
      notes: new Map(),
    },
    inlineText,
  );
  expect(section).toContain('a\\|b');
});

test('diagram revisions come from captured commits and stale revision pairs cannot be delivered', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observed-diagram-test-'));
  const result = await comparisonResult();
  expect(diagramRevisions(result)).toEqual({
    kind: 'commits',
    baseCommit,
    candidateCommit,
  });
  try {
    await writeFile(
      path.join(root, 'diagrams.json'),
      json({
        schemaVersion: 1,
        resultHash: diagramResultHash(result),
        observation: {
          kind: 'complete',
          baseCommit,
          candidateCommit: 'c'.repeat(40),
          producer: { name: 'mermaid', version: '12.1.0' },
          conditions: null,
          pairs: [],
        },
      }),
    );
    const delivery = await deliverDiagrams({
      directory: root,
      result,
      publish: null,
      skipReason: 'No publication',
    });
    expect(delivery?.observation.kind).toBe('unavailable');
    expect(diagramSection(delivery, inlineText)).toContain(
      'commits do not match',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
