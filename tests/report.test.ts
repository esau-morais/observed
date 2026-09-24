import { Cause, DateTime, Effect, Exit } from 'effect';
import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { inspectEvidence as inspect } from '../src/evidence';
import { nodeIo } from '../src/node-io';
import { renderReport } from '../src/report';
import { parseManifest } from '../src/schema';
import fixtureManifest from './fixtures/todomvc/manifest.json' with { type: 'json' };

const fixture = path.join(import.meta.dirname, 'fixtures/todomvc');
const directories: string[] = [];
const execute = promisify(execFile);

async function bundle() {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-test-'));
  directories.push(directory);
  await cp(fixture, directory, { recursive: true });
  const input = structuredClone(fixtureManifest);
  const manifest = {
    ...input,
    checks: input.checks.map((check) => ({
      ...check,
      artifactIds: [...check.artifactIds],
      missingPrerequisites: [...check.missingPrerequisites],
    })),
  };

  return { directory, manifest };
}

async function inspectEvidence(input: unknown, directory: string) {
  const manifest = await Effect.runPromise(parseManifest(input));
  return Effect.runPromise(inspect(manifest, directory));
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('unexpected I/O exceptions remain defects instead of unavailable evidence', async () => {
  const exit = await Effect.runPromiseExit(
    nodeIo(() => Promise.reject(new TypeError('programming error'))),
  );

  expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
});

test('rejects malformed, ambiguous, and dangling manifests instead of accepting a partial contract', async () => {
  const { manifest } = await bundle();
  const invalidInputs: unknown[] = [
    null,
    {},
    { ...manifest, schemaVersion: 2 },
    { ...manifest, unexpected: 'ignored?' },
    { ...manifest, checks: [] },
    { ...manifest, artifacts: [...manifest.artifacts, ...manifest.artifacts] },
    { ...manifest, checks: [...manifest.checks, ...manifest.checks] },
    { ...manifest, recipe: { ...manifest.recipe, artifactId: 'missing' } },
    { ...manifest, capture: { ...manifest.capture, artifactIds: ['missing'] } },
    {
      ...manifest,
      checks: manifest.checks.map((check) => ({
        ...check,
        artifactIds: ['missing'],
      })),
    },
    {
      ...manifest,
      capture: {
        ...manifest.capture,
        startedAt: { kind: 'known', value: 'yesterday' },
      },
    },
    {
      ...manifest,
      capture: {
        ...manifest.capture,
        finishedAt: { kind: 'known', value: '2020-01-01T00:00:00Z' },
      },
    },
    {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) => ({
        ...artifact,
        sha256: 'invalid',
      })),
    },
  ];

  for (const input of invalidInputs) {
    await expect(Effect.runPromise(parseManifest(input))).rejects.toThrow();
  }
});

test('rejects calendar rollover and accepts valid UTC timestamps without losing precision', async () => {
  const captureAt = (value: string) => ({
    ...fixtureManifest,
    capture: {
      ...fixtureManifest.capture,
      startedAt: { kind: 'known', value },
      finishedAt: { kind: 'known', value },
    },
  });

  for (const value of [
    '2026-02-30T00:00:00Z',
    '2026-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-09-24T24:00:00Z',
    '2026-09-24T00:00:60Z',
    '2026-09-24T00:00:00.1234Z',
    '2026-09-24T00:00:00+01:00',
    '2026-09-24T00:00:00',
  ]) {
    await expect(
      Effect.runPromise(parseManifest(captureAt(value))),
    ).rejects.toThrow();
  }

  for (const [input, expected] of [
    ['2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000Z'],
    ['2026-09-24T00:00:00.1Z', '2026-09-24T00:00:00.100Z'],
    ['2026-09-24T00:00:00.12Z', '2026-09-24T00:00:00.120Z'],
    ['2026-09-24T00:00:00.123Z', '2026-09-24T00:00:00.123Z'],
  ] as const) {
    const { capture } = await Effect.runPromise(
      parseManifest(captureAt(input)),
    );
    expect(
      capture.startedAt.kind === 'known' &&
        DateTime.formatIso(capture.startedAt.value),
    ).toBe(expected);
  }
});

