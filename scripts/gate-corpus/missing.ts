import { Effect, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRun, select, type Expectation } from './check';
import { provenance } from './provenance';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const objectSchema = Schema.Record(Schema.String, Schema.Json);
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(objectSchema));

const faults = [
  'failed-base',
  'deleted-artifact',
  'old-schema',
  'unsupported-evidence-version',
  'stale-capture-and-window',
  'unknown-collector-kind',
  'stale-revision-identity',
] as const;

type Fault = (typeof faults)[number];

const reasons = {
  'failed-base': ['Capture failed (application): Seeded base startup failure'],
  'deleted-artifact': ['evidence-text: Artifact could not be read (ENOENT)'],
  'old-schema': [
    'Baseline unavailable: Capture manifest schema version 3 is unsupported. This Observed reads version 5. Capture this revision again.',
  ],
  'unsupported-evidence-version': 'Evidence schema version 999 is unsupported',
  'unknown-collector-kind': 'This Observed does not support this evidence kind',
  'stale-revision-identity': [
    'Capture manifest unavailable: Artifact could not be read (ENOENT)',
  ],
  'stale-capture-and-window': [
    'Capture is stale: older than 86400000 ms',
    'Observation window is inverted or outside the capture interval',
  ],
} satisfies Record<Fault, string | readonly string[]>;

function expectation(id: Fault): Expectation {
  const unavailableSide =
    id === 'stale-revision-identity' ? 'candidate' : 'base';
  const evidenceKind =
    id === 'unknown-collector-kind' ? 'future-collector' : 'text';

  return {
    id,
    gate: 4,
    reason: `A ${id} leaves the comparison unavailable.`,
    exitCode: 1,
    assertions: [
      {
        label: 'specific unavailability reason',
        actual: {
          kind: 'json',
          file: 'result.json',
          path:
            id === 'unsupported-evidence-version' ||
            id === 'unknown-collector-kind'
              ? [
                  'journeys',
                  0,
                  'base',
                  'evidence',
                  {
                    key: 'kind',
                    equals: evidenceKind,
                  },
                  'reason',
                ]
              : ['journeys', 0, unavailableSide, 'unresolved'],
        },
        expected: reasons[id],
      },
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
        label: 'missing evidence is unknown',
        actual: {
          kind: 'json',
          file: 'result.json',
          path: [
            'journeys',
            0,
            id === 'stale-revision-identity' ? 'candidate' : 'base',
            'checks',
            {
              key: 'id',
              equals:
                id === 'old-schema' || id === 'stale-revision-identity'
                  ? 'capture-evidence'
                  : 'loaded-text',
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
    const selected = decode(
      await readFile(path.join(source, 'selection.json'), 'utf8'),
    );
    const older = decode(
      await readFile(path.join(source, 'journey-1/base/capture.json'), 'utf8'),
    );
    const expectations = faults.map((fault): Expectation => {
      const expected = expectation(fault);
      if (fault !== 'stale-revision-identity') {
        return expected;
      }

      return {
        ...expected,
        assertions: [
          ...expected.assertions,
          {
            label: 'selected candidate manifest hash stays pinned',
            actual: {
              kind: 'json',
              file: 'selection.json',
              path: ['journeys', 0, 'candidate', 'manifestHash'],
            },
            expected: select(selected, [
              'journeys',
              0,
              'candidate',
              'manifestHash',
            ]),
          },
          {
            label: 'substituted capture belongs to the older revision',
            actual: {
              kind: 'json',
              file: 'journey-1/candidate/capture.json',
              path: ['source', 'revision', 'commit'],
            },
            expected: select(older, ['source', 'revision', 'commit']),
          },
        ],
      };
    });
    await mkdir(output);
    await writeFile(
      path.join(output, 'expectations.json'),
      json(expectations),
      { flag: 'wx' },
    );
    for (const args of [
      ['init', '-b', 'main', output],
      ['-C', output, 'add', 'expectations.json'],
      [
        '-C',
        output,
        '-c',
        'user.name=Observed gate corpus',
        '-c',
        'user.email=gate-corpus@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-m',
        'test: pin missing-evidence expectations before comparison',
      ],
    ]) {
      const child = Bun.spawn(['git', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, , stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) {
        throw new Error(`Expectation commit failed: ${stderr}`);
      }
    }

    await writeFile(
      path.join(output, 'tool.json'),
      json({
        ...(await provenance(path.resolve(import.meta.dirname, '../..'))),
        source: {
          report: source,
          resultSha256: createHash('sha256')
            .update(await readFile(path.join(source, 'result.json')))
            .digest('hex'),
        },
      }),
    );
    const results = [];

    for (const [index, fault] of faults.entries()) {
      const directory = path.join(output, fault);
      const base = path.join(directory, 'base');
      const candidate = path.join(directory, 'candidate');
      const report = path.join(directory, 'report');
      const expected = expectations[index];
      if (expected === undefined) {
        throw new Error(`Missing expectation: ${fault}`);
      }

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
        case 'unknown-collector-kind':
        case 'unsupported-evidence-version': {
          const entries = Schema.decodeUnknownSync(Schema.Array(objectSchema))(
            manifest.evidence,
          );
          const change =
            fault === 'unknown-collector-kind'
              ? { kind: 'future-collector' }
              : { schemaVersion: 999 };
          manifest.evidence = entries.map((entry) =>
            entry.kind === 'text' ? { ...entry, ...change } : entry,
          );
          break;
        }
        case 'stale-revision-identity':
          break;
        case 'stale-capture-and-window':
          manifest.startedAt = '2020-01-01T00:00:00.000Z';
          manifest.finishedAt = '2020-01-01T00:00:01.000Z';
          break;
      }

      await writeFile(filename, json(manifest));
      let args = [
        process.execPath,
        'run',
        'compare',
        base,
        candidate,
        '--output',
        report,
      ];
      if (fault === 'stale-revision-identity') {
        await cp(source, report, { recursive: true });
        const original = decode(
          await readFile(
            path.join(report, 'journey-1/candidate/capture.json'),
            'utf8',
          ),
        );
        const replacement = decode(
          await readFile(
            path.join(report, 'journey-1/base/capture.json'),
            'utf8',
          ),
        );
        if (
          select(original, ['source', 'revision', 'commit']) ===
          select(replacement, ['source', 'revision', 'commit'])
        ) {
          throw new Error(
            'Stale-revision probe requires distinct base and candidate captures',
          );
        }

        await rm(path.join(report, 'journey-1/candidate'), { recursive: true });
        await cp(
          path.join(report, 'journey-1/base'),
          path.join(report, 'journey-1/candidate'),
          { recursive: true },
        );
        args = [process.execPath, 'scripts/gate-corpus/revalidate.ts', report];
      }

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
