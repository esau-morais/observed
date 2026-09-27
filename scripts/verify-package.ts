// Installs a packed or published Observed outside any checkout and runs the
// Request lab example through it: an unchanged worktree must pass and a
// seeded duplicate request must regress.
//
//   bun scripts/verify-package.ts <tarball-or-package-spec> <new-work-directory> [--with-deps] [--commit <sha>]
import { Schema } from 'effect';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { comparisonSchema } from '../src/comparison-model';
import { captureSchema } from '../src/capture/model';

const [spec, work, ...rest] = process.argv.slice(2);

if (spec === undefined || work === undefined) {
  console.error(
    'Usage: bun scripts/verify-package.ts <tarball-or-package-spec> <new-work-directory> [--with-deps] [--commit <sha>]',
  );
  process.exit(64);
}

const withDeps = rest.includes('--with-deps');
const commitIndex = rest.indexOf('--commit');
const expectedCommit = commitIndex === -1 ? null : rest[commitIndex + 1];
const root = path.resolve(import.meta.dirname, '..');
const directory = path.resolve(work);
const install = path.join(directory, 'install');
const app = path.join(directory, 'app');
const elsewhere = path.join(directory, 'elsewhere');
const timings: Record<string, number> = {};

await mkdir(directory);

async function run(
  label: string,
  command: string[],
  cwd: string,
  expected = 0,
): Promise<string> {
  const started = performance.now();
  const child = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  timings[label] = Math.round(performance.now() - started);
  await Bun.write(
    path.join(directory, `${label}.log`),
    `$ ${command.join(' ')}\nexit ${String(code)}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`,
  );

  if (code !== expected) {
    throw new Error(
      `${label} exited ${String(code)}, expected ${String(expected)}. See ${label}.log\n${stderr.slice(-2000)}`,
    );
  }

  return stdout;
}

function fail(message: string): never {
  throw new Error(message);
}

const exportedSchema = Schema.fromJsonString(
  Schema.Struct({ directory: Schema.String, result: comparisonSchema }),
);

async function observe(label: string, expected: number) {
  const exported = Schema.decodeUnknownSync(exportedSchema)(
    await run(
      label,
      [observed, 'observe', app, '--base', 'HEAD', '--json'],
      elsewhere,
      expected,
    ),
  );

  if (!exported.directory.startsWith(path.join(app, '.observed') + path.sep)) {
    fail(
      `${label} wrote evidence outside ${app}/.observed: ${exported.directory}`,
    );
  }

  return exported;
}

const git = (label: string, ...args: string[]) =>
  run(
    label,
    [
      'git',
      '-c',
      'user.name=Observed package check',
      '-c',
      'user.email=package-check@observed.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    app,
  );

await mkdir(install);
await mkdir(elsewhere);
await Bun.write(path.join(install, 'package.json'), '{"private":true}\n');
await run(
  'install',
  ['bun', 'add', '--exact', '--ignore-scripts', spec],
  install,
);
const observed = path.join(install, 'node_modules/.bin/observed');
const version = (
  await run('version', [observed, '--version'], elsewhere)
).trim();
await run(
  'setup',
  [observed, 'setup', ...(withDeps ? ['--with-deps'] : [])],
  elsewhere,
);

await cp(path.join(root, 'examples/request-lab'), app, {
  recursive: true,
  filter: (source) =>
    !['node_modules', 'dist', '.observed'].includes(path.basename(source)),
});
await git('git-init', 'init', '--quiet');
await git('git-add', 'add', '--all');
await git('git-commit', 'commit', '--quiet', '-m', 'Request lab');

const unchanged = await observe('observe-unchanged', 0);

if (unchanged.result.conclusion.kind !== 'no-regression') {
  fail(`Unchanged run concluded ${unchanged.result.conclusion.kind}`);
}

const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(captureSchema))(
  await readFile(
    path.join(unchanged.directory, '..', 'captures/candidate/capture.json'),
    'utf8',
  ),
);

if (manifest.observed.source.kind !== 'git') {
  fail(
    `Observed's source was not recorded: ${manifest.observed.source.reason}`,
  );
}

if (
  expectedCommit !== null &&
  expectedCommit !== undefined &&
  manifest.observed.source.commit !== expectedCommit
) {
  fail(
    `Observed recorded commit ${manifest.observed.source.commit}, expected ${expectedCommit}`,
  );
}

await cp(path.join(app, 'duplicate.ts'), path.join(app, 'base.ts'));
const seeded = await observe('observe-seeded', 2);

if (seeded.result.conclusion.kind !== 'regression') {
  fail(`Seeded duplicate request concluded ${seeded.result.conclusion.kind}`);
}

const status = await git('git-status', 'status', '--porcelain');

if (status.trim() !== 'M base.ts') {
  fail(`Evidence changed the application's Git status:\n${status}`);
}

const summary = {
  spec,
  version,
  platform: `${process.platform}-${process.arch}`,
  bun: Bun.version,
  observedSource: manifest.observed.source,
  conclusions: {
    unchanged: unchanged.result.conclusion.kind,
    seeded: seeded.result.conclusion.kind,
  },
  evidence: (await readdir(path.join(app, '.observed'))).sort(),
  timingsMs: timings,
};

await Bun.write(
  path.join(directory, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));
