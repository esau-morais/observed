import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Cause,
  Console,
  DateTime,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  captureSchema,
  parseCapture,
  parseObservations,
} from '../src/capture/model';
import { processOutput } from '../src/capture/process';
import { comparisonSchema } from '../src/comparison-model';

const projectRoot = path.resolve(import.meta.dirname, '..');

const evidence = path.join(
  projectRoot,
  'evidence',
  `acceptance-${randomUUID()}`,
);

class AcceptanceFailure extends Schema.TaggedError<AcceptanceFailure>()(
  'AcceptanceFailure',
  {
    check: Schema.String,
    detail: Schema.String,
  },
) {
  get message() {
    return `${this.check}: ${this.detail}`;
  }
}

class HttpFailure extends Schema.TaggedError<HttpFailure>()('HttpFailure', {
  cause: Schema.Defect(),
}) {}

const loopbackUrl = Schema.String.check(
  Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d+\/$/),
);

const harSchema = Schema.Struct({
  log: Schema.Struct({
    version: Schema.Literal('1.2'),
    creator: Schema.Struct({ name: Schema.String, version: Schema.String }),
    browser: Schema.Struct({ name: Schema.String, version: Schema.String }),
    entries: Schema.Array(
      Schema.Struct({
        startedDateTime: Schema.DateTimeUtcFromString,
        request: Schema.Struct({
          method: Schema.String,
          url: Schema.URLFromString,
        }),
        response: Schema.Struct({ status: Schema.Int }),
      }),
    ),
  }),
});

const ledgerSchema = Schema.Array(
  Schema.Struct({
    method: Schema.String,
    path: Schema.String,
    receivedAt: Schema.String,
  }),
);

const requestListSchema = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({
    requests: Schema.Array(
      Schema.Struct({
        requestId: Schema.String,
        method: Schema.String,
        url: Schema.URLFromString,
        status: Schema.Int,
      }),
    ),
  }),
});

const transcriptEntrySchema = Schema.Struct({
  args: Schema.Array(Schema.String),
  stdout: Schema.String,
  stderr: Schema.String,
  outcome: Schema.String,
});

