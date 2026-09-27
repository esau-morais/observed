import { BunServices } from '@effect/platform-bun';
import { Effect, Exit, Schema } from 'effect';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { playwright as collector } from '../src/capture/collectors/playwright';
import { checksForRun, testCheck } from '../src/checks/playwright';
import { sha256 } from '../src/encoding';
import {
  playwright,
  type PlaywrightTest,
  type PlaywrightValue,
} from '../src/evidence-kinds/playwright';
import { collectReport } from '../src/playwright/collect';
import { importPlaywright } from '../src/playwright/import';
import { parseHtmlReport, parseJsonReport } from '../src/playwright/report';
import { readZip, ZipError } from '../src/playwright/zip';

// Real Playwright 1.58.0 output from observed-trial-vite-react; see
// fixtures/playwright/README.md.
const fixtures = path.join(import.meta.dirname, 'fixtures/playwright');
const recordedWorkspace = '/tmp/observed-app-wSBHQ3';
const failedFolder =
  'test-results/shelves-shelves-opens-the-Finished-shelf-chromium';
const trace = path.join(
  fixtures,
  'html/data/6f2fa7b47baf56a581d6410c9e3f948533808f14.zip',
);
const screenshot = path.join(
  fixtures,
  'html/data/952b56389edfc69ed674a88ca3e801c76404fe48.png',
);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporary(): Promise<string> {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), 'observed-playwright-test-')),
  );
  directories.push(directory);

  return directory;
}

const run = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));

const runExit = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(BunServices.layer)));

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtures, name), 'utf8');
}

// Places the failed test's first-attempt trace and screenshot where the
// candidate report names them, under `workspace`.
async function workspaceWithAttachments(): Promise<{
  workspace: string;
  report: string;
}> {
  const workspace = await temporary();
  const folder = path.join(workspace, failedFolder);

  await mkdir(folder, { recursive: true });
  await copyFile(trace, path.join(folder, 'trace.zip'));
  await copyFile(screenshot, path.join(folder, 'test-failed-1.png'));

  return {
    workspace,
    report: (await fixture('candidate.json')).replaceAll(
      recordedWorkspace,
      workspace,
    ),
  };
}

function outcomes(
  tests: readonly { titlePath: readonly string[]; outcome: string }[],
) {
  return Object.fromEntries(
    tests.map((test) => [test.titlePath.join(' › '), test.outcome]),
  );
}

// Playwright's own line reporter printed "1 failed, 1 flaky, 1 skipped,
// 2 passed" for this run.
const seededOutcomes = {
  'shelves › starts with no shelf selected': 'expected',
  'shelves › opens the Reading shelf': 'expected',
  'shelves › opens the Finished shelf': 'unexpected',
  'shelves › exports the shelf as CSV': 'skipped',
  'shelves › keeps the count after a second click': 'flaky',
};

test('reads the same tests and outcomes from the JSON and HTML reports of one run', async () => {
  const json = await run(parseJsonReport(await fixture('candidate.json')));
  const html = await run(
    parseHtmlReport(
      await fixture('html/index.html'),
      path.join(fixtures, 'html'),
    ),
  );

  expect(outcomes(json.tests)).toEqual(seededOutcomes);
  expect(outcomes(html.tests)).toEqual(seededOutcomes);
  expect(html.tests.map((item) => item.id)).toEqual(
    json.tests.map((item) => item.id),
  );
  expect(json.stats).toEqual({
    expected: 2,
    unexpected: 1,
    flaky: 1,
    skipped: 1,
  });
  expect(json.version).toBe('1.58.0');
  expect(html.version).toBeNull();
});

test('only a test that passed as expected passes; flaky and skipped tests stay unknown', async () => {
  const report = await run(parseJsonReport(await fixture('candidate.json')));
  const value: PlaywrightValue = {
    ...report,
    exitCode: 1,
    tests: report.tests.map((item) => ({
      ...item,
      source: null,
      results: item.results.map((result) => ({
        ...result,
        attachments: [],
      })),
    })),
  };
  const checks = checksForRun(value);

  expect(
    Object.fromEntries(checks.map((check) => [check.name, check.outcome])),
  ).toEqual({
    'shelves › starts with no shelf selected': 'passed',
    'shelves › opens the Reading shelf': 'passed',
    'shelves › opens the Finished shelf': 'failed',
    'shelves › exports the shelf as CSV': 'unknown',
    'shelves › keeps the count after a second click': 'unknown',
  });
  expect(
    checks.every((check) => check.authority === 'Imported from Playwright'),
  ).toBe(true);
  expect(
    checks.find((check) => check.name === 'shelves › opens the Finished shelf')
      ?.detail,
  ).toBe(
    'Failed on all 2 attempts. Error: expect(locator).toHaveAttribute(expected) failed (Expected: "true", Received: "false")',
  );
});

