import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { captureSchema } from '../../src/capture/model';
import { comparisonSchema } from '../../src/comparison-model';
import { json, sha256 } from '../../src/encoding';
import { projectSchema } from '../../src/project';
import { redactText } from '../../src/redact';
import { serveReport } from '../../src/view';

const root = path.resolve(import.meta.dirname, '../..');
let evidence: string;
let sequence = 0;

const exportedSchema = Schema.Struct({
  directory: Schema.String,
  result: comparisonSchema,
});
const harSchema = Schema.Struct({
  log: Schema.Struct({
    creator: Schema.Struct({ name: Schema.String, version: Schema.String }),
    entries: Schema.Array(
      Schema.Struct({
        request: Schema.Struct({
          method: Schema.String,
          url: Schema.URLFromString,
        }),
        response: Schema.Struct({ status: Schema.Number }),
      }),
    ),
  }),
});

async function readJson<S extends Schema.ConstraintDecoder<unknown>>(
  filename: string,
  schema: S,
) {
  return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(
    await readFile(filename, 'utf8'),
  );
}

async function command(
  args: string[],
  cwd = root,
  expected = 0,
  env?: Record<string, string | undefined>,
) {
  const child = Bun.spawn(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(env === undefined ? {} : { env }),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await writeFile(
    path.join(evidence, `command-${sequence++}.json`),
    json({ args, cwd, code, stdout, stderr }),
  );
  expect(code, stderr === '' ? stdout : stderr).toBe(expected);

  return stdout;
}

const projects = {
  'request-lab': 'examples/request-lab',
  shop: 'examples/shop',
  'access-code': 'tests/fixtures/access-code',
};

async function copyProject(name: keyof typeof projects, label: string) {
  const directory = path.join(evidence, label);
  await cp(path.join(root, projects[name]), directory, {
    recursive: true,
    filter: (source) =>
      !['node_modules', 'dist'].includes(path.basename(source)),
  });
  await command(['git', 'init', '--quiet'], directory);
  await command(['git', 'add', '.'], directory);
  await command(
    [
      'git',
      '-c',
      'user.name=Observed test',
      '-c',
      'user.email=test@observed.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'Test baseline',
    ],
    directory,
  );

  return directory;
}

async function observe(
  project: string,
  label: string,
  args: string[] = [],
  expected = 0,
  env?: Record<string, string | undefined>,
) {
  const output = path.join(evidence, label);
  const stdout = await command(
    [
      process.execPath,
      'run',
      'observe',
      project,
      '--json',
      '--output',
      output,
      ...args,
    ],
    root,
    expected,
    env,
  );

  return Schema.decodeUnknownSync(Schema.fromJsonString(exportedSchema))(
    stdout,
  );
}

async function cleanup(directory: string) {
  const server = await readJson(
    path.join(directory, 'server-cleanup.json'),
    Schema.Struct({
      pid: Schema.Number,
      stopped: Schema.Boolean,
      url: Schema.String,
    }),
  );
  expect(server.stopped).toBe(true);
  expect(() => process.kill(server.pid, 0)).toThrow();
  await expect(fetch(server.url)).rejects.toThrow();
}

async function rawCapture(
  directory: string,
  count: number,
  method: string,
  endpoint: string,
  status: number,
) {
  const har = await readJson(path.join(directory, 'requests.har'), harSchema);
  expect(har.log.creator).toEqual({ name: 'agent-browser', version: '0.38.1' });
  expect(
    har.log.entries.map((entry) => ({
      method: entry.request.method,
      path: entry.request.url.pathname,
      status: entry.response.status,
    })),
  ).toEqual(
    Array.from({ length: count }, () => ({ method, path: endpoint, status })),
  );
  const ledger = (
    await readFile(path.join(directory, 'application.log'), 'utf8')
  )
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) =>
      Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({ method: Schema.String, path: Schema.String }),
        ),
      )(line),
    );
  expect(ledger).toEqual(
    Array.from({ length: count }, () => ({ method, path: endpoint })),
  );
  const manifest = await readJson(
    path.join(directory, 'capture.json'),
    captureSchema,
  );
  expect(manifest.execution.kind).toBe('complete');
  const closed = await readJson(
    path.join(directory, 'browser-cleanup.json'),
    Schema.Struct({ active: Schema.Boolean }),
  );
  expect(closed.active).toBe(false);
  await cleanup(directory);

  return manifest;
}

