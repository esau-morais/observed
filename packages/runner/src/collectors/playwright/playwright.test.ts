import { BunServices } from '@effect/platform-bun';
import { sha256 } from '@observed/judge';
import { Effect } from 'effect';
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
import { collectReport } from './collect';
import { runPlaywright } from './command';
import { parseJsonReport } from './report';
import { readZip, ZipError } from './zip';

// Real Playwright 1.58.0 output from the observed-trial-vite-react suite:
// candidate.json is the JSON report of a run where "opens the Finished shelf"
// failed, and trace.zip and screenshot.png are that test's first-attempt
// attachments. The report's paths start with the app copy it ran in.
const fixtures = path.join(import.meta.dirname, '../../../fixtures/playwright-report');
const recordedWorkspace = '/tmp/observed-app-wSBHQ3';
const failedFolder = 'test-results/shelves-shelves-opens-the-Finished-shelf-chromium';
const trace = path.join(fixtures, 'trace.zip');

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporary(): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'observed-playwright-')));
  directories.push(directory);

  return directory;
}

const run = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));

const runExit = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(BunServices.layer)));

// Places the failed test's first-attempt trace and screenshot where the
// report names them, under a new workspace.
async function workspaceWithAttachments() {
  const workspace = await temporary();
  const folder = path.join(workspace, failedFolder);

  await mkdir(folder, { recursive: true });
  await copyFile(trace, path.join(folder, 'trace.zip'));
  await copyFile(path.join(fixtures, 'screenshot.png'), path.join(folder, 'test-failed-1.png'));

  return {
    workspace,
    report: (await readFile(path.join(fixtures, 'candidate.json'), 'utf8')).replaceAll(
      recordedWorkspace,
      workspace,
    ),
  };
}

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
      addArtifact: ({ id, path: filename }) => {
        artifacts.set(id, filename);
      },
    }),
  );
  const failed = value.tests.find((item) => item.titlePath.at(-1) === 'opens the Finished shelf');
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
  expect([...artifacts.values()].some((file) => file.includes('secret'))).toBe(false);
  expect(failed?.results[0]?.attachments.find((item) => item.name === 'trace')?.trace).toEqual({
    kind: 'recorded',
    title: 'shelves.spec.js:17 › shelves › opens the Finished shelf',
    browser: 'chromium',
    channel: 'chrome',
    playwrightVersion: '1.58.0',
    platform: 'linux',
    viewport: { width: 1280, height: 720 },
  });
  expect(
    sha256(await readFile(path.join(directory, artifacts.get('playwright-3-0-4') ?? 'missing'))),
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
  expect(() => readZip(bytes, 16).get('0-trace.trace')?.read()).toThrow(ZipError);

  const damaged = bytes.slice();
  const offset = damaged.indexOf(0x78, 200);
  damaged[offset] = (damaged[offset] ?? 0) ^ 0xff;

  expect(() => {
    for (const entry of readZip(damaged, 64 * 1024 * 1024).values()) {
      entry.read();
    }
  }).toThrow(ZipError);
  expect(() => readZip(bytes.subarray(0, bytes.length - 30), 1024)).toThrow(ZipError);
});

test('names the Playwright version from the trace when the report records none', async () => {
  const { workspace, report } = await workspaceWithAttachments();
  const parsed = await run(parseJsonReport(report));
  const value = await run(
    collectReport({
      report: { ...parsed, version: null },
      exitCode: 1,
      root: workspace,
      workspace,
      directory: await temporary(),
      concealed: [],
      addArtifact: () => {},
    }),
  );

  expect(value.version).toBe('1.58.0');
});

test('rejects a report that is not a Playwright report rather than importing nothing', async () => {
  expect(await runExit(parseJsonReport('{"suites": []}'))).toMatchObject({ _tag: 'Failure' });
});

test("runs the app's command with its URL, keeps a failing exit, and reports a missing JSON report as unavailable", async () => {
  const { workspace, report } = await workspaceWithAttachments();
  const directory = await temporary();
  const collect = (script: string) =>
    runExit(
      runPlaywright({
        command: ['sh', '-c', script],
        environment: new Map([['E2E_PASSWORD', 'fixture-only']]),
        directory,
        workspace,
        url: 'http://127.0.0.1:40123/',
        concealed: [],
        timeoutMs: 30_000,
        addArtifact: () => {},
      }),
    );

  await writeFile(path.join(workspace, 'report.json'), report);

  expect(
    await collect(
      'test "$BASE_URL" = http://127.0.0.1:40123 && test "$PORT" = 40123 && test "$E2E_PASSWORD" = fixture-only && cp report.json "$PLAYWRIGHT_JSON_OUTPUT_FILE"; exit 1',
    ),
  ).toMatchObject({ _tag: 'Success', value: { exitCode: 1, stats: { unexpected: 1 } } });

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

  // The trace records the Finished button's name, standing in for a value
  // such as a test password.
  await writeFile(
    path.join(workspace, failedFolder, 'error-context.md'),
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
      addArtifact: ({ id, path: filename }) => {
        artifacts.set(id, filename);
      },
    }),
  );
  const attempt = value.tests.find((item) => item.titlePath.at(-1) === 'opens the Finished shelf')
    ?.results[0];
  const byName = (name: string) => attempt?.attachments.find((item) => item.name === name)?.file;

  expect(byName('trace')).toEqual({
    kind: 'unavailable',
    reason: 'The file may hold a value from the collector environment, so Observed did not keep it',
  });
  expect(
    await readFile(path.join(directory, artifacts.get('playwright-3-0-3') ?? 'missing'), 'utf8'),
  ).toBe('- button "[REDACTED]" [active]\n');
  expect(byName('har')?.kind).toBe('unavailable');
  expect(byName('screenshot')?.kind).toBe('recorded');
});
