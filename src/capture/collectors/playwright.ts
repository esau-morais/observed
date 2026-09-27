import { Effect, FileSystem } from 'effect';
import path from 'node:path';
import { collectReport } from '../../playwright/collect';
import { parseJsonReport } from '../../playwright/report';
import { redactText } from '../../redact';
import { processOutput } from '../process';
import { EvidenceUnavailable, type Collector } from './define';

export const playwright: Collector<'playwright'> = {
  phase: 'command',
  producerFor: (value) => ({
    name: 'Playwright',
    version: value?.version ?? 'not recorded',
  }),
  environment: ({ environment }) => environment ?? [],
  collect: ({ command, environment }, context) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const output = yield* fs.makeTempDirectoryScoped({
        prefix: 'observed-playwright-',
      });
      const results = path.join(output, 'results.json');
      const [program, ...args] = command;
      const url = new URL(context.url);

      context.addArtifact(
        'playwright-transcript',
        'playwright-transcript.jsonl',
        "Output of the app's Playwright command",
      );

      // Playwright exits 1 when a test fails; the report says which.
      const exitCode = yield* processOutput({
        command: program,
        args,
        cwd: context.workspace,
        env: {
          ...Object.fromEntries(
            (environment ?? []).map((name) => [
              name,
              context.environment.get(name),
            ]),
          ),
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: 'en_US.UTF-8',
          TZ: 'UTC',
          BASE_URL: url.origin,
          PORT: url.port,
          PLAYWRIGHT_JSON_OUTPUT_FILE: results,
        },
        transcript: path.join(context.directory, 'playwright-transcript.jsonl'),
        timeoutMs: context.timeoutMs,
        concealed: context.concealed,
      }).pipe(
        Effect.as(0),
        Effect.catchTag('ProcessFailure', (failure) =>
          Effect.succeed(failure.exitCode),
        ),
      );

      if (!(yield* fs.exists(results))) {
        return yield* new EvidenceUnavailable({
          reason: `The Playwright command exited with code ${exitCode} without writing a JSON report. Enable the json reporter in the command, as in --reporter=line,json, and don't set its outputFile`,
        });
      }

      const text = yield* fs.readFileString(results);

      yield* fs.makeDirectory(path.join(context.directory, 'playwright'), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(context.directory, 'playwright', 'report.json'),
        redactText(text, context.concealed),
        { flag: 'wx' },
      );
      context.addArtifact(
        'playwright-report',
        'playwright/report.json',
        "Playwright's JSON report; credentials redacted",
      );

      const report = yield* parseJsonReport(text).pipe(
        Effect.mapError(
          ({ message }) => new EvidenceUnavailable({ reason: message }),
        ),
      );
      const workspace = yield* fs.realPath(context.workspace);

      return yield* collectReport({
        report,
        exitCode,
        root: workspace,
        workspace,
        directory: context.directory,
        concealed: context.concealed,
        addArtifact: context.addArtifact,
      });
    }).pipe(Effect.scoped),
};