const refusedSchema = Schema.Union([
  Schema.Struct({
    code: Schema.Literals(['ECONNREFUSED', 'ConnectionRefused']),
  }),
  Schema.Struct({
    cause: Schema.Struct({ code: Schema.Literal('ECONNREFUSED') }),
  }),
]);

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const save = Effect.fnUntraced(function* (name: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(
    path.join(evidence, name),
    `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'wx' },
  );
});

const check = Effect.fn('acceptanceCheck')(function* (
  name: string,
  condition: boolean,
  detail: string,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(
    path.join(evidence, 'assertions.jsonl'),
    `${JSON.stringify({
      name,
      outcome: condition ? 'passed' : 'failed',
      detail,
      evaluatedAt: DateTime.formatIso(yield* DateTime.now),
    })}\n`,
    { flag: 'a' },
  );

  if (!condition) {
    return yield* new AcceptanceFailure({ check: name, detail });
  }
});

const readText = Effect.fnUntraced(function* (filename: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(filename);
});

const readComparison = Effect.fnUntraced(function* (directory: string) {
  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(comparisonSchema),
  )(yield* readText(path.join(directory, 'result.json')));
});

const runCli = Effect.fn('runAcceptanceCli')(function* (
  name: string,
  args: readonly string[],
  timeoutMs: number = 120_000,
  expected: 'success' | 'failure' = 'success',
) {
  const transcript = path.join(evidence, `${name}.process.jsonl`);

  const exitCode = yield* processOutput({
    command: process.execPath,
    args: ['run', ...args],
    cwd: projectRoot,
    transcript,
    timeoutMs,
  }).pipe(
    Effect.as(0),
    Effect.catchTag('ProcessFailure', (error) =>
      Effect.succeed(error.exitCode),
    ),
  );

  const recorded = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(transcriptEntrySchema),
  )(yield* readText(transcript));

  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(
    path.join(evidence, `${name}.stdout.txt`),
    recorded.stdout,
    { flag: 'wx' },
  );

  yield* fs.writeFileString(
    path.join(evidence, `${name}.stderr.txt`),
    recorded.stderr,
    { flag: 'wx' },
  );

  yield* check(
    `${name}: exit`,
    expected === 'success' ? exitCode === 0 : exitCode !== 0,
    `Expected ${expected}; exit code ${exitCode}.`,
  );
});

const startControlledCli = Effect.fn('startControlledCli')(function* (
  name: string,
  args: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;

  const command = [path.join(projectRoot, 'src/workflow-cli.ts'), ...args];

  const startedAt = DateTime.formatIso(yield* DateTime.now);

  const handle = yield* ChildProcess.make(process.execPath, command, {
    cwd: projectRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    forceKillAfter: '20 seconds',
  });

  const output = path.join(evidence, `${name}.stdout.txt`);

  const errorOutput = path.join(evidence, `${name}.stderr.txt`);

  yield* fs.writeFileString(output, '', { flag: 'wx' });

  yield* fs.writeFileString(errorOutput, '', { flag: 'wx' });

  const stdout = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      fs.writeFileString(output, chunk, { flag: 'a' }),
    ),
    Effect.forkScoped,
  );

  const stderr = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      fs.writeFileString(errorOutput, chunk, { flag: 'a' }),
    ),
    Effect.forkScoped,
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      if (yield* handle.isRunning) {
        yield* handle.kill({
          killSignal: 'SIGTERM',
          forceKillAfter: '20 seconds',
        });
      }

      yield* Fiber.join(stdout);

      yield* Fiber.join(stderr);

      yield* save(`${name}.process.json`, {
        command: process.execPath,
        args: command,
        pid: handle.pid,
        startedAt,
        finishedAt: DateTime.formatIso(yield* DateTime.now),
        exitCode: yield* handle.exitCode,
      });
    }).pipe(Effect.orDie),
  );

  return { handle, output };
});

const signalOwnedProcess = Effect.fnUntraced(function* (
  name: string,
  pid: number,
) {
  yield* save(`${name}.signal.json`, {
    pid,
    signal: 'SIGTERM',
    at: DateTime.formatIso(yield* DateTime.now),
  });

  yield* Effect.try({
    try: () => process.kill(pid, 'SIGTERM'),
    catch: (cause) =>
      new AcceptanceFailure({
        check: `${name}: signal`,
        detail: String(cause),
      }),
  });
});

const assertStopped = Effect.fn('assertStopped')(function* (
  name: string,
  url: string,
) {
  yield* Schema.decodeUnknownEffect(loopbackUrl)(url);

  const stopped = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { signal, redirect: 'manual' }),
    catch: (cause) => new HttpFailure({ cause }),
  }).pipe(
    Effect.matchEffect({
      onSuccess: (response) =>
        Effect.promise(async () => {
          await response.body?.cancel();

          return false;
        }),
      onFailure: (error) =>
        Schema.decodeUnknownEffect(refusedSchema)(error.cause).pipe(
          Effect.as(true),
        ),
    }),
    Effect.timeout('2 seconds'),
  );

  yield* check(
    `${name}: server unreachable`,
    stopped,
    `${url} must refuse connections after cleanup.`,
  );
});

const verifyCleanup = Effect.fn('verifyCleanup')(function* (
  name: string,
  directory: string,
) {
  const browser = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Struct({ active: Schema.Boolean })),
  )(yield* readText(path.join(directory, 'browser-cleanup.json')));

  const server = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({ url: loopbackUrl, stopped: Schema.Boolean }),
    ),
  )(yield* readText(path.join(directory, 'server-cleanup.json')));

  yield* check(
    `${name}: browser cleanup`,
    !browser.active,
    'Owned browser session must be inactive.',
  );

  yield* check(
    `${name}: server cleanup`,
    server.stopped,
    'Owned application must record completed shutdown.',
  );

  yield* assertStopped(name, server.url);
});

const verifyRawCapture = Effect.fn('verifyRawCapture')(function* (
  name: string,
  directory: string,
  expected: number,
) {
  const fs = yield* FileSystem.FileSystem;

  const manifest = yield* parseCapture(
    yield* readText(path.join(directory, 'capture.json')),
  );

  const observations = yield* parseObservations(
    yield* readText(path.join(directory, 'observations.json')),
  );

  const har = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(harSchema),
  )(yield* readText(path.join(directory, 'requests.har')));

  const ledger = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ledgerSchema),
  )(yield* readText(path.join(directory, 'server-requests.json')));

  const requests = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(requestListSchema),
  )(yield* readText(path.join(directory, 'requests.json')));

  const errors = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        success: Schema.Literal(true),
        data: Schema.Struct({ errors: Schema.Array(Schema.Unknown) }),
      }),
    ),
  )(yield* readText(path.join(directory, 'errors.json')));

  yield* check(
    `${name}: completed capture`,
    manifest.execution.kind === 'complete',
    JSON.stringify(manifest.execution),
  );

  yield* check(
    `${name}: recorded conditions`,
    manifest.conditions.kind === 'recorded',
    'A successful capture must have recorded browser conditions.',
  );

  yield* check(
    `${name}: producer provenance`,
    har.log.creator.name === 'agent-browser' &&
      har.log.creator.version === '0.38.1' &&
      manifest.producer.version === har.log.creator.version,
    'HAR must identify the pinned producer independently of the manifest.',
  );

  yield* check(
    `${name}: HAR action count`,
    har.log.entries.length === expected &&
      har.log.entries.every(
        (entry) =>
          entry.request.method === 'GET' &&
          new URL(entry.request.url).pathname === '/api/items' &&
          entry.response.status === 200,
      ),
    `Expected exactly ${expected} successful GET /api/items entries, without page-load traffic.`,
  );

  yield* check(
    `${name}: independent server count`,
    ledger.length === expected &&
      ledger.every(
        (entry) => entry.method === 'GET' && entry.path === '/api/items',
      ),
    `Expected ${expected} server receipts.`,
  );

  yield* check(
    `${name}: raw request count`,
    requests.data.requests.length === expected &&
      requests.data.requests.every(
        (entry) =>
          entry.method === 'GET' &&
          new URL(entry.url).pathname === '/api/items' &&
          entry.status === 200,
      ) &&
      new Set(requests.data.requests.map((entry) => entry.requestId)).size ===
        expected,
    'Raw request records must preserve every individual request.',
  );

  yield* check(
    `${name}: normalized observations`,
    observations.requests.length === expected &&
      observations.requests.every(
        (entry) =>
          entry.method === 'GET' &&
          entry.path === '/api/items' &&
          entry.status === 200,
      ),
    'Normalized observations must agree with the independent HAR and server counts.',
  );

  yield* check(
    `${name}: page errors`,
    errors.data.errors.length === 0 && observations.browserErrors.length === 0,
    'The controlled successful journey must not have page errors.',
  );

  const image = yield* fs.readFile(path.join(directory, 'screenshot.png'));

  yield* check(
    `${name}: PNG evidence`,
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => image[index] === byte,
    ),
    'Screenshot must have a PNG signature.',
  );

  yield* verifyCleanup(name, directory);

  return { manifest, screenshotHash: digest(image) };
});

const snapshotOriginals = Effect.fn('snapshotOriginals')(function* (
  demo: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const hashes: { path: string; sha256: string }[] = [];

  for (const name of ['base', 'unchanged', 'duplicate', 'visual']) {
    const directory = path.join(demo, 'captures', name);

    const manifest = yield* parseCapture(
      yield* readText(path.join(directory, 'capture.json')),
    );

    for (const filename of new Set([
      'capture.json',
      ...manifest.artifacts.map((artifact) => artifact.path),
    ])) {
      yield* check(
        `${name}: contained artifact path`,
        !path.isAbsolute(filename) &&
          !filename.includes('\\') &&
          filename.split('/').every((part) => !['', '.', '..'].includes(part)),
        filename,
      );

      const absolute = path.join(directory, filename);

      const relative = path.relative(
        yield* fs.realPath(directory),
        yield* fs.realPath(absolute),
      );

      yield* check(
        `${name}: contained artifact file`,
        !path.isAbsolute(relative) &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`),
        filename,
      );

      hashes.push({
        path: absolute,
        sha256: digest(yield* fs.readFile(absolute)),
      });
    }
  }

  return hashes;
});