// Screenshot bytes are not asserted: the duplicate response re-renders the list,
// and Chromium can then rasterize antialiased edges one intensity level apart.
async function pageTree(directory: string) {
  const snapshot = await readJson(
    path.join(directory, 'snapshot.json'),
    Schema.Struct({
      data: Schema.Struct({ snapshot: Schema.String, refs: Schema.Unknown }),
    }),
  );

  return snapshot.data;
}

async function viewer(
  directory: string,
  mode: 'preview' | 'comparison',
  sourceHash: string,
  highlightedRegions = 0,
) {
  await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* serveReport({ directory, port: 0 });
      yield* Effect.promise(async () => {
        const session = `observed-view-${Date.now()}-${sequence++}`;
        const config = path.join(evidence, `${session}.json`);
        await writeFile(config, '{}\n');
        const browser = (...args: string[]) =>
          command([
            process.execPath,
            'node_modules/agent-browser/bin/agent-browser.js',
            '--config',
            config,
            '--session',
            session,
            '--headed',
            'false',
            '--args',
            '--no-sandbox',
            '--no-webmcp',
            '--json',
            ...args,
          ]);

        try {
          await browser('open', String(url));
          await browser('wait', '#screenshots');
          const extract = Schema.Struct({
            success: Schema.Literal(true),
            data: Schema.Struct({
              result: Schema.Struct({
                images: Schema.Number,
                text: Schema.String,
                detailsOpen: Schema.Boolean,
                height: Schema.Number,
                imageTop: Schema.Number,
              }),
            }),
          });
          const output = await browser(
            'eval',
            '-b',
            Buffer.from(
              '({images: document.querySelectorAll("#screenshots a img").length, text: document.querySelector("#report").innerText, detailsOpen: document.querySelector("main details").open, height: innerHeight, imageTop: document.querySelector("#report img").getBoundingClientRect().top})',
            ).toString('base64'),
          );
          const viewed = Schema.decodeUnknownSync(
            Schema.fromJsonString(extract),
          )(output).data.result;
          expect(viewed.images).toBe(mode === 'preview' ? 1 : 2);
          expect(viewed.text).toContain(sourceHash.slice(0, 12));
          expect(viewed.detailsOpen).toBe(false);
          expect(viewed.imageTop).toBeLessThan(viewed.height);

          if (mode === 'preview') {
            expect(viewed.text).not.toMatch(
              /Baseline|Before and after|No capture directory|After/,
            );
          }

          await browser(
            'screenshot',
            path.join(evidence, `viewer-${mode}.png`),
          );
          await browser('focus', 'main > details > summary');
          await browser('press', 'Enter');
          const opened = await browser(
            'eval',
            'document.querySelector("main details").open',
          );
          expect(
            Schema.decodeUnknownSync(
              Schema.fromJsonString(
                Schema.Struct({
                  data: Schema.Struct({ result: Schema.Boolean }),
                }),
              ),
            )(opened).data.result,
          ).toBe(true);
          if (highlightedRegions > 0) {
            const regions = async () =>
              Schema.decodeUnknownSync(
                Schema.fromJsonString(
                  Schema.Struct({
                    data: Schema.Struct({ count: Schema.Number }),
                  }),
                ),
              )(await browser('get', 'count', '[data-region]')).data.count;
            expect(await regions()).toBe(0);
            await browser('focus', 'input[type=checkbox]');
            await browser('press', 'Space');
            expect(await regions()).toBe(highlightedRegions * 2);
            const crops = await browser(
              'eval',
              '[...document.querySelectorAll("[aria-labelledby=changed-regions] img")].filter((image) => image.complete && image.naturalWidth > 0).length',
            );
            expect(
              Schema.decodeUnknownSync(
                Schema.fromJsonString(
                  Schema.Struct({
                    data: Schema.Struct({ result: Schema.Number }),
                  }),
                ),
              )(crops).data.result,
            ).toBe(highlightedRegions * 2);
            await browser(
              'screenshot',
              path.join(evidence, 'viewer-highlighted.png'),
            );
            const diff = await fetch(new URL('visual-diff.png', String(url)));
            expect(diff.status).toBe(200);
            expect(sha256(new Uint8Array(await diff.arrayBuffer()))).toBe(
              sha256(await readFile(path.join(directory, 'visual-diff.png'))),
            );
          }

          const response = await fetch(
            new URL('candidate/requests.har', String(url)),
          );
          expect(response.status).toBe(200);
          expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(
            sha256(
              await readFile(path.join(directory, 'candidate/requests.har')),
            ),
          );
        } finally {
          await browser('close');
        }
      });
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
}