function syntheticTest(
  outcome: PlaywrightTest['outcome'],
  overrides: Partial<PlaywrightTest> = {},
): PlaywrightTest {
  return {
    id: 'chromium › cart.spec.ts › adds an item',
    project: 'chromium',
    file: 'cart.spec.ts',
    source: null,
    line: 3,
    titlePath: ['adds an item'],
    outcome,
    expectedStatus: 'passed',
    annotations: [],
    results: [
      {
        retry: 0,
        status: 'passed',
        duration: 10,
        startedAt: '2026-09-27T06:00:00.000Z',
        error: null,
        attachments: [],
      },
    ],
    ...overrides,
  };
}

test('an expected failure passes, and an interrupted test is unknown', () => {
  expect(
    testCheck(
      syntheticTest('expected', {
        expectedStatus: 'failed',
        results: [
          {
            retry: 0,
            status: 'failed',
            duration: 10,
            startedAt: '2026-09-27T06:00:00.000Z',
            error: 'Error: known bug',
            attachments: [],
          },
        ],
      }),
    ),
  ).toMatchObject({
    outcome: 'passed',
    detail: 'Marked with test.fail() and failed, as expected.',
  });
  expect(
    testCheck(
      syntheticTest('skipped', {
        results: [
          {
            retry: 0,
            status: 'interrupted',
            duration: 10,
            startedAt: '2026-09-27T06:00:00.000Z',
            error: null,
            attachments: [],
          },
        ],
      }),
    ),
  ).toMatchObject({
    outcome: 'unknown',
    detail:
      'Interrupted before it finished. A skipped test is unknown, not passed.',
  });
});

test('a run with no tests, an error outside tests, or an unexplained exit code is unknown', () => {
  const empty: PlaywrightValue = {
    report: 'json',
    version: '1.58.0',
    exitCode: 1,
    startedAt: null,
    duration: 0,
    projects: ['chromium'],
    errors: ['Error: No tests found'],
    stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    tests: [],
  };

  expect(checksForRun(empty)).toEqual([
    expect.objectContaining({
      id: 'playwright-run',
      outcome: 'unknown',
      detail:
        'Playwright reported an error outside any test: Error: No tests found The report lists no tests.',
    }),
  ]);
  expect(
    checksForRun({
      ...empty,
      errors: [],
      stats: { ...empty.stats, expected: 1 },
      tests: [syntheticTest('expected')],
    }).map((check) => [check.id, check.outcome]),
  ).toEqual([
    ['playwright-run', 'unknown'],
    ['playwright: chromium › cart.spec.ts › adds an item', 'passed'],
  ]);
});

test('rejects a value whose tests disagree with the counts Playwright reported', () => {
  const value: PlaywrightValue = {
    report: 'json',
    version: '1.58.0',
    exitCode: 0,
    startedAt: null,
    duration: 0,
    projects: [],
    errors: [],
    stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 },
    tests: [syntheticTest('expected')],
  };

  expect(
    Exit.isFailure(
      Effect.runSyncExit(
        Schema.encodeUnknownEffect(playwright.file)({
          kind: 'playwright',
          schemaVersion: 1,
          value,
        }),
      ),
    ),
  ).toBe(true);
});