const compareFault = Effect.fn('compareFault')(function* (
  name: string,
  base: string,
  candidate: string,
) {
  const output = path.join(evidence, 'reports', name);

  yield* runCli(name, [
    'compare',
    base,
    candidate,
    '--output',
    output,
    '--json',
  ]);

  const result = yield* readComparison(output);

  yield* check(
    `${name}: comparison unavailable`,
    result.comparison.kind === 'unavailable' &&
      result.conclusion.kind === 'unavailable',
    'Incomplete, corrupt, stale, or incompatible evidence must not produce a revision verdict.',
  );

  return result;
});

const verifyFailures = Effect.fn('verifyFailures')(function* () {
  const fs = yield* FileSystem.FileSystem;

  const timeoutDirectory = path.join(evidence, 'timeout');

  yield* runCli(
    'timeout',
    [
      'capture',
      'base',
      '--output',
      timeoutDirectory,
      '--stall',
      '--timeout',
      '8000',
      '--json',
    ],
    45_000,
    'failure',
  );

  const timedOut = yield* parseCapture(
    yield* readText(path.join(timeoutDirectory, 'capture.json')),
  );

  yield* check(
    'timeout: manifest category',
    timedOut.execution.kind === 'failed' &&
      timedOut.execution.category === 'timeout',
    JSON.stringify(timedOut.execution),
  );

  yield* verifyCleanup('timeout', timeoutDirectory);

  const timeoutLedger = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ledgerSchema),
  )(yield* readText(path.join(timeoutDirectory, 'server-requests.json')));

  yield* check(
    'timeout: stalled request reached server',
    timeoutLedger.length === 1 && timeoutLedger[0]?.path === '/api/items',
    'The timeout must occur after the controlled API request, not during setup.',
  );

  const cancelledDirectory = path.join(evidence, 'cancelled');

  yield* Effect.gen(function* () {
    const { handle } = yield* startControlledCli('cancelled', [
      'capture',
      'base',
      '--output',
      cancelledDirectory,
      '--stall',
      '--timeout',
      '60000',
      '--json',
    ]);

    const transcript = path.join(cancelledDirectory, 'transcript.jsonl');

    yield* Effect.gen(function* () {
      while (true) {
        yield* check(
          'cancelled: capture alive before signal',
          yield* handle.isRunning,
          'Capture must still be running before the deliberate SIGTERM.',
        );

        if (yield* fs.exists(transcript)) {
          const lines = (yield* fs.readFileString(transcript))
            .split('\n')
            .slice(0, -1)
            .filter((line) => line.trim() !== '');

          const entries = yield* Effect.forEach(lines, (line) =>
            Schema.decodeUnknownEffect(
              Schema.fromJsonString(transcriptEntrySchema),
            )(line),
          );

          if (
            entries.some(
              (entry) =>
                entry.args.includes('click') && entry.outcome === 'complete',
            )
          ) {
            yield* save('cancelled.ready.json', {
              trigger: 'completed browser click in transcript',
              transcript,
            });

            return;
          }
        }

        yield* Effect.sleep('100 millis');
      }
    }).pipe(Effect.timeout('40 seconds'));

    yield* signalOwnedProcess('cancelled', handle.pid);

    const code = yield* handle.exitCode.pipe(Effect.timeout('25 seconds'));

    yield* check(
      'cancelled: nonzero exit',
      code !== 0,
      `SIGTERM exit code: ${code}.`,
    );
  }).pipe(Effect.scoped);

  const cancelled = yield* parseCapture(
    yield* readText(path.join(cancelledDirectory, 'capture.json')),
  );

  yield* check(
    'cancelled: manifest category',
    cancelled.execution.kind === 'failed' &&
      cancelled.execution.category === 'cancelled',
    JSON.stringify(cancelled.execution),
  );

  yield* verifyCleanup('cancelled', cancelledDirectory);

  const cancelledLedger = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ledgerSchema),
  )(yield* readText(path.join(cancelledDirectory, 'server-requests.json')));

  yield* check(
    'cancelled: stalled request reached server',
    cancelledLedger.length === 1 && cancelledLedger[0]?.path === '/api/items',
    'SIGTERM must interrupt the controlled browser action after its request starts.',
  );
});

