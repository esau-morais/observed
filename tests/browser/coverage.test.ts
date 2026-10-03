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

// The line numbers of a snapshot file whose text contains `needle`.
async function linesWith(output: string, file: string, needle: string) {
  const text = await readFile(path.join(output, 'source', file), 'utf8');

  return text
    .split('\n')
    .flatMap((line, index) => (line.includes(needle) ? [index + 1] : []));
}

const within = (
  line: number,
  ranges: readonly (readonly [number, number])[],
): boolean => ranges.some(([start, end]) => start <= line && line <= end);

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
    server.replace(
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

  const [received] = await linesWith(output, 'app.ts', 'Order received for');
  const [failed] = await linesWith(output, 'app.ts', "= 'Order failed'");
  const [incomplete] = await linesWith(
    output,
    'app.ts',
    'markup is incomplete',
  );

  expect(received !== undefined && within(received, app?.executed ?? [])).toBe(
    true,
  );
  expect(failed !== undefined && within(failed, app?.unexecuted ?? [])).toBe(
    true,
  );
  expect(
    incomplete !== undefined && within(incomplete, app?.unexecuted ?? []),
  ).toBe(true);

  // The same build reproduces the bundle the browser ran, so the raw counts
  // can be read without the source map: the innermost function holding each
  // status text ran once and never.
  const rebuilt = Bun.spawnSync(build, { cwd: project });

  expect(rebuilt.exitCode).toBe(0);

  const bundle = await readFile(path.join(project, 'dist', 'app.js'), 'utf8');
  const raw = decodeJson(
    rawSchema,
    await readFile(path.join(output, 'coverage-raw.json'), 'utf8'),
  );
  const functions =
    raw.result.find((script) => script.url.endsWith('/app.js'))?.functions ??
    [];
  const innermostCount = (offset: number) =>
    functions
      .map((item) => item.ranges[0])
      .filter(
        (range) =>
          range !== undefined &&
          range.startOffset <= offset &&
          offset < range.endOffset,
      )
      .toSorted(
        (left, right) =>
          (left?.endOffset ?? 0) -
          (left?.startOffset ?? 0) -
          ((right?.endOffset ?? 0) - (right?.startOffset ?? 0)),
      )[0]?.count;

  expect(innermostCount(bundle.indexOf('Order received for'))).toBe(1);
  expect(innermostCount(bundle.lastIndexOf('Order failed'))).toBe(0);
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
  const [requested] = await linesWith(output, 'items.ts', "fetch('/api/items'");
  const [thrown] = await linesWith(output, 'items.ts', 'throw new Error');

  expect(coverage.files.map((file) => file.path)).not.toContain('App.tsx');
  expect(coverage.scripts).toMatchObject([
    {
      kind: 'mapped',
      excluded: [
        {
          path: 'App.tsx',
          reason:
            "The source map's copy of this file differs from the source snapshot, so its line numbers would not match",
        },
      ],
    },
  ]);
  expect(
    requested !== undefined && within(requested, items?.executed ?? []),
  ).toBe(true);
  expect(thrown !== undefined && within(thrown, items?.unexecuted ?? [])).toBe(
    true,
  );
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
    server
      .replace(
        "    if (pathname === '/orders' && request.method === 'POST') {",
        "    if (pathname === '/orders' && request.method === 'POST') {\n      await Bun.sleep(4000);",
      )
      .replace('  fetch(request) {', '  async fetch(request) {'),
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