test('copies attachments inside the root and refuses paths outside it, including through a symlink', async () => {
  const { workspace, report } = await workspaceWithAttachments();
  const outside = await temporary();
  const secret = path.join(outside, 'secret.txt');
  const retryFolder = path.join(workspace, `${failedFolder}-retry1`);

  await writeFile(secret, 'not evidence\n');
  await mkdir(retryFolder, { recursive: true });
  await symlink(secret, path.join(retryFolder, 'error-context.md'));

  const directory = await temporary();
  const artifacts = new Map<string, string>();
  const parsed = await run(parseJsonReport(report));
  const value = await run(
    collectReport({
      report: {
        ...parsed,
        tests: parsed.tests.map((item) =>
          item.titlePath.at(-1) === 'opens the Finished shelf'
            ? {
                ...item,
                results: item.results.map((result) => ({
                  ...result,
                  attachments: [
                    ...result.attachments,
                    {
                      name: 'escape',
                      contentType: 'text/plain',
                      source: { kind: 'file', path: secret },
                    },
                  ],
                })),
              }
            : item,
        ),
      },
      exitCode: 1,
      root: workspace,
      workspace,
      directory,
      concealed: [],
      addArtifact: (id, filename) => {
        artifacts.set(id, filename);
      },
    }),
  );
  const failed = value.tests.find(
    (item) => item.titlePath.at(-1) === 'opens the Finished shelf',
  );
  const files = (retry: number) =>
    Object.fromEntries(
      (failed?.results[retry]?.attachments ?? []).map((item) => [
        item.name,
        item.file.kind === 'recorded' ? 'copied' : item.file.reason,
      ]),
    );

  expect(files(0)).toEqual({
    screenshot: 'copied',
    video: 'The attachment file does not exist',
    'error-context': 'The attachment file does not exist',
    trace: 'copied',
    escape: `The attachment file is outside ${workspace}, so Observed did not read it`,
  });
  expect(files(1)['error-context']).toBe(
    `The attachment file is outside ${workspace}, so Observed did not read it`,
  );
  expect([...artifacts.values()].some((file) => file.includes('secret'))).toBe(
    false,
  );

  const copiedTrace = failed?.results[0]?.attachments.find(
    (item) => item.name === 'trace',
  );

  expect(copiedTrace?.trace).toEqual({
    kind: 'recorded',
    title: 'shelves.spec.js:17 › shelves › opens the Finished shelf',
    browser: 'chromium',
    channel: 'chrome',
    playwrightVersion: '1.58.0',
    platform: 'linux',
    viewport: { width: 1280, height: 720 },
  });
  expect(
    sha256(
      await readFile(
        path.join(directory, artifacts.get('playwright-3-0-4') ?? 'missing'),
      ),
    ),
  ).toBe(sha256(await readFile(trace)));
  expect(failed?.source).toBe('e2e/shelves.spec.js');
});

test('rejects a trace zip with a corrupted entry instead of summarizing it', async () => {
  const bytes = new Uint8Array(await readFile(trace));
  const entries = readZip(bytes, 64 * 1024 * 1024);

  expect(
    new TextDecoder()
      .decode(entries.get('0-trace.trace')?.read())
      .startsWith('{"version":8,"type":"context-options"'),
  ).toBe(true);
  expect(() => readZip(bytes, 16).get('0-trace.trace')?.read()).toThrow(
    ZipError,
  );

  const damaged = bytes.slice();
  const offset = damaged.indexOf(0x78, 200);
  damaged[offset] = (damaged[offset] ?? 0) ^ 0xff;

  const read = () => {
    for (const entry of readZip(damaged, 64 * 1024 * 1024).values()) {
      entry.read();
    }
  };

  expect(read).toThrow(ZipError);
  expect(() => readZip(bytes.subarray(0, bytes.length - 30), 1024)).toThrow(
    ZipError,
  );
});

test('rejects a report that is not a Playwright report rather than importing nothing', async () => {
  const exit = await runExit(parseJsonReport('{"suites": []}'));

  expect(exit).toMatchObject({
    _tag: 'Failure',
  });
  expect(
    await runExit(parseHtmlReport('<html></html>', fixtures)),
  ).toMatchObject({ _tag: 'Failure' });
});

