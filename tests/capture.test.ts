import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { captureApplication } from '../src/capture/coordinator';
import { captureSchema } from '../src/capture/model';
import { loadProject } from '../src/project';

async function captureSetup(
  root: string,
  setup: readonly (readonly string[])[],
  timeoutMs?: number,
) {
  await writeFile(path.join(root, 'index.html'), '<h1>App</h1>\n');
  await writeFile(
    path.join(root, 'observed.json'),
    JSON.stringify({
      schemaVersion: 1,
      name: 'Setup failure',
      source: { entry: 'index.html', paths: ['index.html', 'fail.sh'] },
      setup,
      start: ['true'],
      ready: { path: '/', status: 200 },
      capture: { name: 'Home', path: '/', ready: [], steps: [] },
    }),
  );

  const directory = path.join(root, 'capture');

  await Effect.runPromise(
    Effect.gen(function* () {
      const { project, recipes } = yield* loadProject(root);
      const [recipe] = recipes;

      if (recipe === undefined) {
        return yield* Effect.die('The project has one journey');
      }

      return yield* captureApplication({
        projectRoot: root,
        toolRoot: path.resolve(import.meta.dirname, '..'),
        directory,
        project,
        recipe,
        revision: null,
        label: 'Candidate',
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  const capture = Schema.decodeUnknownSync(
    Schema.fromJsonString(captureSchema),
  )(await readFile(path.join(directory, 'capture.json'), 'utf8'));

  if (capture.execution.kind !== 'failed') {
    throw new Error('The setup step fails');
  }

  return capture.execution;
}

test('a failed setup step names the step and quotes its redacted stderr tail', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-setup-'));

  try {
    await writeFile(
      path.join(root, 'fail.sh'),
      'printf "\\033[31mfirst\\033[0m\\nfetch https://user:pw@example.com/x\\n\\nfixture is stale\\n" >&2\nexit 3\n',
    );

    const { category, reason } = await captureSetup(root, [
      ['true'],
      ['sh', 'fail.sh'],
      ['true'],
    ]);

    expect(category).toBe('application');
    expect(reason).toMatch(
      /^Setup step 2 of 3 \(sh\) exited with code 3: first · fetch https:\/\/\S+@example\.com\/x · fixture is stale$/,
    );
    expect(reason).not.toContain('pw');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a capture that times out during setup names the step', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-setup-'));

  try {
    await writeFile(path.join(root, 'fail.sh'), 'sleep 30\n');

    const { category, reason } = await captureSetup(
      root,
      [['true'], ['sh', 'fail.sh']],
      1_500,
    );

    expect(category).toBe('timeout');
    expect(reason).toBe(
      'Capture timed out during setup step 2 of 2 (sh); see failure.txt and transcript.jsonl',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