const fetchArtifact = Effect.fn('fetchArtifact')(function* (
  url: string,
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { signal, redirect: 'manual' }),
    catch: (cause) => new HttpFailure({ cause }),
  }).pipe(Effect.timeout('5 seconds'));

  const bytes = new Uint8Array(
    yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (cause) => new HttpFailure({ cause }),
    }),
  );

  yield* fs.writeFile(path.join(evidence, name), bytes, { flag: 'wx' });

  yield* check(
    `${name}: HTTP status`,
    response.status === 200,
    `${url} returned ${response.status}.`,
  );

  return bytes;
});

const verifyViewer = Effect.fn('verifyViewer')(function* (
  directory: string,
  screenshotHash: string,
) {
  const url = yield* Effect.gen(function* () {
    const { handle, output } = yield* startControlledCli('viewer', [
      'view',
      directory,
      '--port',
      '0',
    ]);

    const origin = yield* Effect.gen(function* () {
      while (true) {
        const match = /^Observed: (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(
          yield* readText(output),
        );

        if (match?.[1] !== undefined) {
          return yield* Schema.decodeUnknownEffect(loopbackUrl)(match[1]);
        }

        if (!(yield* handle.isRunning)) {
          return yield* new AcceptanceFailure({
            check: 'viewer: readiness',
            detail: 'Viewer exited before printing its URL.',
          });
        }

        yield* Effect.sleep('100 millis');
      }
    }).pipe(Effect.timeout('30 seconds'));

    yield* fetchArtifact(origin, 'viewer-index.html');

    const resultBytes = yield* fetchArtifact(
      new URL('result.json', origin).toString(),
      'viewer-result.json',
    );

    const result = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(comparisonSchema),
    )(new TextDecoder().decode(resultBytes));

    yield* check(
      'viewer: live duplicate verdict',
      result.comparison.kind === 'available' &&
        result.candidate.check.outcome === 'failed' &&
        result.conclusion.kind === 'regression',
      'The served result must preserve the duplicate-request verdict.',
    );

    const image = yield* fetchArtifact(
      new URL('candidate/screenshot.png', origin).toString(),
      'viewer-screenshot.png',
    );

    yield* check(
      'viewer: evidence identity',
      digest(image) === screenshotHash,
      'Served screenshot must match the selected candidate bytes.',
    );

    const harBytes = yield* fetchArtifact(
      new URL('candidate/requests.har', origin).toString(),
      'viewer-requests.har',
    );

    const har = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(harSchema),
    )(new TextDecoder().decode(harBytes));

    yield* check(
      'viewer: raw evidence opens',
      har.log.entries.length === 2,
      'Served HAR must preserve both duplicate requests.',
    );

    yield* signalOwnedProcess('viewer', handle.pid);

    yield* handle.exitCode.pipe(Effect.timeout('15 seconds'));

    return origin;
  }).pipe(Effect.scoped);

  yield* assertStopped('viewer', url);
});

