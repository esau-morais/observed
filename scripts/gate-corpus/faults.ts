import { Effect, Schema } from 'effect';
import {
  appendFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { checkRun } from './check';
import { checkRequestFault } from './fault-check';
import {
  availabilityCases,
  availabilityExpectation,
  detectedFault,
  seededFaults,
} from './fault-cases';
import { provenance } from './provenance';

const tool = path.resolve(import.meta.dirname, '../..');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const decodeExit = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Int));

async function execute(cwd: string, args: string[], record: string) {
  const child = Bun.spawn(['timeout', '--kill-after=10s', '900s', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const execution = { args, cwd, exitCode, stdout, stderr };
  await writeFile(record, json(execution), { flag: 'wx' });

  return execution;
}

async function required(cwd: string, args: string[], record: string) {
  const execution = await execute(cwd, args, record);
  if (execution.exitCode !== 0) {
    throw new Error(`Command failed (${execution.exitCode}); see ${record}`);
  }

  return execution.stdout.trim();
}

await Effect.runPromise(
  Effect.tryPromise(async () => {
    const [argument] = process.argv.slice(2);
    if (argument === undefined) {
      throw new Error('Usage: bun run gates:faults NEW_OUTPUT_DIRECTORY');
    }

    const source = await provenance(tool);
    if (source.status !== '') {
      throw new Error(
        'Commit the fault definitions and runner before running gates:faults',
      );
    }

    const output = path.resolve(argument);
    await mkdir(output);
    await writeFile(path.join(output, 'tool.json'), json(source));
    await writeFile(
      path.join(output, 'required.json'),
      json({
        baseline:
          'Every unmutated pair and availability probe passes on the same commit.',
        faults: seededFaults,
      }),
      { flag: 'wx' },
    );
    const baseline = path.join(output, 'baseline');
    await required(
      tool,
      [process.execPath, 'run', 'gates', baseline],
      path.join(output, 'baseline-execution.json'),
    );
    const goodReport = path.join(baseline, 'correct-change/run/report');
    await required(
      tool,
      [
        process.execPath,
        'run',
        'gates:missing',
        goodReport,
        path.join(output, 'baseline-missing'),
      ],
      path.join(output, 'baseline-missing-execution.json'),
    );

    async function availability(root: string, directory: string) {
      const results = [];
      for (const id of availabilityCases) {
        const probe = path.join(directory, id);
        const execution = await execute(
          root,
          [
            process.execPath,
            'scripts/gate-corpus/fault-probe.ts',
            goodReport,
            probe,
            id,
          ],
          path.join(directory, `${id}-execution.json`),
        );
        const exit = decodeExit(
          await readFile(path.join(probe, 'exit.json'), 'utf8'),
        );
        if (execution.exitCode !== exit) {
          throw new Error(`Probe exit differs from recorded exit: ${probe}`);
        }

        const checked = await checkRun(
          probe,
          availabilityExpectation(id),
          exit,
        );
        await writeFile(path.join(probe, 'checked.json'), json(checked));
        results.push(checked);
      }

      return results;
    }

    const baselineAvailability = path.join(output, 'baseline-availability');
    await mkdir(baselineAvailability);
    const baselineChecks = await availability(tool, baselineAvailability);
    if (baselineChecks.some((result) => !result.passed)) {
      throw new Error('Unmutated availability probes failed');
    }

    const results = [];
    for (const fault of seededFaults) {
      console.log(`Seeding ${fault.id}`);
      const directory = path.join(output, fault.id);
      const copy = path.join(directory, 'tool');
      await mkdir(directory);
      await writeFile(path.join(directory, 'required.json'), json(fault), {
        flag: 'wx',
      });
      await required(
        tool,
        ['git', 'clone', '--shared', '--no-checkout', tool, copy],
        path.join(directory, 'clone.json'),
      );
      await required(
        copy,
        [
          'git',
          '-c',
          'core.hooksPath=/dev/null',
          'checkout',
          '--detach',
          source.commit,
        ],
        path.join(directory, 'checkout.json'),
      );
      await symlink(
        path.join(tool, 'node_modules'),
        path.join(copy, 'node_modules'),
      );
      await appendFile(
        path.join(copy, '.git/info/exclude'),
        '\n/node_modules\n',
      );
      const filename = path.join(copy, fault.file);
      const before = await readFile(filename, 'utf8');
      if (before.split(fault.from).length !== 2) {
        throw new Error(`Fault must match exactly once: ${fault.id}`);
      }

      await writeFile(filename, before.replace(fault.from, fault.to));
      const diff = await required(
        copy,
        ['git', 'diff', '--binary', 'HEAD'],
        path.join(directory, 'diff-execution.json'),
      );
      await writeFile(path.join(directory, 'mutation.diff'), `${diff}\n`);
      let checked;
      if (fault.probe === 'availability') {
        checked = await availability(copy, directory);
      } else {
        const corpus = path.join(directory, 'corpus');
        const execution = await execute(
          copy,
          [process.execPath, 'run', 'gates', corpus, 'request-fault'],
          path.join(directory, 'corpus-execution.json'),
        );
        const pairDirectory = path.join(corpus, 'request-fault');
        const exit = decodeExit(
          await readFile(path.join(pairDirectory, 'exit.json'), 'utf8'),
        );
        const { result, raw } = await checkRequestFault(pairDirectory, exit);
        await writeFile(path.join(directory, 'raw-checked.json'), json(raw));
        if (!raw.passed) {
          throw new Error(`Raw producer readings failed: ${fault.id}`);
        }

        if (execution.exitCode !== (result.passed ? 0 : 1)) {
          throw new Error(`Corpus did not finish normally: ${fault.id}`);
        }

        checked = [result];
      }

      const detected = checked.every(
        (result) =>
          !result.passed &&
          detectedFault(result.failures, fault.requiredFailures),
      );
      const result = {
        id: fault.id,
        status: detected ? 'detected' : 'survived',
        checked,
      };
      await writeFile(path.join(directory, 'checked.json'), json(result));
      results.push(result);
      await writeFile(
        path.join(output, 'summary.json'),
        json({
          complete: false,
          commit: source.commit,
          baseline: 'passed',
          faults: results,
        }),
      );
      console.log(json(result));
    }

    const finalSource = await provenance(tool);
    if (finalSource.commit !== source.commit || finalSource.status !== '') {
      throw new Error('Source checkout changed during the fault run');
    }

    const passed = results.every((result) => result.status === 'detected');
    await writeFile(
      path.join(output, 'summary.json'),
      json({
        complete: true,
        passed,
        commit: source.commit,
        baseline: 'passed',
        faults: results,
      }),
    );
    process.exitCode = passed ? 0 : 1;
  }),
);
