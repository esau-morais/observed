import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  actionsPolicy,
  checkoutAction,
  detectAgents,
  requiredCheckStep,
  workflowStep,
  workflowYaml,
  type Answer,
  type Consent,
  type Shell,
} from '../src/guided-setup';

const root = path.resolve(import.meta.dirname, '..');
const sha = 'a'.repeat(40);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function scratch() {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-guided-'));
  temporary.push(directory);

  return directory;
}

test('agent detection only looks for the agent commands in PATH directories', () => {
  const checked: string[] = [];
  const found = detectAgents(
    ['/opt/bin', 'relative/bin', '/usr/local/bin'].join(path.delimiter),
    (file) => {
      checked.push(file);

      return file === '/usr/local/bin/codex';
    },
  );

  expect(found).toEqual(['codex']);
  expect(
    checked.every(
      (file) =>
        ['/opt/bin', '/usr/local/bin'].includes(path.dirname(file)) &&
        ['claude', 'codex', 'opencode'].includes(path.basename(file)),
    ),
  ).toBe(true);
});

test('the generated workflow pins a full commit SHA and grants exactly three permissions', () => {
  const yaml = workflowYaml({ project: 'app', sha, version: '0.3.0' });

  expect(yaml).toContain(`uses: esau-morais/observed@${sha} # v0.3.0\n`);
  expect(
    /^permissions:\n((?: {2}.*\n)+)/m
      .exec(yaml)?.[1]
      ?.split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/\s+#.*$/, '').trim()),
  ).toEqual(['contents: read', 'checks: write', 'pull-requests: write']);
  expect(yaml).toContain('    name: Observed\n');
  expect(() =>
    workflowYaml({ project: '.', sha: 'v0.3.0', version: '0.3.0' }),
  ).toThrow();
});

test.each([
  {
    selected: { patterns_allowed: ['esau-morais/observed@*'] },
    github: true,
    policy: 'allowed',
  },
  {
    selected: { patterns_allowed: ['esau-morais/observed@v0'] },
    github: true,
    policy: 'blocked',
  },
  {
    selected: {
      patterns_allowed: ['esau-morais/*', 'actions/checkout@*'],
    },
    github: false,
    policy: 'allowed',
  },
  { selected: { patterns_allowed: [] }, github: true, policy: 'blocked' },
])(
  'the allowed-actions check matches the pinned references: $policy',
  ({ selected, github, policy }) => {
    expect(
      actionsPolicy({
        permissions: JSON.stringify({
          enabled: true,
          allowed_actions: 'selected',
        }),
        selected: JSON.stringify({
          ...selected,
          github_owned_allowed: github,
        }),
        uses: [`esau-morais/observed@${sha}`, checkoutAction],
      }).kind,
    ).toBe(policy);
  },
);

// Answers GitHub's read-only questions the way a permissive repository would
// and records every command, so a test can tell reads from outward writes.
function recordingShell() {
  const commands: string[][] = [];
  const shell: Shell = (argv) => {
    commands.push([...argv]);
    const line = argv.join(' ');
    const answers: [string, string][] = [
      ['git/ref/tags/', JSON.stringify({ object: { type: 'commit', sha } })],
      [
        'actions/permissions',
        JSON.stringify({ enabled: true, allowed_actions: 'all' }),
      ],
      ['defaultBranchRef', 'main\n'],
      ['rules/branches', '[]'],
      ['gh pr create', 'https://github.test/o/r/pull/1\n'],
    ];
    const stdout =
      answers.find(([fragment]) => line.includes(fragment))?.[1] ?? '';

    return Effect.succeed({ code: 0, stdout, stderr: '' });
  };

  const outward = () =>
    commands.filter((argv) =>
      /^(git (worktree add|commit|push)|gh pr create|gh api --method POST)/.test(
        argv.join(' '),
      ),
    );

  return { shell, commands, outward };
}