const acceptance = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(evidence, { recursive: true });

  yield* Console.log(`Acceptance evidence: ${evidence}`);

  const args = yield* Schema.decodeUnknownEffect(
    Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(1)),
  )(process.argv.slice(2));

  const packageInfo = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({ engines: Schema.Struct({ bun: Schema.String }) }),
    ),
  )(yield* readText(path.join(projectRoot, 'package.json')));

  yield* check(
    'pinned Bun',
    Bun.version === packageInfo.engines.bun,
    `Running ${Bun.version}; required ${packageInfo.engines.bun}.`,
  );

  const supplied = args[0];

  const demo =
    supplied === undefined
      ? path.join(evidence, 'demo')
      : path.resolve(supplied);

  yield* save('run.json', {
    projectRoot,
    demo,
    reusedDemo: supplied !== undefined,
    bun: Bun.version,
    startedAt: DateTime.formatIso(yield* DateTime.now),
  });

  yield* fs.makeDirectory(path.join(evidence, 'faults'));

  yield* fs.makeDirectory(path.join(evidence, 'reports'));

  if (supplied === undefined) {
    yield* runCli('demo', ['demo', '--output', demo, '--json'], 600_000);
  }

  const originals = yield* snapshotOriginals(demo);

  yield* save('originals.json', originals);

  const baseDirectory = path.join(demo, 'captures/base');

  const candidateDirectory = path.join(demo, 'captures/unchanged');

  const base = yield* verifyRawCapture('base', baseDirectory, 1);

  const unchanged = yield* verifyRawCapture('unchanged', candidateDirectory, 1);

  const duplicate = yield* verifyRawCapture(
    'duplicate',
    path.join(demo, 'captures/duplicate'),
    2,
  );

  const visual = yield* verifyRawCapture(
    'visual',
    path.join(demo, 'captures/visual'),
    1,
  );

  const verifyResults = Effect.gen(function* () {
    yield* check(
      'screenshots: unchanged and duplicate equal base',
      base.screenshotHash === unchanged.screenshotHash &&
        base.screenshotHash === duplicate.screenshotHash,
      'A duplicate network request must be observable despite identical screenshot bytes.',
    );

    yield* check(
      'screenshots: visual differs',
      base.screenshotHash !== visual.screenshotHash,
      'The intentional visual variant must produce different screenshot bytes.',
    );

    for (const expected of [
      {
        name: 'unchanged',
        count: 1,
        outcome: 'passed',
        conclusion: 'no-regression',
        visual: 'unchanged',
        capture: unchanged.manifest,
      },
      {
        name: 'duplicate',
        count: 2,
        outcome: 'failed',
        conclusion: 'regression',
        visual: 'unchanged',
        capture: duplicate.manifest,
      },
      {
        name: 'visual',
        count: 1,
        outcome: 'passed',
        conclusion: 'no-regression',
        visual: 'changed',
        capture: visual.manifest,
      },
    ] as const) {
      const result = yield* readComparison(
        path.join(demo, 'reports', expected.name),
      );

      yield* check(
        `${expected.name}: selected capture identities`,
        result.base.manifest?.id === base.manifest.id &&
          result.base.manifest.source.sha256 === base.manifest.source.sha256 &&
          result.candidate.manifest?.id === expected.capture.id &&
          result.candidate.manifest.source.sha256 ===
            expected.capture.source.sha256,
        'The report must refer to the actual base and candidate captures inspected above.',
      );

      yield* check(
        `${expected.name}: deterministic result`,
        result.base.check.outcome === 'passed' &&
          result.base.check.actual === 1 &&
          result.candidate.check.outcome === expected.outcome &&
          result.candidate.check.actual === expected.count &&
          result.conclusion.kind === expected.conclusion,
        'Result must match independently established request expectations.',
      );

      yield* check(
        `${expected.name}: comparable captures`,
        result.comparison.kind === 'available' &&
          result.comparison.requestDifference === expected.count - 1 &&
          result.comparison.visual === expected.visual,
        'Screenshot changes are observations, not an additional regression check.',
      );
    }
  });

  const missingBaseline = yield* readComparison(
    path.join(demo, 'reports/missing-baseline'),
  );

  yield* check(
    'missing baseline: absolute result retained',
    missingBaseline.comparison.kind === 'unavailable' &&
      missingBaseline.conclusion.kind === 'unavailable' &&
      missingBaseline.base.check.outcome === 'unknown' &&
      missingBaseline.candidate.check.outcome === 'passed',
    'An unavailable baseline must not erase a valid candidate absolute check.',
  );

  yield* verifyFailures();

  for (const fault of [
    'missing-har',
    'corrupt-screenshot',
    'corrupt-observations',
    'stale',
    'incompatible',
  ] as const) {
    const copy = path.join(evidence, 'faults', fault);

    yield* fs.copy(candidateDirectory, copy, { overwrite: false });

    yield* save(`${fault}.mutation.json`, {
      source: candidateDirectory,
      destination: copy,
      fault,
      sourceManifestSha256: digest(
        yield* fs.readFile(path.join(candidateDirectory, 'capture.json')),
      ),
    });

    if (fault === 'missing-har') {
      yield* fs.remove(path.join(copy, 'requests.har'));
    } else if (
      fault === 'corrupt-screenshot' ||
      fault === 'corrupt-observations'
    ) {
      const filename =
        fault === 'corrupt-screenshot' ? 'screenshot.png' : 'observations.json';

      const bytes = yield* fs.readFile(path.join(copy, filename));

      yield* fs.remove(path.join(copy, filename));

      yield* fs.writeFile(
        path.join(copy, filename),
        new Uint8Array([...bytes, 10]),
        { flag: 'wx' },
      );
    } else {
      const manifest = yield* parseCapture(
        yield* readText(path.join(copy, 'capture.json')),
      );

      if (manifest.conditions.kind !== 'recorded') {
        return yield* new AcceptanceFailure({
          check: `${fault}: prerequisite`,
          detail: 'Fault replay requires recorded conditions.',
        });
      }

      const modified =
        fault === 'stale'
          ? {
              ...manifest,
              startedAt: '2000-01-01T00:00:00.000Z',
              finishedAt: '2000-01-01T00:00:01.000Z',
            }
          : {
              ...manifest,
              conditions: {
                kind: 'recorded',
                value: {
                  ...manifest.conditions.value,
                  locale: 'acceptance-incompatible-locale',
                },
              },
            };

      const validated =
        yield* Schema.decodeUnknownEffect(captureSchema)(modified);

      yield* fs.remove(path.join(copy, 'capture.json'));

      yield* fs.writeFileString(
        path.join(copy, 'capture.json'),
        `${JSON.stringify(validated, null, 2)}\n`,
        { flag: 'wx' },
      );
    }

    const damagedBase =
      fault === 'missing-har' || fault === 'stale' || fault === 'incompatible';

    const result = yield* compareFault(
      fault,
      damagedBase ? copy : baseDirectory,
      damagedBase ? candidateDirectory : copy,
    );

    if (fault === 'incompatible') {
      yield* check(
        'incompatible: absolute checks retained',
        result.base.check.outcome === 'passed' &&
          result.candidate.check.outcome === 'passed' &&
          result.comparison.kind === 'unavailable' &&
          result.comparison.reasons.some((reason) =>
            reason.includes('conditions'),
          ),
        'Only the conditions compatibility requirement changed.',
      );
    } else {
      yield* check(
        `${fault}: unknown damaged side`,
        (damagedBase ? result.base : result.candidate).check.outcome ===
          'unknown' &&
          (damagedBase ? result.candidate : result.base).check.outcome ===
            'passed',
        'Artifact damage must remain unknown while the intact side retains its absolute result.',
      );

      if (fault === 'stale') {
        yield* check(
          'stale: explicit rejection',
          result.base.unresolved.some((reason) => reason.includes('stale')),
          'The copied historical timestamps must trigger the freshness requirement.',
        );
      }
    }
  }

  yield* verifyViewer(
    path.join(demo, 'reports/duplicate'),
    duplicate.screenshotHash,
  );

  for (const original of originals) {
    yield* check(
      'original capture remains immutable',
      digest(yield* fs.readFile(original.path)) === original.sha256,
      original.path,
    );
  }

  yield* verifyResults;

  yield* save('summary.json', {
    outcome: 'passed',
    demo,
    evidence,
    finishedAt: DateTime.formatIso(yield* DateTime.now),
  });

  yield* Console.log(`Acceptance passed. Evidence: ${evidence}`);
});

acceptance.pipe(
  Effect.scoped,
  Effect.onExit((exit) =>
    Exit.isFailure(exit)
      ? save('failure.json', {
          outcome: 'failed',
          cause: Cause.pretty(exit.cause),
        }).pipe(Effect.orDie)
      : Effect.void,
  ),
  Effect.provide(BunServices.layer),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
