import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
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
    scene: image,
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
      userToken: 'gho_user',
      repositoryId: '42',
    }),
  ).toEqual({
    image: null,
    note: 'The comment has no scene: Observed stores no images from pull requests from forks.',
  });
  expect(fetch).not.toHaveBeenCalled();
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