test('retains real supplied results without converting imported PASS text into independent verification', async () => {
  const { directory, manifest } = await bundle();
  const report = await inspectEvidence(manifest, directory);
  const markdown = renderReport(report, directory);

  expect(report.checks.map((result) => result.outcome)).toEqual([
    'imported passed',
    'unknown',
  ]);
  expect(
    report.artifacts.map(
      (result) => result.kind === 'available' && result.integrity,
    ),
  ).toEqual(['matched', 'matched']);
  expect(markdown).toContain(
    '1 imported passed; 0 imported failed; 1 unknown checks.',
  );
  expect(markdown).toContain(
    'Behavior was not independently verified by Observed.',
  );
  expect(markdown).toContain('Base: Unknown: No baseline captured');
  expect(markdown).toContain(
    'Scope: One disposable todo in one browser session',
  );
  expect(markdown).toContain('[reload](./reload.log)');
  expect(markdown).toContain('Supplied result: passed');
});

test.each([
  'missing',
  'mismatch',
  'directory',
  'no evidence',
  'prerequisite',
  'failed capture',
  'blocked capture',
  'unknown capture',
  'missing recipe',
])('%s cannot support an imported passing claim', async (failure) => {
  const { directory, manifest } = await bundle();

  if (failure === 'missing') {
    await rm(path.join(directory, 'reload.log'));
  } else if (failure === 'mismatch') {
    await writeFile(path.join(directory, 'reload.log'), 'PASS invented\n');
  } else if (failure === 'directory') {
    await rm(path.join(directory, 'reload.log'));
    await mkdir(path.join(directory, 'reload.log'));
  } else if (failure === 'no evidence') {
    manifest.checks = manifest.checks.map((check) => ({
      ...check,
      artifactIds: [],
    }));
  } else if (failure === 'prerequisite') {
    manifest.checks = manifest.checks.map((check) => ({
      ...check,
      missingPrerequisites: ['Missing auth'],
    }));
  } else if (failure === 'failed capture') {
    manifest.capture.execution = 'failed';
  } else if (failure === 'blocked capture') {
    manifest.capture.execution = 'blocked';
  } else if (failure === 'unknown capture') {
    manifest.capture.execution = 'unknown';
  } else {
    await rm(path.join(directory, 'recipe.txt'));
  }

  const report = await inspectEvidence(manifest, directory);
  expect(report.checks.map((result) => result.outcome)).toEqual([
    'unknown',
    'unknown',
  ]);
  const markdown = renderReport(report, directory);
  expect(markdown).toContain(
    '0 imported passed; 0 imported failed; 2 unknown checks.',
  );
  expect(markdown).toContain('Supplied result: passed');
});

test.each([
  '../outside.log',
  '/etc/passwd',
  'C:/outside.log',
  'file:///etc/passwd',
  'folder/../../outside.log',
  'folder\\outside.log',
  './reload.log',
  'folder//reload.log',
  'nul\u0000.log',
])(
  'rejects unsafe reference %s and never emits a link for it',
  async (unsafePath) => {
    const { directory, manifest } = await bundle();
    manifest.artifacts = manifest.artifacts.map((artifact) => ({
      ...artifact,
      path: unsafePath,
    }));
    const report = await inspectEvidence(manifest, directory);

    expect(
      report.artifacts.every((result) => result.kind === 'unavailable'),
    ).toBe(true);
    expect(report.checks.every((result) => result.outcome === 'unknown')).toBe(
      true,
    );
    expect(renderReport(report, directory)).not.toMatch(/\]\(/);
  },
);