beforeAll(async () => {
  await mkdir(path.join(root, 'evidence'), { recursive: true });
  evidence = await mkdtemp(path.join(root, 'evidence/project-verification-'));
  console.log(`Browser evidence: ${evidence}`);
});

test('compares a React commit with a duplicate-request worktree through the public command', async () => {
  const project = await copyProject('request-lab', 'react-app');
  await cp(path.join(project, 'duplicate.ts'), path.join(project, 'base.ts'));
  const result = await observe(
    project,
    'react-duplicate',
    ['--base', 'HEAD'],
    2,
  );
  expect(result.result.conclusion.kind).toBe('regression');
  expect(result.result.comparison.kind).toBe('available');
  expect(['identical', 'below-threshold']).toContain(
    result.result.comparison.kind === 'available'
      ? result.result.comparison.visual.kind
      : result.result.comparison.kind,
  );
  const before = await rawCapture(
    path.join(result.directory, 'base'),
    1,
    'GET',
    '/api/items',
    200,
  );
  const after = await rawCapture(
    path.join(result.directory, 'candidate'),
    2,
    'GET',
    '/api/items',
    200,
  );
  expect(before.source.sha256).not.toBe(after.source.sha256);
  expect(before.source.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(after.source.revision).toBe('worktree');
  expect(await pageTree(path.join(result.directory, 'candidate'))).toEqual(
    await pageTree(path.join(result.directory, 'base')),
  );
  await viewer(result.directory, 'comparison', after.source.sha256);

  const previewed = Schema.decodeUnknownSync(
    Schema.fromJsonString(exportedSchema),
  )(
    await command(
      [
        process.execPath,
        'run',
        'compare',
        'none',
        path.join(result.directory, 'candidate'),
        '--json',
        '--output',
        path.join(evidence, 'react-duplicate-preview'),
      ],
      root,
      2,
    ),
  );
  expect(previewed.result.comparison.kind).toBe('preview');
  expect(previewed.result.conclusion.kind).toBe('check-failed');

  await cp(path.join(project, 'visual.ts'), path.join(project, 'base.ts'));
  const visual = await observe(project, 'react-visual', ['--base', 'HEAD']);
  expect(visual.result.comparison).toMatchObject({
    kind: 'available',
    visual: { kind: 'changed', regionCount: 1 },
  });
  expect(visual.result.candidate.check.outcome).toBe('passed');
  await viewer(
    visual.directory,
    'comparison',
    visual.result.candidate.capture?.manifest.source.sha256 ?? 'no capture',
    1,
  );
});

test('previews a non-React app without checks and then applies its own POST expectation', async () => {
  const project = await copyProject('shop', 'shop-app');
  const preview = await observe(project, 'shop-preview');
  expect(preview.result.comparison.kind).toBe('preview');
  expect(preview.result.candidate.check.outcome).toBe('not-run');
  const captured = await rawCapture(
    path.join(preview.directory, 'candidate'),
    1,
    'POST',
    '/orders',
    201,
  );
  const relocated = path.join(evidence, 'shop-preview-relocated');
  await rename(preview.directory, relocated);
  await viewer(relocated, 'preview', captured.source.sha256);
  const config = await readJson(
    path.join(project, 'observed.json'),
    projectSchema,
  );
  await writeFile(
    path.join(project, 'observed.json'),
    json({
      ...config,
      capture: {
        ...config.capture,
        check: {
          kind: 'request-count',
          id: 'order-once',
          name: 'One order',
          scope: 'One form submission',
          method: 'POST',
          path: '/orders',
          expectedCount: 1,
          status: 201,
        },
      },
    }),
  );
  const compared = await observe(project, 'shop-compared', ['--base', 'HEAD']);
  expect(compared.result.comparison.kind).toBe('available');
  expect(compared.result.candidate.check).toMatchObject({
    outcome: 'passed',
    actual: 1,
  });
  const missing = await observe(
    project,
    'shop-missing-base',
    ['--base', 'no-such-revision'],
    1,
  );
  expect(missing.result.comparison.kind).toBe('unavailable');
  expect(missing.result.candidate.check.outcome).toBe('passed');
  expect(missing.result.base.unresolved.join(' ')).toContain(
    'no-such-revision',
  );
  expect(missing.result.base.unresolved.join(' ')).toContain(
    'Needed a single revision',
  );
});

test('redacted text cannot satisfy a literal text expectation', async () => {
  const project = await copyProject('shop', 'shop-redacted-text');
  const config = await readJson(
    path.join(project, 'observed.json'),
    projectSchema,
  );
  const app = await readFile(path.join(project, 'app.ts'), 'utf8');
  await writeFile(
    path.join(project, 'app.ts'),
    app.replace(
      '`Order received for ${input.value}`',
      "'Authorization: Bearer disposable-value'",
    ),
  );
  await writeFile(
    path.join(project, 'observed.json'),
    json({
      ...config,
      capture: {
        ...config.capture,
        steps: [
          { kind: 'fill', selector: '#name', value: 'Ada' },
          { kind: 'click-role', role: 'button', name: 'Place order' },
          { kind: 'network-idle' },
        ],
        check: {
          kind: 'text',
          id: 'status',
          name: 'Status text',
          scope: 'After submitting',
          selector: '[role="status"]',
          expectedText: 'Authorization: [REDACTED]',
        },
      },
    }),
  );
  const result = await observe(project, 'shop-redacted-result', [], 1);
  expect(result.result.candidate.check.outcome).toBe('unknown');
  expect(result.result.candidate.screenshot).toBeNull();
  expect(result.result.candidate.unresolved.join(' ')).toContain(
    'Text observation contains credentials',
  );
});

const transcriptSchema = Schema.Struct({
  args: Schema.Array(Schema.String),
  stdout: Schema.String,
});

async function transcript(directory: string) {
  const filename = path.join(directory, 'transcript.jsonl');

  if (!(await Bun.file(filename).exists())) {
    return [];
  }

  return (await readFile(filename, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) =>
      Schema.decodeUnknownSync(Schema.fromJsonString(transcriptSchema))(line),
    );
}

test.each([
  { label: 'filled', selector: '#code', exit: 0 },
  { label: 'unmatched', selector: '#missing-code', exit: 1 },
])(
  'an environment fill value that is $label reaches no evidence file or command output',
  async ({ label, selector, exit }) => {
    const project = await copyProject('access-code', `access-code-${label}`);
    // Escaped and encoded copies keep the marker verbatim. Generic redaction
    // must leave it too, so a clean bundle shows the known value was concealed.
    const marker = randomUUID();
    const secret = `Heron "${marker}" lantern/?&`;
    expect(
      redactText(
        json({
          selector,
          value: secret,
          path: `/session/${encodeURIComponent(secret)}`,
        }),
      ).split(marker),
    ).toHaveLength(3);
    const config = await readJson(
      path.join(project, 'observed.json'),
      projectSchema,
    );
    await writeFile(
      path.join(project, 'observed.json'),
      json({
        ...config,
        capture: {
          ...config.capture,
          steps: config.capture.steps.map((step) =>
            step.kind === 'fill' ? { ...step, selector } : step,
          ),
          check: {
            kind: 'text',
            id: 'accepted',
            name: 'Accepted code',
            scope: 'After signing in',
            selector: '[role="status"]',
            expectedText: `Accepted ${new Bun.CryptoHasher('sha256').update(secret).digest('hex')}`,
          },
        },
      }),
    );
    const result = await observe(
      project,
      `access-code-${label}-result`,
      [],
      exit,
      { ...process.env, OBSERVED_ACCESS_CODE: secret },
    );
    const capture = path.join(
      evidence,
      `access-code-${label}-result/captures/candidate`,
    );
    const fills = (await transcript(capture)).filter(
      (record) => record.args.at(-2) === 'batch',
    );
    expect(fills).toHaveLength(1);

    if (exit === 0) {
      expect(result.result.candidate.check.outcome).toBe('passed');
      expect(
        await readFile(path.join(capture, 'application.log'), 'utf8'),
      ).toContain('/session/[REDACTED]');
    } else {
      expect(result.result.candidate.execution).toBe('capture-failed');
      expect(result.result.candidate.check.outcome).not.toBe('passed');
    }

    const leaks: string[] = [];

    for (const entry of await readdir(evidence, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) {
        continue;
      }

      const filename = path.join(entry.parentPath, entry.name);
      const bytes = await readFile(filename);

      if (bytes.includes(marker)) {
        leaks.push(filename);
      }
    }

    expect(leaks).toEqual([]);
  },
);

test.each([
  { label: 'unset', value: undefined },
  { label: 'empty', value: '' },
])(
  'an $label fill variable fails the capture instead of filling a blank value',
  async ({ label, value }) => {
    const project = await copyProject('access-code', `access-code-${label}`);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== 'OBSERVED_ACCESS_CODE',
      ),
    );
    const result = await observe(
      project,
      `access-code-${label}-result`,
      [],
      1,
      {
        ...env,
        ...(value === undefined ? {} : { OBSERVED_ACCESS_CODE: value }),
      },
    );
    expect(result.result.candidate.execution).toBe('capture-failed');
    expect(result.result.candidate.check.outcome).not.toBe('passed');
    expect(result.result.conclusion.kind).toBe('unavailable');
    const capture = path.join(
      evidence,
      `access-code-${label}-result/captures/candidate`,
    );
    const manifest = await readJson(
      path.join(capture, 'capture.json'),
      captureSchema,
    );
    expect(manifest.execution).toMatchObject({
      kind: 'failed',
      category: 'configuration',
      reason:
        'Fill value unavailable. Missing or empty environment variables: OBSERVED_ACCESS_CODE',
    });
    expect(
      (await transcript(capture)).filter((record) =>
        record.args.some((arg) => arg === 'fill' || arg === 'batch'),
      ),
    ).toEqual([]);
  },
);