test('imports an HTML report as failed, with each test labelled imported and its trace copied unchanged', async () => {
  const output = path.join(await temporary(), 'import');
  const imported = await run(
    importPlaywright({
      input: path.join(fixtures, 'html'),
      root: null,
      directory: output,
      observedVersion: '0.1.0',
    }),
  );
  const markdown = await readFile(imported.report, 'utf8');
  const traceArtifact = imported.manifest.artifacts.find(
    (item) => item.id === 'playwright-3-0-4',
  );

  expect(imported.manifest.conclusion.kind).toBe('failed');
  expect(imported.manifest.summary).toEqual({
    passed: 2,
    failed: 1,
    unknown: 2,
    total: 5,
  });
  expect(imported.manifest.producer).toEqual({
    name: 'Playwright',
    version: '1.58.0',
  });
  expect(traceArtifact?.sha256).toBe(sha256(await readFile(trace)));
  expect(markdown).toContain(
    '`npx playwright show-trace playwright/3/0/4-6f2fa7b47baf56a581d6410c9e3f948533808f14.zip`',
  );
  expect(markdown).toContain(
    'Scope: Imported from Playwright: shelves\\.spec\\.js:17',
  );
  expect(markdown).toContain(
    'video unavailable: The attachment file does not exist',
  );
});

test("runs the app's command with its URL, keeps a failing exit, and reports a missing JSON report as unavailable", async () => {
  const { workspace, report } = await workspaceWithAttachments();
  const directory = await temporary();
  const collect = (script: string) =>
    runExit(
      collector.phase === 'command'
        ? collector.collect(
            {
              kind: 'playwright',
              command: ['sh', '-c', script],
              environment: ['E2E_PASSWORD'],
            },
            {
              directory,
              workspace,
              url: 'http://127.0.0.1:40123/',
              concealed: [],
              timeoutMs: 30_000,
              addArtifact: () => {},
              environment: new Map([['E2E_PASSWORD', 'fixture-only']]),
            },
          )
        : Effect.die('The Playwright collector runs a command'),
    );

  await writeFile(path.join(workspace, 'report.json'), report);

  const collected = await collect(
    'test "$BASE_URL" = http://127.0.0.1:40123 && test "$PORT" = 40123 && test "$E2E_PASSWORD" = fixture-only && cp report.json "$PLAYWRIGHT_JSON_OUTPUT_FILE"; exit 1',
  );

  expect(collected).toMatchObject({
    _tag: 'Success',
    value: { exitCode: 1, stats: { unexpected: 1 } },
  });

  await rm(path.join(directory, 'playwright'), { recursive: true });

  expect(await collect('exit 1')).toMatchObject({
    _tag: 'Failure',
    cause: {
      reasons: [
        {
          error: {
            _tag: 'EvidenceUnavailable',
            reason:
              "The Playwright command exited with code 1 without writing a JSON report. Enable the json reporter in the command, as in --reporter=line,json, and don't set its outputFile",
          },
        },
      ],
    },
  });
});

test('redacts a concealed value in text attachments and keeps no zip that holds one', async () => {
  const { workspace, report } = await workspaceWithAttachments();
  const folder = path.join(workspace, failedFolder);

  // The trace records the Finished button's name, standing in for a value
  // such as a test password.
  await writeFile(
    path.join(folder, 'error-context.md'),
    '- button "Finished" [active]\n',
  );

  const har = path.join(workspace, 'network.har');

  await writeFile(har, '{"text": "Finished"}\n');

  const parsed = await run(parseJsonReport(report));
  const directory = await temporary();
  const artifacts = new Map<string, string>();
  const value = await run(
    collectReport({
      report: {
        ...parsed,
        tests: parsed.tests.map((item) => ({
          ...item,
          results: item.results.map((result) => ({
            ...result,
            attachments: [
              ...result.attachments,
              {
                name: 'har',
                contentType: 'application/octet-stream',
                source: { kind: 'file', path: har },
              },
            ],
          })),
        })),
      },
      exitCode: 1,
      root: workspace,
      workspace,
      directory,
      concealed: ['Finished'],
      addArtifact: (id, filename) => {
        artifacts.set(id, filename);
      },
    }),
  );
  const attempt = value.tests.find(
    (item) => item.titlePath.at(-1) === 'opens the Finished shelf',
  )?.results[0];
  const byName = (name: string) =>
    attempt?.attachments.find((item) => item.name === name)?.file;

  expect(byName('trace')).toEqual({
    kind: 'unavailable',
    reason:
      'The file may hold a value from the collector environment, so Observed did not keep it',
  });
  expect(
    await readFile(
      path.join(directory, artifacts.get('playwright-3-0-3') ?? 'missing'),
      'utf8',
    ),
  ).toBe('- button "[REDACTED]" [active]\n');
  expect(byName('har')?.kind).toBe('unavailable');
  expect(byName('screenshot')?.kind).toBe('recorded');
});
