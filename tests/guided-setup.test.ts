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
  agentLaunch,
  agents,
  checkoutAction,
  cliCommand,
  detectAgents,
  githubRepository,
  guideSection,
  openCodeMajor,
  skillText,
  tagCommit,
  pushFailure,
  requiredCheckStep,
  setupTitle,
  shellPath,
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

test('observed skill finds its guide in the shipped README', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');

  expect(guideSection(readme)).toMatch(/^### Write observed\.json\n/);
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
        ['claude', 'codex', 'opencode', 'opencode2'].includes(
          path.basename(file),
        ),
    ),
  ).toBe(true);
});

test('an opened agent gets only the setup prompt, never a permission or non-interactive flag', () => {
  for (const agent of agents) {
    for (const major of [null, 1, 2]) {
      const { argv } = agentLaunch(agent, 'the prompt', major);

      expect(argv[0]).toBe(agent);
      expect(argv.at(-1)).toBe('the prompt');
      expect(
        argv
          .slice(1, -1)
          .filter(
            (argument) => !['--prompt', '--standalone'].includes(argument),
          ),
      ).toEqual([]);
    }
  }
});

test.each([
  { output: '1.18.33', major: 1, sends: true },
  { output: 'opencode v2.0.18', major: 2, sends: false },
  { output: 'opencode2 v0.0.0-beta-19271', major: 2, sends: false },
  { output: 'unexpected', major: null, sends: true },
])(
  'OpenCode $output gets a private server only from version 2',
  ({ output, major, sends }) => {
    expect(openCodeMajor(output)).toBe(major);
    expect(agentLaunch('opencode', 'p', openCodeMajor(output))).toEqual({
      argv: sends
        ? ['opencode', '--prompt', 'p']
        : ['opencode', '--standalone', '--prompt', 'p'],
      sends,
    });
  },
);

