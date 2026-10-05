import { Effect } from 'effect';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRun, type Expectation } from './check';
import { pairs, project, type Pair } from './cases';
import { generatedPairs } from './generated-cases';
import { startupFailurePair } from './missing-cases';
import { provenance } from './provenance';

const tool = path.resolve(import.meta.dirname, '../..');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function command(args: string[], cwd: string) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { args, exitCode, stdout, stderr };
}

async function git(cwd: string, ...args: string[]) {
  const result = await command(['git', ...args], cwd);

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  return result.stdout.trim();
}

async function applyEdits(fixture: string, edits: Pair['edits']) {
  for (const edit of edits) {
    const filename = path.join(fixture, edit.file);
    const before = await readFile(filename, 'utf8');
    if (before.split(edit.from).length !== 2) {
      throw new Error(`Edit must match exactly once: ${filename}`);
    }

    await writeFile(filename, before.replace(edit.from, edit.to));
  }
}

await Effect.runPromise(
  Effect.tryPromise(async () => {
    const [destination, selected] = process.argv.slice(2);

    if (destination === undefined) {
      throw new Error('Usage: bun run gates NEW_OUTPUT_DIRECTORY [PAIR_ID]');
    }

    const available = [...pairs, ...generatedPairs, startupFailurePair];
    const chosen =
      selected === undefined
        ? available
        : available.filter((pair) => pair.expectation.id === selected);

    if (chosen.length === 0) {
      throw new Error(`Unknown pair: ${selected ?? ''}`);
    }

    const output = path.resolve(destination);

    await mkdir(output);
    await writeFile(
      path.join(output, 'expectations.json'),
      json(chosen.map((pair) => pair.expectation)),
      { flag: 'wx' },
    );
    await writeFile(
      path.join(output, 'tool.json'),
      json(await provenance(tool)),
    );

    const results = [];

    for (const pair of chosen) {
      const directory = path.join(output, pair.expectation.id);
      const fixture = path.join(directory, 'project');

      await mkdir(directory);
      await writeFile(
        path.join(directory, 'expected.json'),
        json(pair.expectation),
        { flag: 'wx' },
      );
      await cp(
        path.join(tool, 'tests/fixtures', pair.fixture ?? 'gate-app'),
        fixture,
        {
          recursive: true,
        },
      );
      if (pair.fixture === undefined) {
        await writeFile(path.join(fixture, 'observed.json'), json(project));
      }

      await writeFile(
        path.join(fixture, 'README.md'),
        'Original documentation.\n',
      );
      await git(fixture, 'init', '-b', 'main');
      await git(fixture, 'config', 'commit.gpgsign', 'false');
      await git(fixture, 'config', 'core.hooksPath', '/dev/null');
      await git(fixture, 'config', 'user.name', 'Observed gate corpus');
      await git(fixture, 'config', 'user.email', 'gate-corpus@example.invalid');
      await applyEdits(fixture, pair.baseEdits ?? []);
      await git(fixture, 'add', '.');
      await git(fixture, 'commit', '-m', 'test: establish the protected base');
      const base = await git(fixture, 'rev-parse', 'HEAD');

      await applyEdits(fixture, pair.edits);

      if (pair.candidateProject !== undefined) {
        await writeFile(
          path.join(fixture, 'observed.json'),
          json(pair.candidateProject),
        );
      }

      await git(fixture, 'add', '.');
      await git(fixture, 'commit', '-m', `test: ${pair.expectation.reason}`);
      const candidate = await git(fixture, 'rev-parse', 'HEAD');

      await writeFile(
        path.join(directory, 'revisions.json'),
        json({ base, candidate }),
      );
      const assertions: [
        Expectation['assertions'][number],
        ...Expectation['assertions'][number][],
      ] = [...pair.expectation.assertions];
      const expectation = {
        ...pair.expectation,
        assertions,
      };
      for (const [side, revision] of [
        ['base', base],
        ['candidate', candidate],
      ] as const) {
        for (const journey of pair.generated === undefined ? [0] : [0, 1]) {
          expectation.assertions.push({
            label: `${side} journey ${journey + 1} pinned revision`,
            actual: {
              kind: 'json',
              file: 'result.json',
              path: [
                'journeys',
                journey,
                side,
                'capture',
                'manifest',
                'source',
                'revision',
                'commit',
              ],
            },
            expected: revision,
            raw: {
              kind: 'json',
              file: `journey-${journey + 1}/${side}/capture.json`,
              path: ['source', 'revision', 'commit'],
            },
          });
        }
      }

      await writeFile(path.join(directory, 'expected.json'), json(expectation));
      await writeFile(
        path.join(fixture, 'gate-expectation.json'),
        json(expectation),
      );
      await git(fixture, 'add', 'gate-expectation.json');
      await git(
        fixture,
        'commit',
        '-m',
        'test: pin expectations before capture',
      );
      console.log(
        `Running ${pair.expectation.id}: expected exit ${pair.expectation.exitCode}`,
      );
      const execution = await command(
        [
          process.execPath,
          'run',
          'observe',
          fixture,
          '--base',
          base,
          '--candidate',
          candidate,
          '--output',
          path.join(directory, 'run'),
          '--headless',
          ...(pair.generated === undefined
            ? []
            : ['--generated', path.join(fixture, pair.generated)]),
        ],
        tool,
      );

      await writeFile(path.join(directory, 'execution.json'), json(execution));
      await writeFile(
        path.join(directory, 'exit.json'),
        json(execution.exitCode),
      );
      const checked = await checkRun(
        path.join(directory, 'run', 'report'),
        expectation,
        execution.exitCode,
      );

      await writeFile(path.join(directory, 'checked.json'), json(checked));
      results.push(checked);
      console.log(json(checked));
    }

    await writeFile(path.join(output, 'summary.json'), json(results));
    process.exitCode = results.every((result) => result.passed) ? 0 : 1;
  }),
);