test.each(['file', 'directory'])(
  'rejects %s symlinks even when their target exists',
  async (kind) => {
    const { directory, manifest } = await bundle();
    const outside = await mkdtemp(path.join(tmpdir(), 'observed-outside-'));
    directories.push(outside);
    await cp(fixture, outside, { recursive: true });
    await symlink(
      kind === 'file' ? path.join(outside, 'reload.log') : outside,
      path.join(directory, 'link'),
    );
    manifest.artifacts = manifest.artifacts.map((artifact) =>
      artifact.id === 'reload'
        ? { ...artifact, path: kind === 'file' ? 'link' : 'link/reload.log' }
        : artifact,
    );
    const report = await inspectEvidence(manifest, directory);

    expect(report.checks.every((result) => result.outcome === 'unknown')).toBe(
      true,
    );
    expect(renderReport(report, directory)).toContain(
      'Symlink artifacts and symlink directories are not allowed',
    );
  },
);

test('missing supplied hashes remain unverified and failed supplied results stay failed', async () => {
  const { directory, manifest } = await bundle();

  manifest.checks = manifest.checks
    .filter((check) => check.id === 'reload')
    .map((check) => ({
      ...check,
      result: { kind: 'failed', detail: 'Imported failure for contract test' },
    }));
  const markdown = renderReport(
    await inspectEvidence(
      {
        ...manifest,
        artifacts: manifest.artifacts.map(({ id, path, description }) => ({
          id,
          path,
          description,
        })),
      },
      directory,
    ),
    directory,
  );

  expect(markdown).toContain(
    '0 imported passed; 1 imported failed; 0 unknown checks.',
  );
  expect(markdown).toContain('computed; no supplied hash to verify');
  expect(markdown).not.toContain('matched supplied hash');
});

test('escapes supplied markup and encodes evidence paths relative to the actual output directory', async () => {
  const { directory, manifest } = await bundle();
  manifest.title =
    '<img src=x onerror=alert(1)> [claim](https://untrusted.test)\n# forged';
  const name = 'space # [x](1).log';
  await cp(path.join(directory, 'reload.log'), path.join(directory, name));
  manifest.artifacts = manifest.artifacts.map((artifact) =>
    artifact.id === 'reload' ? { ...artifact, path: name } : artifact,
  );
  const markdown = renderReport(
    await inspectEvidence(manifest, directory),
    path.join(directory, 'reports'),
  );

  expect(markdown).not.toContain('<img');
  expect(markdown).not.toContain('\n# forged');
  expect(markdown).not.toContain('[claim](');
  expect(markdown).toContain('[reload](./../space%20%23%20%5Bx%5D%281%29.log)');
});

test('CLI writes deterministic reports, fails malformed JSON, and refuses to overwrite evidence', async () => {
  const { directory } = await bundle();
  const cli = path.resolve('src/cli.ts');
  const manifestPath = path.join(directory, 'manifest.json');
  const first = path.join(directory, 'first.md');
  const second = path.join(directory, 'second.md');

  await execute('bun', [cli, manifestPath, first]);
  await execute('bun', [cli, manifestPath, second]);
  expect(await readFile(first, 'utf8')).toBe(await readFile(second, 'utf8'));

  const original = await readFile(manifestPath, 'utf8');
  const collision = execute('bun', [cli, manifestPath, manifestPath]);
  await expect(collision).rejects.toMatchObject({ code: 1, stdout: '' });
  await expect(collision).rejects.toHaveProperty(
    'stderr',
    expect.stringContaining('EEXIST'),
  );
  expect(await readFile(manifestPath, 'utf8')).toBe(original);

  await writeFile(manifestPath, '{ broken');
  const invalid = execute('bun', [
    cli,
    manifestPath,
    path.join(directory, 'invalid.md'),
  ]);
  await expect(invalid).rejects.toMatchObject({ code: 1, stdout: '' });
  await expect(invalid).rejects.toHaveProperty(
    'stderr',
    expect.stringContaining('SchemaError'),
  );
  await expect(
    readFile(path.join(directory, 'invalid.md')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
