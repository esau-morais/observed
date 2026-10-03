import { Schema } from 'effect';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { captureSchema } from '../../src/capture/model';
import { json } from '../../src/encoding';
import { evidenceKinds } from '../../src/evidence-kinds';
import { projectSchema } from '../../src/project';

const root = path.resolve(import.meta.dirname, '../..');
let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'observed-coverage-'));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  text: string,
) => Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text);

async function copyExample(name: 'shop' | 'request-lab', label: string) {
  const directory = path.join(workspace, label);

  await cp(path.join(root, 'examples', name), directory, {
    recursive: true,
    filter: (source) =>
      !['node_modules', 'dist'].includes(path.basename(source)),
  });

  return directory;
}

async function editProject(
  project: string,
  edit: (
    config: typeof projectSchema.Type,
  ) => Record<string, unknown> & typeof projectSchema.Type,
) {
  const filename = path.join(project, 'observed.json');
  const config = decodeJson(projectSchema, await readFile(filename, 'utf8'));

  await writeFile(filename, json(edit(config)));
}

async function capture(project: string, label: string) {
  const output = path.join(workspace, `${label}-capture`);
  const child = Bun.spawn(
    [process.execPath, 'run', 'capture', project, '--output', output, '--json'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(code, stderr).toBe(0);

  const manifest = decodeJson(
    captureSchema,
    await readFile(path.join(output, 'capture.json'), 'utf8'),
  );

  return { output, manifest };
}

async function coverageOf(output: string) {
  return decodeJson(
    evidenceKinds.coverage.file,
    await readFile(path.join(output, 'evidence', 'coverage.json'), 'utf8'),
  ).value;
}

// The one line of a snapshot file whose text contains `needle` lies in
// `ranges`.
async function expectLineIn(
  output: string,
  file: string,
  needle: string,
  ranges: readonly (readonly [number, number])[] | undefined,
) {
  const text = await readFile(path.join(output, 'source', file), 'utf8');
  const lines = text
    .split('\n')
    .flatMap((line, index) => (line.includes(needle) ? [index + 1] : []));
  const [line] = lines;

  expect(lines, needle).toHaveLength(1);
  expect(
    line !== undefined &&
      ranges?.some(([start, end]) => start <= line && line <= end),
    `${file}:${String(line)} in ${JSON.stringify(ranges)}`,
  ).toBe(true);
}

// The environment capture gives setup commands. Vitest's NODE_ENV=test
// would build a different bundle.
const setupEnvironment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'en_US.UTF-8',
  TZ: 'UTC',
};

function patch(text: string, from: string, to: string): string {
  expect(text).toContain(from);

  return text.replace(from, to);
}

// The call count of the innermost function holding `offset` in the script
// whose address ends with `script`, read from the raw DevTools output.
async function rawCount(output: string, script: string, offset: number) {
  const raw = decodeJson(
    rawSchema,
    await readFile(path.join(output, 'coverage-raw.json'), 'utf8'),
  );
  const functions =
    raw.result.find((entry) => entry.url.endsWith(script))?.functions ?? [];

  expect(offset).toBeGreaterThanOrEqual(0);

  return functions
    .flatMap((item) => item.ranges.slice(0, 1))
    .filter((range) => range.startOffset <= offset && offset < range.endOffset)
    .toSorted(
      (left, right) =>
        left.endOffset -
        left.startOffset -
        (right.endOffset - right.startOffset),
    )[0]?.count;
}

const rawSchema = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      functions: Schema.Array(
        Schema.Struct({
          ranges: Schema.Array(
            Schema.Struct({
              startOffset: Schema.Number,
              endOffset: Schema.Number,
              count: Schema.Number,
            }),
          ),
        }),
      ),
    }),
  ),
});

