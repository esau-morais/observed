import { Effect, FileSystem } from 'effect';
import path from 'node:path';
import { processOutput } from '../../process';
import { redactText } from '../../redact';
import { EvidenceUnavailable, type AddArtifact } from '../define';
import { collectReport } from './collect';
import { parseJsonReport } from './report';

// Runs the app's own Playwright command against the running app and keeps
// its JSON report. Playwright exits 1 when a test fails; the report says which.
export const runPlaywright = Effect.fnUntraced(function* (options: {
  command: readonly [string, ...string[]];
  environment: ReadonlyMap<string, string>;
  directory: string;
  workspace: string;
  url: string;
  concealed: readonly string[];
  timeoutMs: number;
  addArtifact: AddArtifact;
}) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.makeTempDirectoryScoped({ prefix: 'observed-playwright-' });
  const results = path.join(output, 'results.json');
  const [program, ...args] = options.command;
  const url = new URL(options.url);

  options.addArtifact({
    id: 'playwright-transcript',
    path: 'playwright-transcript.jsonl',
    description: "Output of the app's Playwright command",
  });

  const exitCode = yield* processOutput({
    command: program,
    args,
    cwd: options.workspace,
    env: {
      ...Object.fromEntries(options.environment),
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: 'en_US.UTF-8',
      TZ: 'UTC',
      BASE_URL: url.origin,
      PORT: url.port,
      PLAYWRIGHT_JSON_OUTPUT_FILE: results,
    },
    transcript: path.join(options.directory, 'playwright-transcript.jsonl'),
    timeoutMs: options.timeoutMs,
    concealed: options.concealed,
  }).pipe(
    Effect.as(0),
    Effect.catchTag('ProcessFailure', (failure) => Effect.succeed(failure.exitCode)),
  );

  if (!(yield* fs.exists(results))) {
    return yield* new EvidenceUnavailable({
      reason: `The Playwright command exited with code ${exitCode} without writing a JSON report. Enable the json reporter in the command, as in --reporter=line,json, and don't set its outputFile`,
    });
  }

  const text = yield* fs.readFileString(results);

  yield* fs.makeDirectory(path.join(options.directory, 'playwright'), { recursive: true });
  yield* fs.writeFileString(
    path.join(options.directory, 'playwright', 'report.json'),
    redactText(text, options.concealed),
    { flag: 'wx' },
  );
  options.addArtifact({
    id: 'playwright-report',
    path: 'playwright/report.json',
    description: "Playwright's JSON report; credentials redacted",
  });

  const report = yield* parseJsonReport(text).pipe(
    Effect.mapError(({ message }) => new EvidenceUnavailable({ reason: message })),
  );
  const workspace = yield* fs.realPath(options.workspace);

  return yield* collectReport({
    report,
    exitCode,
    root: workspace,
    workspace,
    directory: options.directory,
    concealed: options.concealed,
    addArtifact: options.addArtifact,
  });
}, Effect.scoped);