async function offerWorkflow(options: { consent: Consent; answer: Answer }) {
  const gitRoot = await scratch();
  const observed = path.join(gitRoot, '.observed');
  const recorded = recordingShell();
  const questions: string[] = [];

  await writeFile(path.join(gitRoot, 'observed.json'), '{}');

  const offer = () =>
    Effect.runPromise(
      Effect.scoped(
        workflowStep({
          shell: recorded.shell,
          ask: (question) => {
            questions.push(question);

            return Effect.succeed(options.answer);
          },
          say: () => Effect.void,
          consent: options.consent,
          gitRoot,
          project: '.',
          repository: 'o/r',
          version: '0.3.0',
          observed,
          scratch: gitRoot,
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );

  return { offer, recorded, questions, observed };
}

test.each([
  { consent: 'no-terminal', answer: 'yes', status: 'needs-answer' },
  { consent: 'dry-run', answer: 'yes', status: 'planned' },
  { consent: 'ask', answer: 'no', status: 'declined' },
  { consent: 'ask', answer: 'cancelled', status: 'needs-answer' },
] as const)(
  'no branch, push or pull request happens with $consent and answer $answer',
  async ({ consent, answer, status }) => {
    const { offer, recorded } = await offerWorkflow({ consent, answer });

    expect((await offer()).step.status).toBe(status);
    expect(recorded.outward()).toEqual([]);
  },
);

test('a cancelled question is asked again, unlike a no', async () => {
  const { offer, questions } = await offerWorkflow({
    consent: 'ask',
    answer: 'cancelled',
  });

  await offer();
  await offer();

  expect(questions).toHaveLength(2);
});

test('a declined workflow is remembered, so observed stops asking', async () => {
  const { offer, questions, observed } = await offerWorkflow({
    consent: 'ask',
    answer: 'no',
  });

  await offer();
  const again = await offer();

  expect(questions).toHaveLength(1);
  expect(again.step.status).toBe('declined');
  expect(await readFile(path.join(observed, 'setup.json'), 'utf8')).toContain(
    'declined',
  );
});

test('--yes opens the setup pull request but never creates a ruleset', async () => {
  const { offer, recorded } = await offerWorkflow({
    consent: 'yes',
    answer: 'no',
  });

  expect((await offer()).step).toMatchObject({
    status: 'done',
    detail: 'Opened https://github.test/o/r/pull/1',
  });
  expect(recorded.outward().map((argv) => argv.slice(0, 3).join(' '))).toEqual([
    'git worktree add',
    'git commit --quiet',
    'git push --quiet',
    'gh pr create',
  ]);

  const rules = recordingShell();
  const step = await Effect.runPromise(
    requiredCheckStep({
      shell: rules.shell,
      ask: () => Effect.succeed('yes' as const),
      say: () => Effect.void,
      consent: 'yes',
      repository: 'o/r',
      base: 'main',
      cwd: root,
    }),
  );

  expect(step.status).toBe('skipped');
  expect(rules.outward()).toEqual([]);
});

test('without a terminal observed never prompts or starts an agent, and prints the next step and prompt', async () => {
  const directory = await scratch();
  const bin = path.join(directory, 'bin');
  const home = path.join(directory, 'home');
  const app = path.join(directory, 'app');
  const marker = path.join(directory, 'agent-ran');

  await mkdir(bin);
  await mkdir(path.join(home, '.agent-browser', 'browsers', 'chrome'), {
    recursive: true,
  });
  await mkdir(app);
  await writeFile(path.join(bin, 'claude'), `#!/bin/sh\ntouch '${marker}'\n`);
  await chmod(path.join(bin, 'claude'), 0o755);

  const child = Bun.spawn(
    [process.execPath, 'src/workflow-cli.ts', '--project', app],
    {
      cwd: root,
      env: {
        PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(
          path.delimiter,
        ),
        HOME: home,
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  expect(code).toBe(3);
  expect(stdout).toContain('Next: Write observed.json with the prompt below');
  expect(stdout).toContain('### Write observed.json');
  expect(await Bun.file(marker).exists()).toBe(false);
}, 30_000);
