import { Effect, Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { changedMermaidBlocks, mermaidBlocks } from '../src/diagrams/markdown';
import {
  diagramManifestSchema,
  type DiagramManifest,
} from '../src/diagrams/model';
import { deliverDiagrams, diagramSection } from '../scripts/diagram-delivery';
import { inlineText, summarize } from '../scripts/github-action';
import { compareCaptures, inspectSide } from '../src/comparison';
import { json, sha256 } from '../src/encoding';

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

async function unavailableResult() {
  const evaluatedAt = '2026-10-05T12:00:00.000Z';
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );

  return compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
  });
}

test('diagram observations cannot change a verdict or turn unknown, incomplete or not-run input into a pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observed-diagram-test-'));
  const result = await unavailableResult();
  const before = json(result);
  const complete: DiagramManifest['observation'] = {
    kind: 'complete',
    baseCommit: 'a'.repeat(40),
    candidateCommit: 'b'.repeat(40),
    producer: { name: 'mermaid', version: '12.1.0' },
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
        json({ schemaVersion: 1, resultHash: sha256(before), observation }),
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
        exitCode: 1,
        artifact: 'observed',
        page: null,
        surface: { kind: 'comment' },
        diagrams,
      });
      expect(summary.kind).toBe('unavailable');
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
  const result = await unavailableResult();
  const observation: DiagramManifest['observation'] = {
    kind: 'complete',
    baseCommit: 'a'.repeat(40),
    candidateCommit: 'b'.repeat(40),
    producer: { name: 'mermaid', version: '12.1.0' },
    pairs: [
      {
        file: 'a.md',
        heading: 'x | @here',
        order: 1,
        change: 'added',
        base: { kind: 'absent' },
        candidate: {
          kind: 'rendered',
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
      json({ schemaVersion: 1, resultHash: sha256(json(result)), observation }),
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
    expect(() =>
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
                svg: { path: '../secret', sha256: sha256('') },
                png: { path: 'diagrams/0-candidate.png', sha256: sha256('') },
              },
            },
          ],
        },
      }),
    ).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
