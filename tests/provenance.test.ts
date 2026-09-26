import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { observedProvenance } from '../src/capture/provenance';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function observedRoot(parent: string) {
  await mkdir(parent, { recursive: true });
  await writeFile(
    path.join(parent, 'package.json'),
    JSON.stringify({ name: 'observed', version: '9.9.9-test' }),
  );

  return parent;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Observed test',
      '-c',
      'user.email=test@observed.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim();
}

function provenance(toolRoot: string) {
  return Effect.runPromise(
    observedProvenance({
      toolRoot,
      transcript: path.join(toolRoot, 'observed-transcript.jsonl'),
    }).pipe(Effect.provide(BunServices.layer)),
  );
}

async function temporary() {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-provenance-'));
  directories.push(directory);

  return directory;
}

test('records the commit as unavailable instead of borrowing an enclosing repository', async () => {
  const outside = await observedRoot(path.join(await temporary(), 'tarball'));

  expect(await provenance(outside)).toEqual({
    version: '9.9.9-test',
    source: {
      kind: 'unavailable',
      reason: "Git found no checkout at Observed's directory",
    },
  });

  const application = await temporary();
  git(application, 'init', '--quiet');
  git(application, 'commit', '--quiet', '--allow-empty', '-m', 'Application');
  const installed = await observedRoot(
    path.join(application, 'node_modules/observed'),
  );

  expect((await provenance(installed)).source).toEqual({
    kind: 'unavailable',
    reason: "Observed's directory is inside another Git checkout, not its own",
  });
});

test('flags tracked changes but not untracked files in Observed checkout', async () => {
  const root = await observedRoot(await temporary());
  git(root, 'init', '--quiet');
  git(root, 'add', 'package.json');
  git(root, 'commit', '--quiet', '-m', 'Observed');
  const commit = git(root, 'rev-parse', 'HEAD');

  await writeFile(path.join(root, 'untracked.ts'), 'export {};\n');
  expect((await provenance(root)).source).toEqual({
    kind: 'git',
    commit,
    trackedChanges: false,
  });

  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'observed', version: '9.9.10-test' }),
  );
  expect(await provenance(root)).toEqual({
    version: '9.9.10-test',
    source: { kind: 'git', commit, trackedChanges: true },
  });
});
