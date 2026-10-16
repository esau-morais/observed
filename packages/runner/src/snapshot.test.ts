import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { snapshotSource } from './snapshot';

const directories: string[] = [];

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    ),
  }).trim();

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-snapshot-'));
  directories.push(root);
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app/start.sh'), '#!/bin/sh\nprintf hello\n');

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function snapshot(
  root: string,
  output: string,
  {
    paths = ['app'],
    revision = null,
  }: { paths?: readonly [string, ...string[]]; revision?: string | null } = {},
) {
  const directory = path.join(root, output);
  await mkdir(directory);

  return Effect.runPromise(
    snapshotSource({
      projectRoot: root,
      directory,
      source: { entry: 'app/start.sh', paths },
      revision,
    }).pipe(Effect.provide(BunServices.layer)),
  );
}

test('rejects a selected path whose ancestor is a symlink', async () => {
  const root = await project();
  await symlink(path.join(root, 'app'), path.join(root, 'linked'));

  await expect(snapshot(root, 'capture', { paths: ['app', 'linked/start.sh'] })).rejects.toThrow(
    /symlink/,
  );
});

test('source identity includes executable permissions and preserves binary and untracked files', async () => {
  const root = await project();
  const binary = new Uint8Array([0, 128, 255, 10]);
  await writeFile(path.join(root, 'app/asset.bin'), binary);
  await writeFile(path.join(root, 'app/.env'), 'SECRET=not-for-export');
  const before = await snapshot(root, 'before');
  await chmod(path.join(root, 'app/start.sh'), 0o755);
  const after = await snapshot(root, 'after');

  expect(before.sha256).not.toBe(after.sha256);
  expect(after.revision).toEqual({
    kind: 'worktree',
    head: {
      kind: 'unavailable',
      reason: 'Git did not list the project as a work tree; see source-transcript.jsonl',
    },
  });
  expect(after.files.map((file) => file.path)).toEqual(['app/asset.bin', 'app/start.sh']);
  expect(new Uint8Array(await readFile(path.join(root, 'after/source/app/asset.bin')))).toEqual(
    binary,
  );
});

test('a worktree snapshot in a repository without commits records HEAD as unavailable', async () => {
  const root = await project();
  git(root, 'init', '--quiet');

  expect((await snapshot(root, 'capture')).revision).toEqual({
    kind: 'worktree',
    head: { kind: 'unavailable', reason: 'The Git repository has no HEAD commit' },
  });
});

test('directory selection respects project ignore rules for untracked credentials', async () => {
  const root = await project();
  await writeFile(path.join(root, '.gitignore'), 'app/credentials.json\n');
  await writeFile(path.join(root, 'app/credentials.json'), '{"token":"sensitive-value"}');
  const source = await snapshot(root, 'capture');

  expect(source.files.map((file) => file.path)).toEqual(['app/start.sh']);
});

test('a revision snapshot reads the commit, not the working tree', async () => {
  const root = await project();
  git(root, 'init', '--quiet');
  await writeFile(path.join(root, '.gitignore'), '/base/\n/worktree/\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  const commit = git(root, 'rev-parse', 'HEAD');
  await writeFile(path.join(root, 'app/start.sh'), '#!/bin/sh\nprintf changed\n');

  const base = await snapshot(root, 'base', { revision: commit });
  const worktree = await snapshot(root, 'worktree');

  expect(base.revision).toEqual({ kind: 'commit', commit });
  expect(await readFile(path.join(root, 'base/source/app/start.sh'), 'utf8')).toContain('hello');
  expect(worktree.revision).toEqual({ kind: 'worktree', head: { kind: 'commit', commit } });
  expect(worktree.sha256).not.toBe(base.sha256);
});