test('additional origins preserve previews and keep same-path request checks separate', async () => {
  const requests: string[] = [];
  const backend = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);

      return new Response('accepted', {
        status: 202,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    },
  });
  const origin = backend.url.origin;
  try {
    const project = await copyProject('shop', 'shop-origins');
    const config = await readJson(
      path.join(project, 'observed.json'),
      projectSchema,
    );
    const app = await readFile(path.join(project, 'app.ts'), 'utf8');
    await writeFile(
      path.join(project, 'app.ts'),
      app.replace(
        '.then((response) => {',
        `.then(async (response) => { await fetch(${JSON.stringify(`${origin}/orders`)}, { method: 'POST' });`,
      ),
    );
    const check = {
      kind: 'request-count',
      id: 'order',
      name: 'One order',
      scope: 'One submission',
      method: 'POST',
      path: '/orders',
      expectedCount: 1,
      status: 201,
    };
    for (const scenario of [
      {
        label: 'unconfigured',
        allowed: false,
        check: undefined,
        outcome: 'unknown',
        exit: 1,
      },
      {
        label: 'preview',
        allowed: true,
        check: undefined,
        outcome: 'not-run',
        exit: 0,
      },
      {
        label: 'application',
        allowed: true,
        check,
        outcome: 'passed',
        exit: 0,
      },
      {
        label: 'backend',
        allowed: true,
        check: { ...check, origin, status: 202 },
        outcome: 'passed',
        exit: 0,
      },
    ]) {
      await writeFile(
        path.join(project, 'observed.json'),
        json({
          ...config,
          capture: {
            ...config.capture,
            ...(scenario.allowed ? { allowedOrigins: [origin] } : {}),
            ...(scenario.check === undefined ? {} : { check: scenario.check }),
          },
        }),
      );
      const result = await observe(
        project,
        `origins-${scenario.label}`,
        [],
        scenario.exit,
      );
      expect(result.result.candidate.screenshot).not.toBeNull();
      expect(result.result.candidate.check.outcome).toBe(scenario.outcome);
      const har = await readJson(
        path.join(result.directory, 'candidate/requests.har'),
        harSchema,
      );
      expect(
        har.log.entries.map((entry) => ({
          origin:
            entry.request.url.origin === origin ? 'backend' : 'application',
          path: entry.request.url.pathname,
          status: entry.response.status,
        })),
      ).toEqual([
        { origin: 'application', path: '/orders', status: 201 },
        { origin: 'backend', path: '/orders', status: 202 },
      ]);
      if (scenario.allowed) {
        expect(result.result.candidate.execution).toBe('complete');
        if (scenario.check !== undefined) {
          expect(result.result.candidate.check.actual).toBe(1);
        }
      } else {
        expect(result.result.candidate.execution).toBe('capture-failed');
      }

      await cleanup(path.join(result.directory, 'candidate'));
    }

    expect(requests).toEqual(Array.from({ length: 4 }, () => 'POST /orders'));
  } finally {
    await backend.stop(true);
  }
});

