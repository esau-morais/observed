import { Effect, Schema } from 'effect';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRun, type Expectation } from './check';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const objectSchema = Schema.Record(Schema.String, Schema.Json);
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(objectSchema));

const faults = [
  'failed-base',
  'deleted-artifact',
  'old-schema',
  'unsupported-collector',
  'stale-capture',
] as const;

function expectation(id: string): Expectation {
  return {
    id,
    gate: 4,
    reason: `A ${id} leaves the comparison unavailable.`,
    exitCode: 1,
    assertions: [
      {
        label: 'unavailable conclusion',
        actual: {
          kind: 'json',
          file: 'result.json',
          path: ['conclusion', 'kind'],
        },
        expected: 'unavailable',
      },
      {
        label: 'candidate still contains one real request',
        actual: {
          kind: 'requests',
          file: 'journey-1/candidate/requests.har',
          method: 'GET',
          pathname: '/api/items',
          status: 200,
        },
        expected: 1,
      },
      {
        label: 'missing base evidence is unknown',
        actual: {
          kind: 'json',
          file: 'result.json',
          path: [
            'journeys',
            0,
            'base',
            'checks',
            {
              key: 'id',
              equals: id === 'old-schema' ? 'capture-evidence' : 'loaded-text',
            },
            'outcome',
          ],
        },
        expected: 'unknown',
      },
    ],
  };
}

await Effect.runPromise(
  Effect.tryPromise(async () => {
    const [sourceArgument, outputArgument] = process.argv.slice(2);

    if (sourceArgument === undefined || outputArgument === undefined) {
      throw new Error(
        'Usage: bun run gates:missing CORRECT_CHANGE_REPORT NEW_OUTPUT_DIRECTORY',
      );
    }

    const source = path.resolve(sourceArgument);
    const output = path.resolve(outputArgument);
    await mkdir(output);
    await writeFile(
      path.join(output, 'expectations.json'),
      json(faults.map(expectation)),
      { flag: 'wx' },
    );
    const results = [];

    for (const fault of faults) {
      const directory = path.join(output, fault);
      const base = path.join(directory, 'base');
      const candidate = path.join(directory, 'candidate');
      const report = path.join(directory, 'report');
      const expected = expectation(fault);
      await mkdir(directory);
      await writeFile(path.join(directory, 'expected.json'), json(expected), {
        flag: 'wx',
      });
      await cp(path.join(source, 'journey-1/base'), base, { recursive: true });
      await cp(path.join(source, 'journey-1/candidate'), candidate, {
        recursive: true,
      });
      const filename = path.join(base, 'capture.json');
      const manifest = { ...decode(await readFile(filename, 'utf8')) };

      switch (fault) {
        case 'failed-base':
          manifest.execution = {
            kind: 'failed',
            category: 'application',
            reason: 'Seeded base startup failure',
          };
          break;
        case 'deleted-artifact':
          await rm(path.join(base, 'evidence/text.json'));
          break;
        case 'old-schema':
          manifest.schemaVersion = 3;
          break;
        case 'unsupported-collector': {
          const entries = Schema.decodeUnknownSync(Schema.Array(objectSchema))(
            manifest.evidence,
          );
          manifest.evidence = entries.map((entry) =>
            entry.kind === 'text' ? { ...entry, schemaVersion: 999 } : entry,
          );
          break;
        }
        case 'stale-capture':
          manifest.startedAt = '2020-01-01T00:00:00.000Z';
          manifest.finishedAt = '2020-01-01T00:00:01.000Z';
          break;
      }

      await writeFile(filename, json(manifest));
      const args = [
        process.execPath,
        'run',
        'compare',
        base,
        candidate,
        '--output',
        report,
      ];
      const child = Bun.spawn(args, {
        cwd: path.resolve(import.meta.dirname, '../..'),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      await writeFile(
        path.join(directory, 'execution.json'),
        json({ args, exitCode, stdout, stderr }),
      );
      await writeFile(path.join(directory, 'exit.json'), json(exitCode));
      const checked = await checkRun(report, expected, exitCode);
      await writeFile(path.join(directory, 'checked.json'), json(checked));
      results.push(checked);
      console.log(json(checked));
    }

    await writeFile(path.join(output, 'summary.json'), json(results));
    process.exitCode = results.every((result) => result.passed) ? 0 : 1;
  }),
);