test('a minified bundle with a linked map resolves the triggered handler as executed and the never-called one as unexecuted', async () => {
  const project = await copyExample('shop', 'shop-mapped');
  const build: [string, ...string[]] = [
    'bun',
    'build',
    'app.ts',
    '--outdir',
    'dist',
    '--target',
    'browser',
    '--minify',
    '--sourcemap=linked',
  ];

  await editProject(project, (config) => ({ ...config, setup: [build] }));

  const server = await readFile(path.join(project, 'server.ts'), 'utf8');

  await writeFile(
    path.join(project, 'server.ts'),
    patch(
      server,
      "    if (pathname === '/app.js') {",
      "    if (pathname === '/app.js.map') {\n      return new Response(Bun.file(`${root}/dist/app.js.map`));\n    }\n\n    if (pathname === '/app.js') {",
    ),
  );

  const { output, manifest } = await capture(project, 'shop-mapped');

  expect(manifest.execution).toEqual({ kind: 'complete' });

  const coverage = await coverageOf(output);
  const app = coverage.files.find((file) => file.path === 'app.ts');

  expect(coverage.scripts).toEqual([
    { script: '/app.js', kind: 'mapped', files: ['app.ts'], excluded: [] },
  ]);

  await expectLineIn(output, 'app.ts', 'Order received for', app?.executed);
  await expectLineIn(output, 'app.ts', "= 'Order failed'", app?.unexecuted);
  await expectLineIn(output, 'app.ts', 'markup is incomplete', app?.unexecuted);

  // The setup command reproduces the bundle the browser ran, so the raw
  // counts can be read without the source map: the innermost function
  // holding each status text ran once and never.
  expect(
    Bun.spawnSync(build, { cwd: project, env: setupEnvironment }).exitCode,
  ).toBe(0);

  const bundle = await readFile(path.join(project, 'dist', 'app.js'), 'utf8');

  expect(
    await rawCount(output, '/app.js', bundle.indexOf('Order received for')),
  ).toBe(1);
  expect(
    await rawCount(output, '/app.js', bundle.lastIndexOf('Order failed')),
  ).toBe(0);
});

test('a script without a source map records the reason and no ranges', async () => {
  const project = await copyExample('shop', 'shop-unmapped');
  const { output } = await capture(project, 'shop-unmapped');
  const coverage = await coverageOf(output);

  expect(coverage.files).toEqual([]);
  expect(coverage.scripts).toHaveLength(1);
  expect(coverage.scripts[0]).toMatchObject({
    script: '/app.js',
    kind: 'unavailable',
  });
  expect(
    coverage.scripts[0]?.kind === 'unavailable'
      ? coverage.scripts[0].reason
      : '',
  ).toMatch(/^No source map: \/app\.js\.map: HTTP 404/);
});

