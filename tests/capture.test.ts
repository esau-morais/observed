import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { agentBrowserFailure } from '../src/capture/agent-browser';
import { captureApplication } from '../src/capture/coordinator';
import { captureSchema } from '../src/capture/model';
import { ProcessFailure, processOutput } from '../src/capture/process';
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

const failure = (stdout: string, stderr = '') =>
  new ProcessFailure({
    command: process.execPath,
    exitCode: 1,
    message: 'unused',
    stdout,
    stderr,
  });

// agent-browser 0.38.1 stdout when Chrome cannot start its sandbox (Ubuntu 24.04).
const sandboxStdout = `${JSON.stringify({
  success: false,
  error: [
    'Chrome exited early (exit code: unknown) without writing DevToolsActivePort',
    '(also tried parsing stderr) Chrome exited before providing DevTools URL',
    'Chrome stderr:',
    '  [245491:245491:1005/181826.958962:FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:129] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor, see https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md.',
    'Hint: try --args "--no-sandbox" (required in containers, VMs, and some Linux setups)',
  ].join('\n'),
})}\n`;

test('a browser that cannot start its sandbox names the browserArguments fix', () => {
  expect(agentBrowserFailure('open', failure(sandboxStdout)).message).toBe(
    'agent-browser open exited with code 1: Chrome found no usable sandbox. capture.browserArguments ["--no-sandbox"] turns the sandbox off; see transcript.jsonl',
  );
});

test('another agent-browser failure quotes the first line of its error', () => {
  const stdout = `${JSON.stringify({ success: false, error: '\n\u001b[31mElement not found: #save\u001b[0m\nmore' })}\n`;

  expect(agentBrowserFailure('click', failure(stdout)).message).toBe(
    'agent-browser click exited with code 1: Element not found: #save; see transcript.jsonl',
  );
});

test('a failed batch quotes the error of the command that failed', () => {
  const stdout = `${JSON.stringify([
    { command: ['open', 'about:blank'], error: null, success: true },
    {
      command: ['fill', '#password'],
      error: 'Element not found: #password',
      success: false,
    },
  ])}\n`;

  expect(agentBrowserFailure('batch', failure(stdout)).message).toBe(
    'agent-browser batch exited with code 1: Element not found: #password; see transcript.jsonl',
  );
});

test('a launcher failure on stderr is quoted', () => {
  expect(
    agentBrowserFailure(
      'open',
      failure('', 'Error: No binary found for linux-x64\n'),
    ).message,
  ).toBe(
    'agent-browser open exited with code 1: Error: No binary found for linux-x64; see transcript.jsonl',
  );
});

test('an agent-browser failure without a JSON error points to the transcript', () => {
  expect(
    agentBrowserFailure('open', failure('Segmentation fault\n')).message,
  ).toBe(
    'agent-browser open exited with code 1; see transcript.jsonl for original output',
  );
});

test('a failed agent-browser command keeps concealed values out of its message, stdout and transcript', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'observed-agent-browser-'),
  );
  const transcript = path.join(directory, 'transcript.jsonl');
  const secret = 'fill-secret-4471';
  const output = JSON.stringify({
    success: false,
    error: `Could not type ${secret}`,
  });

  try {
    const exit = await Effect.runPromiseExit(
      processOutput({
        command: process.execPath,
        args: [
          '-e',
          `console.log(${JSON.stringify(output)}); process.exit(1);`,
        ],
        cwd: directory,
        transcript,
        concealed: [secret],
      }).pipe(Effect.provide(BunServices.layer)),
    );
    const error = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
      : undefined;

    if (!(error instanceof ProcessFailure)) {
      throw new Error('The failing command did not end in a ProcessFailure');
    }

    const message = agentBrowserFailure('fill', error).message;

    expect(message).toMatch(
      /^agent-browser fill exited with code 1: Could not type /,
    );
    expect(message).not.toContain(secret);
    expect(error.stdout).not.toContain(secret);
    expect(await readFile(transcript, 'utf8')).not.toContain(secret);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