test.each(['timeout', 'cancelled'] as const)(
  'retains a failed %s capture and stops the owned application',
  async (failure) => {
    const project = await copyProject('shop', `shop-${failure}`);
    const config = await readJson(
      path.join(project, 'observed.json'),
      projectSchema,
    );
    await writeFile(
      path.join(project, 'observed.json'),
      json({
        ...config,
        capture: {
          ...config.capture,
          steps: [{ kind: 'wait-text', text: 'Never rendered' }],
        },
      }),
    );
    const output = path.join(evidence, `capture-${failure}`);
    const child = Bun.spawn(
      [
        process.execPath,
        'run',
        'capture',
        project,
        '--output',
        output,
        '--timeout',
        failure === 'timeout' ? '8000' : '30000',
        '--json',
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );

    try {
      if (failure === 'cancelled') {
        await expect
          .poll(
            () => Bun.file(path.join(output, 'environment.json')).exists(),
            { timeout: 15000 },
          )
          .toBe(true);
        child.kill('SIGINT');
      }

      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      await writeFile(
        path.join(evidence, `${failure}-command.json`),
        json({ code, stdout, stderr }),
      );
      const capture = await readJson(
        path.join(output, 'capture.json'),
        captureSchema,
      );
      expect(capture.execution).toMatchObject({
        kind: 'failed',
        category: failure,
      });
      const browserCleanup = await readJson(
        path.join(output, 'browser-cleanup.json'),
        Schema.Struct({ active: Schema.Boolean }),
      );
      expect(browserCleanup.active).toBe(false);
      await cleanup(output);
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await child.exited;
      }
    }
  },
);

