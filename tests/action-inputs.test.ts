import { Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const actionSchema = Schema.Struct({
  runs: Schema.Struct({
    steps: Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        run: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
});

test.each(['', 'evidence/a journey; $(touch injected).json'])(
  'the action forwards generated file %j as one argument and preserves capture failure',
  async (generated) => {
    const action = Schema.decodeUnknownSync(actionSchema)(
      Bun.YAML.parse(await readFile('action.yml', 'utf8')),
    );
    const step = action.runs.steps.find(({ name }) => name === 'Run Observed');
    if (step?.run === undefined) {
      throw new Error('Capture step is missing');
    }

    const root = await mkdtemp(path.join(tmpdir(), 'observed-action-input-'));
    try {
      const cli = path.join(root, 'cli.ts');
      const output = path.join(root, 'output');
      const args = path.join(root, 'args.json');
      await writeFile(
        cli,
        'const file = process.env.ARGS; if (!file) throw new Error("Missing output path"); await Bun.write(file, JSON.stringify(process.argv.slice(2))); process.exit(1);',
      );
      const child = Bun.spawn(['bash', '-e', '-c', step.run], {
        cwd: root,
        env: {
          ...process.env,
          RUNNER_TEMP: root,
          GITHUB_OUTPUT: output,
          OBSERVED_CLI: cli,
          OBSERVED_PROJECT: 'examples/app',
          OBSERVED_BASE: 'base',
          OBSERVED_CANDIDATE: 'head',
          OBSERVED_TIMEOUT: '120000',
          OBSERVED_GENERATED: generated,
          ARGS: args,
        },
        stdout: 'ignore',
        stderr: 'pipe',
      });
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(code, stderr).toBe(0);
      const received = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Array(Schema.String)),
      )(await readFile(args, 'utf8'));
      expect(received.slice(0, 8)).toEqual([
        'observe',
        'examples/app',
        '--base',
        'base',
        '--candidate',
        'head',
        '--timeout',
        '120000',
      ]);
      expect(received.slice(10)).toEqual(
        generated === '' ? ['--json'] : ['--generated', generated, '--json'],
      );
      expect(await readFile(output, 'utf8')).toContain('exit-code=1\n');
      expect(await Bun.file(path.join(root, 'injected')).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
