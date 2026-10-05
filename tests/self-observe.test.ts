import { Schema } from 'effect';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { comparisonSchema } from '../src/comparison-model';
import { projectSchema } from '../src/project';

test('self-observe setup produces the same regression report on separate runs', async () => {
  const repository = path.resolve(import.meta.dirname, '..');
  const project = Schema.decodeUnknownSync(
    Schema.fromJsonString(projectSchema),
  )(await readFile(path.join(repository, 'observed.json'), 'utf8'));
  const root = await mkdtemp(path.join(tmpdir(), 'observed-self-fixture-'));
  const reports: string[] = [];
  try {
    for (const run of ['first', 'second']) {
      const directory = path.join(root, run);
      const fixture = path.join(directory, 'tests/fixtures/self-observe');
      await mkdir(fixture, { recursive: true });
      await cp(
        path.join(repository, 'tests/fixtures/self-observe/captures.tar.gz'),
        path.join(fixture, 'captures.tar.gz'),
      );
      for (const name of ['src', 'node_modules']) {
        await symlink(path.join(repository, name), path.join(directory, name));
      }

      await mkdir(path.join(directory, 'dist/viewer'), { recursive: true });
      await writeFile(
        path.join(directory, 'dist/viewer/index.html'),
        '<title>Fixture</title>',
      );
      for (const command of project.setup.slice(2)) {
        const child = Bun.spawn([...command], {
          cwd: directory,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, `${stdout}\n${stderr}`).toBe(0);
      }

      const report = await readFile(
        path.join(directory, 'self-observe/result.json'),
        'utf8',
      );
      const result = Schema.decodeUnknownSync(
        Schema.fromJsonString(comparisonSchema),
      )(report);
      expect(result.conclusion.kind).toBe('regression');
      expect(result.evaluatedAt).toBe('2026-09-28T21:37:52.447Z');
      reports.push(report);
    }

    expect(reports[1]).toBe(reports[0]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