test('bun start opens the example from a fresh checkout without an app path', async () => {
  const checkout = path.join(evidence, 'fresh-checkout');
  await mkdir(checkout);

  for (const entry of [
    'src',
    'viewer',
    'scripts',
    'examples',
    'package.json',
    'bun.lock',
    '.gitignore',
    'vite.config.ts',
    'tsconfig.json',
    'tsconfig.build.json',
  ]) {
    await cp(path.join(root, entry), path.join(checkout, entry), {
      recursive: true,
      filter: (source) =>
        !['node_modules', 'dist'].includes(path.basename(source)),
    });
  }

  await command(['git', 'init', '--quiet'], checkout);
  const child = Bun.spawn([process.execPath, 'start'], {
    cwd: checkout,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let stdout = '';
  const output = (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      stdout += decoder.decode(chunk.value, { stream: true });
    }
  })();
  const errors = new Response(child.stderr).text();

  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) {
            throw new Error(`Startup exited: ${stdout}\n${await errors}`);
          }

          return stdout;
        },
        { timeout: 90_000 },
      )
      .toContain('Observed: http://');
    const match = /Observed: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout);
    const url = match?.[1];

    if (url === undefined) {
      throw new Error('Viewer URL missing from startup output');
    }

    const response = await fetch(new URL('result.json', url));
    const result = Schema.decodeUnknownSync(
      Schema.fromJsonString(comparisonSchema),
    )(await response.text());
    expect(result.mode).toBe('preview');
    expect(result.candidate.execution).toBe('complete');
    expect(result.candidate.check.outcome).toBe('passed');
  } finally {
    child.kill('SIGINT');
    await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull();
    await output;
    await writeFile(
      path.join(evidence, 'single-command-start.json'),
      json({ stdout, stderr: await errors, code: child.exitCode }),
    );
  }
});
