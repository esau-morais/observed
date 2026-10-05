import { Effect, Schema } from 'effect';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectJourney, summarizeJourneys } from '../../src/comparison';
import { conclusionExitCodes } from '../../src/comparison-model';
import { availabilityCases, availabilityExpectation } from './fault-cases';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const object = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

await Effect.runPromise(
  Effect.gen(function* () {
    const [source, destination, argument] = process.argv.slice(2);
    if (source === undefined || destination === undefined) {
      throw new Error(
        'Usage: fault-probe.ts CORRECT_CHANGE_REPORT NEW_DIRECTORY CASE',
      );
    }

    const id = Schema.decodeUnknownSync(Schema.Literals(availabilityCases))(
      argument,
    );
    const directory = path.resolve(destination);
    yield* Effect.tryPromise(async () => {
      await mkdir(directory);
      await writeFile(
        path.join(directory, 'expected.json'),
        json(availabilityExpectation(id)),
        { flag: 'wx' },
      );
      for (const name of ['healthy', 'unavailable']) {
        await cp(path.join(source, 'journey-1'), path.join(directory, name), {
          recursive: true,
        });
      }

      if (id === 'failed-base') {
        const filename = path.join(directory, 'unavailable/base/capture.json');
        const manifest = Schema.decodeUnknownSync(object)(
          await readFile(filename, 'utf8'),
        );
        await writeFile(
          filename,
          json({
            ...manifest,
            execution: {
              kind: 'failed',
              category: 'application',
              reason: 'Seeded base capture failure',
            },
          }),
        );
      }
    });
    const evaluatedAt = new Date().toISOString();
    const healthy = yield* inspectJourney({
      baseDirectory: path.join(directory, 'healthy/base'),
      candidateDirectory: path.join(directory, 'healthy/candidate'),
      evaluatedAt,
    });
    const unavailable = yield* inspectJourney({
      baseDirectory:
        id === 'missing-base' ? null : path.join(directory, 'unavailable/base'),
      candidateDirectory: path.join(directory, 'unavailable/candidate'),
      evaluatedAt,
    });
    const result = summarizeJourneys({
      journeys: [healthy.journey, unavailable.journey],
      evaluatedAt,
      mode: 'comparison',
    });
    const exitCode = conclusionExitCodes[result.conclusion.kind];
    yield* Effect.tryPromise(async () => {
      await writeFile(path.join(directory, 'result.json'), json(result));
      await writeFile(path.join(directory, 'exit.json'), json(exitCode));
    });
    process.exitCode = exitCode;
  }),
);
