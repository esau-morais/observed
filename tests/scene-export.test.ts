import { Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { deliveredScene, summarize } from '../scripts/github-action';
import { comparisonSchema, type Comparison } from '../src/comparison-model';
import { exportFrames, exportedScene } from '../src/viewer/scene-model';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function errorsResult(): Promise<Comparison> {
  return Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(
    await readFile(
      path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
      'utf8',
    ),
  );
}

const image = 'https://github.com/o/r/raw/c/observed-bundle-scene.gif';

function comment(result: Comparison) {
  return summarize({
    output: JSON.stringify({ directory: '/tmp/run', result }),
    exitCode: 2,
    artifact: 'observed-bundle',
    page: 'https://github.com/o/r/actions/runs/1/artifacts/2',
    repository: 'https://github.com/o/r',
    scene: { image, note: null },
    surface: { kind: 'comment' },
  }).markdown;
}

// Fails if the comment shows a scene for a run with no failed check, or puts
// it below the text it is meant to replace.
test('the comment shows the scene only for a failed check, above the check rows', async () => {
  const result = await errorsResult();
  const failingComment = comment(result);
  const at = failingComment.indexOf(`](${image})`);

  expect(at).toBeGreaterThan(-1);
  expect(failingComment).toContain(
    "![Scene drawn from this run's evidence, after Kit Langton's PR explainers. No browser errors: regression.",
  );
  expect(at).toBeLessThan(failingComment.indexOf('Open the report'));

  const passing = Schema.decodeUnknownSync(comparisonSchema)({
    ...result,
    journeys: result.journeys.map((journey) => ({
      ...journey,
      checks: journey.checks.map((check) => ({ ...check, verdict: 'passed' })),
    })),
  });

  expect(exportedScene(passing)).toBeNull();
  expect(comment(passing)).not.toContain(image);
});

// Fails if a fork's pixels are stored in the repository.
test('a scene from a fork is never stored', async () => {
  const fetch = vi.fn();

  vi.stubGlobal('fetch', fetch);

  expect(
    await deliveredScene({
      trusted: true,
      commenting: true,
      fork: true,
      path: '/tmp/observed-bundle-scene.gif',
      target: {
        api: 'https://api.github.com',
        repository: 'o/r',
        token: 't',
        pullRequest: 1,
        botLogin: 'github-actions[bot]',
      },
      server: 'https://github.com',
      ref: 'refs/observed/crops/2026-10-05/1-1-observed-bundle-scene',
      cutoff: '2026-09-28',
      userToken: 'gho_user',
      repositoryId: '42',
    }),
  ).toEqual({
    image: null,
    note: 'The comment has no scene: Observed stores no images from pull requests from forks.',
    expected: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

// Fails if a failing run whose screenshots did not change, so it stores no
// crops, leaves expired image refs behind.
test('a stored scene prunes image refs older than the retention', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-scene-'));
  const file = path.join(directory, 'observed-bundle-scene.gif');
  const sha = (letter: string) => letter.repeat(40);
  const calls: string[] = [];

  await writeFile(file, new Uint8Array([0x47, 0x49, 0x46]));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const route = `${init.method ?? 'GET'} ${url.replace('https://api.github.com/repos/o/r/git', '')}`;
      const answers: Record<string, Response> = {
        'POST /blobs': Response.json({ sha: sha('a') }, { status: 201 }),
        'POST /trees': Response.json({ sha: sha('b') }, { status: 201 }),
        'POST /commits': Response.json({ sha: sha('c') }, { status: 201 }),
        'POST /refs': Response.json({}, { status: 201 }),
        'GET /matching-refs/observed/crops/': Response.json([
          { ref: 'refs/observed/crops/2026-09-20/1-1-observed-bundle-scene' },
          { ref: 'refs/observed/crops/2026-10-05/9-1-observed-bundle-scene' },
        ]),
      };

      calls.push(route);

      return Promise.resolve(
        answers[route] ?? new Response(null, { status: 204 }),
      );
    }),
  );

  expect(
    await deliveredScene({
      trusted: true,
      commenting: true,
      fork: false,
      path: file,
      target: {
        api: 'https://api.github.com',
        repository: 'o/r',
        token: 't',
        pullRequest: 1,
        botLogin: 'github-actions[bot]',
      },
      server: 'https://github.com',
      ref: 'refs/observed/crops/2026-10-05/9-1-observed-bundle-scene',
      cutoff: '2026-09-28',
      userToken: '',
      repositoryId: '42',
    }),
  ).toEqual({
    image: `https://github.com/o/r/raw/${sha('c')}/observed-bundle-scene.gif`,
    note: null,
  });
  expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([
    'DELETE /refs/observed/crops/2026-09-20/1-1-observed-bundle-scene',
  ]);

  await rm(directory, { recursive: true, force: true });
});

// Fails if a workflow that kept contents: read gets a raw API error, or a
// warning for a choice it made, instead of the permission that shows the scene.
test('a read-only token leaves a note naming contents: write', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-scene-'));
  const file = path.join(directory, 'observed-bundle-scene.gif');

  await writeFile(file, new Uint8Array([0x47, 0x49, 0x46]));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
  );

  expect(
    await deliveredScene({
      trusted: true,
      commenting: true,
      fork: false,
      path: file,
      target: {
        api: 'https://api.github.com',
        repository: 'o/r',
        token: 't',
        pullRequest: 1,
        botLogin: 'github-actions[bot]',
      },
      server: 'https://github.com',
      ref: 'refs/observed/crops/2026-10-05/9-1-observed-bundle-scene',
      cutoff: null,
      userToken: '',
      repositoryId: '42',
    }),
  ).toEqual({
    image: null,
    note: "The comment has no scene because the workflow token cannot write to this repository. Add contents: write to the workflow's permissions to show it.",
    expected: true,
  });

  await rm(directory, { recursive: true, force: true });
});

// Fails if the export drops a beat, reorders frames, or shortens a beat's
// time on screen.
test('the export plan keeps every beat in order for its full hold', async () => {
  const exported = exportedScene(await errorsResult());

  if (exported === null) {
    throw new Error('The fixture has a failed check');
  }

  const frames = exportFrames(exported.scene);

  expect([...new Set(frames.map((frame) => frame.beat))]).toEqual(
    exported.scene.beats.map((_, index) => index),
  );
  expect(
    exported.scene.beats.map((_, index) =>
      frames
        .filter((frame) => frame.beat === index)
        .reduce((sum, frame) => sum + frame.delay, 0),
    ),
  ).toEqual(exported.scene.beats.map((beat) => beat.hold));
});
