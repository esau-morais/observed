import path from 'node:path';
import { expect, test } from 'vitest';

test.each(['--json', '--json=true'])(
  '%s validation errors identify the input without polluting JSON stdout',
  async (jsonFlag) => {
    for (const args of [['--timeout', '0'], ['--unknown-option']]) {
      const child = Bun.spawn(
        [
          process.execPath,
          'src/workflow-cli.ts',
          'run',
          'examples/shop',
          jsonFlag,
          ...args,
        ],
        {
          cwd: path.resolve(import.meta.dirname, '..'),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(code).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain(args[0]);
      expect(stderr).toMatch(/greater|unknown|unrecognized/i);
    }
  },
);