test('every command in the skill runs the exact version that printed it', () => {
  const text = skillText({
    cli: cliCommand('0.3.0-alpha.2', null),
    version: '0.3.0-alpha.2',
    guide:
      '### Write observed.json\n\nThen `observed\n  capture` takes the first journey.',
  });
  const commands = [...text.matchAll(/bunx ([^\s`]+)/g)].map(
    (match) => match[1],
  );

  expect(commands.length).toBeGreaterThan(3);
  expect(
    commands.every(
      (command) => command === '@observed-software/cli@0.3.0-alpha.2',
    ),
  ).toBe(true);
  expect(text).not.toMatch(/`observed\s/);
  expect(text).toContain('blob/v0.3.0-alpha.2/README.md');
});

test.each([
  { installed: 'observed v0.3.0-alpha.2\n', cli: 'observed' },
  {
    installed: 'observed v0.3.0-alpha.1\n',
    cli: 'bunx @observed-software/cli@0.3.0-alpha.2',
  },
  { installed: null, cli: 'bunx @observed-software/cli@0.3.0-alpha.2' },
])(
  'the prompt names observed only when it is installed at the running version: $installed',
  ({ installed, cli }) => {
    expect(cliCommand('0.3.0-alpha.2', installed)).toBe(cli);
  },
);

test('the installed-command check ignores the node_modules/.bin that bunx adds to PATH', () => {
  expect(
    shellPath(
      [
        '/tmp/bunx-1000-@observed-software/cli@0.3.0/node_modules/.bin',
        '/home/me/app/node_modules/.bin',
        '/home/me/.bun/bin',
        '/usr/bin',
      ].join(path.delimiter),
    ),
  ).toBe(['/home/me/.bun/bin', '/usr/bin'].join(path.delimiter));
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
function recordingShell(
  overrides: [string, { code: number; stdout: string; stderr: string }][] = [],
) {
  const commands: string[][] = [];
  const shell: Shell = (argv) => {
    commands.push([...argv]);
    const line = argv.join(' ');
    const override = overrides.find(([fragment]) => line.includes(fragment));

    if (override !== undefined) {
      return Effect.succeed(override[1]);
    }

    const answers: [string, string][] = [
      [
        'refs/tags/v',
        `${'b'.repeat(40)}\trefs/tags/v0.3.0\n${sha}\trefs/tags/v0.3.0^{}\n`,
      ],
      [
        'actions/permissions',
        JSON.stringify({ enabled: true, allowed_actions: 'all' }),
      ],
      ['--symref', `ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`],
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

async function offerWorkflow(options: {
  consent: Consent;
  answer: Answer;
  gh?: boolean;
  overrides?: Parameters<typeof recordingShell>[0];
}) {
  const gitRoot = await scratch();
  const observed = path.join(gitRoot, '.observed');
  const recorded = recordingShell(options.overrides);
  const questions: { question: string; initial: boolean | undefined }[] = [];

  await writeFile(path.join(gitRoot, 'observed.json'), '{}');

  const offer = () =>
    Effect.runPromise(
      Effect.scoped(
        workflowStep({
          shell: recorded.shell,
          gh: options.gh ?? true,
          ask: (question, initial) => {
            questions.push({ question, initial });

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

  // The recording shell creates no worktree, so the files land here.
  const worktree = path.join(gitRoot, 'observed-setup');

  return { offer, recorded, questions, observed, worktree };
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

test('the setup pull request question defaults to yes', async () => {
  const { offer, questions } = await offerWorkflow({
    consent: 'ask',
    answer: 'cancelled',
  });

  await offer();

  expect(questions.map((item) => item.initial)).toEqual([true]);
});

test('--yes pins the peeled release commit and opens the pull request with gh', async () => {
  const { offer, recorded, worktree } = await offerWorkflow({
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
  expect(
    await readFile(
      path.join(worktree, '.github/workflows/observed.yml'),
      'utf8',
    ),
  ).toContain(`uses: esau-morais/observed@${sha} # v0.3.0`);
});

const prefilledPage = (url: string) => {
  const page = new URL(url);

  expect(page.pathname).toBe('/o/r/compare/main...observed%2Fsetup');
  expect(page.searchParams.get('quick_pull')).toBe('1');
  expect(page.searchParams.get('title')).toBe(setupTitle);
  expect(page.searchParams.get('body')).toContain('#run-on-pull-requests');
};

test('without gh, --yes pushes with Git and hands over a prefilled pull request page', async () => {
  const { offer, recorded } = await offerWorkflow({
    consent: 'yes',
    answer: 'no',
    gh: false,
  });
  const outcome = await offer();

  expect(recorded.commands.filter((argv) => argv[0] === 'gh')).toEqual([]);
  expect(recorded.outward().map((argv) => argv.slice(0, 3).join(' '))).toEqual([
    'git worktree add',
    'git commit --quiet',
    'git push --quiet',
  ]);
  expect(outcome.kind).toBe('pushed');
  prefilledPage(outcome.kind === 'pushed' ? outcome.open : '');
});

test.each([
  {
    name: 'the branch is already on origin',
    overrides: [
      [
        'ls-remote --heads',
        { code: 0, stdout: `${sha}\trefs/heads/observed/setup\n`, stderr: '' },
      ],
    ] as Parameters<typeof recordingShell>[0],
    pushed: false,
  },
  {
    name: 'gh fails after the push',
    overrides: [
      [
        'gh pr create',
        { code: 1, stdout: '', stderr: 'GraphQL: Resource not accessible\n' },
      ],
    ] as Parameters<typeof recordingShell>[0],
    pushed: true,
  },
])(
  'when $name, observed still hands over the prefilled page',
  async ({ overrides, pushed }) => {
    const { offer, recorded } = await offerWorkflow({
      consent: 'yes',
      answer: 'no',
      overrides,
    });
    const outcome = await offer();

    expect(outcome.kind).toBe('pushed');
    prefilledPage(outcome.kind === 'pushed' ? outcome.open : '');
    expect(
      recorded.outward().some((argv) => argv.join(' ').startsWith('git push')),
    ).toBe(pushed);
  },
);

test('an existing Dependabot file on the default branch is never replaced', async () => {
  const { offer, recorded, worktree } = await offerWorkflow({
    consent: 'yes',
    answer: 'no',
  });

  await mkdir(path.join(worktree, '.github'), { recursive: true });
  await writeFile(
    path.join(worktree, '.github/dependabot.yml'),
    'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n',
  );
  await offer();

  const added = recorded.commands.find(
    (argv) => argv[0] === 'git' && argv[1] === 'add',
  );
  const body = recorded.commands
    .find((argv) => argv.join(' ').startsWith('gh pr create'))
    ?.at(-1);

  expect(added).not.toContain('.github/dependabot.yml');
  expect(body).toContain('package-ecosystem: github-actions');
});

test.each([
  ['https://github.com/o/r.git', 'o/r'],
  ['git@github.com:o/r.git', 'o/r'],
  ['https://esau@github.com/o/r.git', 'o/r'],
  ['https://x-access-token:secret@github.com/o/r', 'o/r'],
  ['ssh://git@github.com:22/o/r.git', 'o/r'],
  ['https://gitlab.com/o/r.git', null],
])('the remote %s is the GitHub repository %s', (remote, repository) => {
  expect(githubRepository(remote)).toBe(repository);
});

test.each([
  {
    name: 'an annotated tag, through its peeled commit',
    output: `${'b'.repeat(40)}\trefs/tags/v0.3.0\n${sha}\trefs/tags/v0.3.0^{}\n`,
    commit: sha,
  },
  {
    name: 'a lightweight tag',
    output: `${sha}\trefs/tags/v0.3.0\n`,
    commit: sha,
  },
  {
    name: 'another version only',
    output: `${sha}\trefs/tags/v0.3.0-alpha.1\n`,
    commit: null,
  },
])('the pinned commit comes from $name', ({ output, commit }) => {
  expect(tagCommit(output, '0.3.0')).toBe(commit);
});

test('a push refused for the workflow scope says how to fix it', () => {
  expect(
    pushFailure(
      " ! [remote rejected] observed/setup -> observed/setup (refusing to allow a Personal Access Token to create or update workflow `.github/workflows/observed.yml` without `workflow` scope)\nerror: failed to push some refs to 'https://github.com/o/r.git'",
    ),
  ).toContain('workflow scope');
});

test('a refused push reports the rejected line, not the last one', () => {
  expect(
    pushFailure(
      " ! [remote rejected] observed/setup -> observed/setup (pre-receive hook declined)\nerror: failed to push some refs to 'https://github.com/o/r.git'",
    ),
  ).toContain('pre-receive hook declined');
});

test('the required-check step never changes settings, and without gh only links to them', async () => {
  const withGh = recordingShell();
  const withoutGh = recordingShell();
  const run = (shell: Shell, gh: boolean) =>
    Effect.runPromise(
      requiredCheckStep({
        shell,
        gh,
        repository: 'o/r',
        base: 'main',
        cwd: root,
      }),
    );

  expect((await run(withGh.shell, true)).status).toBe('skipped');
  expect(withGh.commands.map((argv) => argv.slice(0, 3).join(' '))).toEqual([
    'gh api repos/o/r/rules/branches/main',
  ]);

  const linked = await run(withoutGh.shell, false);

  expect(withoutGh.commands).toEqual([]);
  expect(linked.detail).toContain('https://github.com/o/r/settings/rules');
});

test.each([
  { name: 'no agent named', agent: [] },
  { name: '--agent claude', agent: ['--agent', 'claude'] },
])(
  'without a terminal observed never prompts or opens an agent ($name), and prints the setup prompt',
  async ({ agent }) => {
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
      [process.execPath, 'src/workflow-cli.ts', '--project', app, ...agent],
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
    expect(stdout).toContain(
      'Next: Give this prompt to your coding agent, then run observed again.',
    );
    expect(stdout).toMatch(
      /Set up Observed in this directory: run `bunx @observed-software\/cli@[^`]+ skill`/,
    );
    expect(await Bun.file(marker).exists()).toBe(false);
  },
  30_000,
);
