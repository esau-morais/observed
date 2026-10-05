import { Effect } from 'effect';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRun } from './check';
import { pairs, project } from './cases';

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

await Effect.runPromise(
  Effect.tryPromise(async () => {
    const [destination, selected] = process.argv.slice(2);

    if (destination === undefined) {
      throw new Error('Usage: bun run gates NEW_OUTPUT_DIRECTORY [PAIR_ID]');
    }

    const chosen =
      selected === undefined
        ? pairs
        : pairs.filter((pair) => pair.expectation.id === selected);

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
      json({
        commit: await git(tool, 'rev-parse', 'HEAD'),
        diff: await git(tool, 'diff', 'HEAD'),
        status: await git(tool, 'status', '--short'),
        bun: Bun.version,
      }),
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
      await cp(path.join(tool, 'tests/fixtures/gate-app'), fixture, {
        recursive: true,
      });
      await writeFile(path.join(fixture, 'observed.json'), json(project));
      await writeFile(
        path.join(fixture, 'README.md'),
        'Original documentation.\n',
      );
      await git(fixture, 'init', '-b', 'main');
      await git(fixture, 'config', 'user.name', 'Observed gate corpus');
      await git(fixture, 'config', 'user.email', 'gate-corpus@example.invalid');
      await git(fixture, 'add', '.');
      await git(fixture, 'commit', '-m', 'test: establish the protected base');
      const base = await git(fixture, 'rev-parse', 'HEAD');

      for (const edit of pair.edits) {
        const filename = path.join(fixture, edit.file);
        const before = await readFile(filename, 'utf8');

        if (before.split(edit.from).length !== 2) {
          throw new Error(
            `Edit must match exactly once: ${pair.expectation.id}/${edit.file}`,
          );
        }

        await writeFile(filename, before.replace(edit.from, edit.to));
      }

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
        pair.expectation,
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
