import { Schema } from 'effect';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { comparisonSchema } from '../../src/comparison-model';
import { json } from '../../src/encoding';

const root = path.resolve(import.meta.dirname, '../..');
let evidence: string;
let sequence = 0;

beforeAll(async () => {
  evidence = await mkdtemp(path.join(root, 'evidence', 'react-browser-'));
});

async function command(args: string[], cwd = root, expected = 0) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
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

const recorderSchema = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      result: Schema.Struct({
        commits: Schema.Number,
        components: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            mounts: Schema.Number,
            updates: Schema.Number,
          }),
        ),
      }),
    }),
  }),
);

const consoleSchema = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      messages: Schema.Array(Schema.Struct({ text: Schema.String })),
    }),
  }),
);

const commitMessage = 'observed-test App commit';

const harSchema = Schema.fromJsonString(
  Schema.Struct({
    log: Schema.Struct({
      entries: Schema.Array(
        Schema.Struct({
          request: Schema.Struct({ url: Schema.URLFromString }),
        }),
      ),
    }),
  }),
);

async function raw(directory: string) {
  const recorder = Schema.decodeUnknownSync(recorderSchema)(
    await readFile(path.join(directory, 'react-renders.json'), 'utf8'),
  );
  const messages = Schema.decodeUnknownSync(consoleSchema)(
    await readFile(path.join(directory, 'console.json'), 'utf8'),
  );
  const har = Schema.decodeUnknownSync(harSchema)(
    await readFile(path.join(directory, 'requests.har'), 'utf8'),
  );

  return {
    app: recorder.data.result.components.find((item) => item.name === 'App'),
    commits: messages.data.messages.filter(
      (message) => message.text === commitMessage,
    ).length,
    requests: har.log.entries.map((entry) => entry.request.url.pathname),
  };
}

test('an added App render fails the react-renders check as a regression', async () => {
  const project = path.join(evidence, 'request-lab');
  await cp(path.join(root, 'examples/request-lab'), project, {
    recursive: true,
    filter: (source) =>
      !['node_modules', 'dist'].includes(path.basename(source)),
  });

  // Keep component names through minification so the check can name App.
  const build = path.join(project, 'build.ts');
  await writeFile(
    build,
    (await readFile(build, 'utf8')).replace(
      "build: { outDir: 'dist' },",
      "build: { outDir: 'dist' },\n  esbuild: { keepNames: true },",
    ),
  );
  // An independent count: the main journey's browser, which has no DevTools
  // hook, logs one message per committed App render, including the mount.
  const app = path.join(project, 'App.tsx');
  await writeFile(
    app,
    (await readFile(app, 'utf8'))
      .replace(
        "import { useRef, useState } from 'react';",
        "import { useLayoutEffect, useRef, useState } from 'react';",
      )
      .replace(
        '  const inFlight = useRef(false);',
        `  const inFlight = useRef(false);\n  useLayoutEffect(() => {\n    console.info('${commitMessage}');\n  });`,
      ),
  );
  const config = path.join(project, 'observed.json');
  const fields = Schema.Record(Schema.String, Schema.Unknown);
  const observed = Schema.decodeUnknownSync(Schema.fromJsonString(fields))(
    await readFile(config, 'utf8'),
  );
  const capture = Object.entries(
    Schema.decodeUnknownSync(fields)(observed.capture),
  ).filter(([key]) => key !== 'check');
  const configured = {
    ...observed,
    capture: {
      ...Object.fromEntries(capture),
      checks: [
        {
          kind: 'react-renders',
          id: 'app-renders',
          name: 'App renders at most twice',
          scope: 'One Load items click through the loaded list.',
          component: 'App',
          maxRenders: 2,
        },
      ],
    },
  };
  await writeFile(config, json(configured));

  await command(['git', 'init', '--quiet'], project);
  await command(['git', 'add', '.'], project);
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
    project,
  );

  // Loading and loaded are two commits. The seeded timer commits a third
  // with an equal but new state object, so App renders once more.
  await writeFile(
    app,
    (await readFile(app, 'utf8')).replace(
      "setState({ kind: 'loaded', items });",
      "setState({ kind: 'loaded', items });\n        setTimeout(() => setState({ kind: 'loaded', items }), 0);",
    ),
  );

  const output = path.join(evidence, 'react-regression');
  const result = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({ directory: Schema.String, result: comparisonSchema }),
    ),
  )(
    await command(
      [
        process.execPath,
        'run',
        'observe',
        project,
        '--base',
        'HEAD',
        '--json',
        '--output',
        output,
      ],
      root,
      2,
    ),
  );

  expect(result.result.conclusion.kind).toBe('regression');
  const [journey] = result.result.journeys;
  const check = (side: 'base' | 'candidate') =>
    journey[side].checks.find((item) => item.id === 'app-renders');
  expect(check('base')).toMatchObject({ outcome: 'passed', actual: 2 });
  expect(check('candidate')).toMatchObject({ outcome: 'failed', actual: 3 });

  const before = await raw(path.join(result.directory, 'journey-1', 'base'));
  const after = await raw(
    path.join(result.directory, 'journey-1', 'candidate'),
  );
  expect(before.app).toEqual({ name: 'App', mounts: 0, updates: 2 });
  expect(after.app).toEqual({ name: 'App', mounts: 0, updates: 3 });
  expect(before.commits).toBe(1 + 2);
  expect(after.commits).toBe(1 + 3);
  // The React run is separate: the journey's own HAR holds only its request.
  expect(before.requests).toEqual(['/api/items']);
  expect(after.requests).toEqual(['/api/items']);
});
