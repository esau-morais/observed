import { Schema } from 'effect';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'packages/runner/fixtures/request-lab');
const runs = Schema.decodeUnknownSync(
  Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
)(process.argv[2] ?? '5');
// The bar for running after every agent turn: three times the median the
// docs page reports. A slower median fails the script.
const ceilingMs = 15_000;

const timingsSchema = Schema.Struct({
  prepare: Schema.Struct({ base: Schema.Number, candidate: Schema.Number }),
  captures: Schema.Array(
    Schema.Struct({
      journey: Schema.Number,
      side: Schema.Literals(['base', 'candidate']),
      ms: Schema.Number,
    }),
  ),
  judge: Schema.Number,
  total: Schema.Number,
});
const resultSchema = Schema.Struct({
  conclusion: Schema.Struct({ kind: Schema.String }),
  journeys: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      conclusion: Schema.Struct({ kind: Schema.String }),
    }),
  ),
});
const readJson = async <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  file: string,
) => Schema.decodeUnknownSync(Schema.fromJsonString(schema))(await readFile(file, 'utf8'));

async function command(args: string[], cwd: string) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (args[0] === 'git' && exitCode !== 0) {
    throw new Error(`${args.join(' ')}: ${stderr}`);
  }

  return { exitCode, stdout, stderr };
}

const workspace = await mkdtemp(join(tmpdir(), 'observed-request-lab-'));
const project = join(workspace, 'project');
const git = async (...args: string[]) =>
  (
    await command(
      ['git', '-c', 'user.name=Observed', '-c', 'user.email=measure@example.invalid', ...args],
      project,
    )
  ).stdout.trim();

await cp(fixture, project, {
  recursive: true,
  filter: (source) => !source.includes('node_modules') && !source.includes('/dist'),
});
await git('init', '--quiet', '-b', 'main');
await git('add', '.');
await git('commit', '--quiet', '-m', 'base');
const base = await git('rev-parse', 'HEAD');
const app = join(project, 'App.tsx');
await writeFile(app, (await readFile(app, 'utf8')).replace("from './base'", "from './duplicate'"));
await git('commit', '--quiet', '-am', 'candidate sends two requests per click');
const candidate = await git('rev-parse', 'HEAD');

const expected = {
  exitCode: 2,
  conclusion: 'regression',
  journeys: { 'Load items': 'regression', Heading: 'no-regression' },
};
const measured = [];
const problems: string[] = [];

for (let run = 1; run <= runs; run += 1) {
  const output = join(workspace, `run-${run}`);
  const started = performance.now();
  const execution = await command(
    [
      process.execPath,
      join(root, 'packages/cli/src/main.ts'),
      'run',
      project,
      '--base',
      base,
      '--candidate',
      candidate,
      '--output',
      output,
    ],
    root,
  );
  const wallMs = Math.round(performance.now() - started);

  if (execution.exitCode !== expected.exitCode) {
    problems.push(`run ${run}: exit ${execution.exitCode}\n${execution.stderr}`);
    continue;
  }

  const result = await readJson(resultSchema, join(output, 'result.json'));
  const journeys = Object.fromEntries(
    result.journeys.map((journey) => [journey.title, journey.conclusion.kind]),
  );

  if (
    result.conclusion.kind !== expected.conclusion ||
    JSON.stringify(journeys) !== JSON.stringify(expected.journeys)
  ) {
    problems.push(`run ${run}: ${JSON.stringify({ conclusion: result.conclusion, journeys })}`);
  }

  if (run === 1) {
    const printed = await command(
      [process.execPath, join(root, 'packages/cli/src/main.ts'), 'receipt', candidate],
      project,
    );

    if (
      printed.exitCode !== 0 ||
      !/failed +One request per load action · base 1 · candidate 2/.test(printed.stdout)
    ) {
      problems.push(
        `receipt after run 1: exit ${printed.exitCode}\n${printed.stdout}\n${printed.stderr}`,
      );
    }
  }

  measured.push({ run, wallMs, ...(await readJson(timingsSchema, join(output, 'timings.json'))) });
}

const walls = measured.map((item) => item.wallMs).sort((left, right) => left - right);
const median = walls[Math.floor(walls.length / 2)];

if (median !== undefined && median > ceilingMs) {
  problems.push(`median wall time ${median} ms is over the ${ceilingMs} ms ceiling`);
}

console.log(
  JSON.stringify({ bun: Bun.version, platform: process.platform, median, measured }, null, 2),
);

if (problems.length > 0 || measured.length !== runs) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  await rm(workspace, { recursive: true, force: true });
}