test('a map that embeds a different copy of a file excludes that file and keeps the others', async () => {
  const project = await copyExample('request-lab', 'request-lab');
  const { output } = await capture(project, 'request-lab');
  const coverage = await coverageOf(output);
  const items = coverage.files.find((file) => file.path === 'items.ts');
  const [script] = coverage.scripts;

  expect(coverage.files.map((file) => file.path)).not.toContain('App.tsx');
  expect(script).toMatchObject({
    kind: 'mapped',
    excluded: [
      {
        path: 'App.tsx',
        reason:
          "The source map's copy of this file differs from the source snapshot, so its line numbers would not match",
      },
    ],
  });
  await expectLineIn(output, 'items.ts', "fetch('/api/items'", items?.executed);
  await expectLineIn(output, 'items.ts', 'throw new Error', items?.unexecuted);

  // App.tsx has no lines, so its handlers are read from the raw output in
  // the bundle the setup commands reproduce: the click handler that sets
  // the loading state ran, and the .catch callback that sets the failed
  // state never did.
  for (const command of [
    ['bun', 'install', '--frozen-lockfile'],
    ['bun', 'run', 'build'],
  ]) {
    expect(
      Bun.spawnSync(command, { cwd: project, env: setupEnvironment }).exitCode,
    ).toBe(0);
  }

  const name = script?.script ?? '';
  const bundle = await readFile(path.join(project, 'dist', name), 'utf8');

  expect(
    await rawCount(output, name, bundle.search(/kind:[`'"]loading[`'"]/)),
  ).toBe(1);
  expect(
    await rawCount(output, name, bundle.search(/kind:[`'"]failed[`'"]/)),
  ).toBe(0);
});

test('a journey can turn coverage off, which opens no coverage session', async () => {
  const project = await copyExample('shop', 'shop-off');

  await editProject(project, (config) => ({
    ...config,
    capture: {
      ...(config.capture ?? {
        name: 'missing',
        path: '/',
        ready: [],
        steps: [],
      }),
      collectors: [{ kind: 'coverage', enabled: false }],
    },
  }));

  const { output, manifest } = await capture(project, 'shop-off');

  expect(manifest.evidence.find((item) => item.kind === 'coverage')).toEqual({
    kind: 'coverage',
    schemaVersion: 1,
    status: 'unavailable',
    reason: 'Coverage is turned off for this journey in observed.json',
    producer: { name: 'agent-browser', version: '0.38.1' },
  });
  expect(
    await Bun.file(path.join(output, 'browser-cleanup-coverage.json')).exists(),
  ).toBe(false);
});

const transcriptSchema = Schema.Struct({
  args: Schema.Array(Schema.String),
  stdout: Schema.optionalKey(Schema.String),
});

test('a capture cancelled during the coverage journey closes its browser session', async () => {
  const project = await copyExample('shop', 'shop-cancelled');
  const server = await readFile(path.join(project, 'server.ts'), 'utf8');

  // Each order takes 4 seconds, so the coverage journey is still running
  // when the capture is cancelled.
  await writeFile(
    path.join(project, 'server.ts'),
    patch(
      patch(
        server,
        "    if (pathname === '/orders' && request.method === 'POST') {",
        "    if (pathname === '/orders' && request.method === 'POST') {\n      await Bun.sleep(4000);",
      ),
      '  fetch(request) {',
      '  async fetch(request) {',
    ),
  );

  const output = path.join(workspace, 'shop-cancelled-capture');
  const transcript = path.join(output, 'transcript.jsonl');
  const child = Bun.spawn(
    [process.execPath, 'run', 'capture', project, '--output', output, '--json'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  );
  const entries = async () =>
    (await Bun.file(transcript).exists())
      ? (await readFile(transcript, 'utf8'))
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => decodeJson(transcriptSchema, line))
      : [];

  try {
    // The coverage session opens the page right after it reads the DevTools
    // address and starts coverage.
    await expect
      .poll(
        async () => {
          const all = await entries();
          const address = all.findIndex((entry) =>
            entry.args.join(' ').endsWith('get cdp-url'),
          );

          return (
            address >= 0 &&
            all.slice(address + 1).some((entry) => entry.args.includes('open'))
          );
        },
        { timeout: 60_000, interval: 100 },
      )
      .toBe(true);
    child.kill('SIGINT');

    expect(await child.exited).not.toBe(0);

    const manifest = decodeJson(
      captureSchema,
      await readFile(path.join(output, 'capture.json'), 'utf8'),
    );

    expect(manifest.execution).toMatchObject({
      kind: 'failed',
      category: 'cancelled',
    });

    const cleanup = decodeJson(
      Schema.Struct({ active: Schema.Boolean }),
      await readFile(
        path.join(output, 'browser-cleanup-coverage.json'),
        'utf8',
      ),
    );

    expect(cleanup.active).toBe(false);

    const reply = (await entries()).find((entry) =>
      entry.args.join(' ').endsWith('get cdp-url'),
    )?.stdout;
    const address = decodeJson(
      Schema.Struct({ data: Schema.Struct({ cdpUrl: Schema.String }) }),
      reply ?? '',
    ).data.cdpUrl;
    const closed = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(address);

      socket.addEventListener('open', () => {
        socket.close();
        resolve(false);
      });
      socket.addEventListener('error', () => {
        resolve(true);
      });
    });

    expect(closed).toBe(true);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await child.exited;
    }
  }
});
