import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { snapshotApplication } from '../src/capture/snapshot';

const directories: string[] = [];

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-snapshot-'));
  directories.push(root);
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app/start.sh'), '#!/bin/sh\nprintf hello\n');

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function snapshot(
  root: string,
  output: string,
  paths: readonly [string, ...string[]] = ['app'],
) {
  const directory = path.join(root, output);
  await mkdir(directory);

  return Effect.runPromise(
    snapshotApplication({
      projectRoot: root,
      directory,
      source: { entry: 'app/start.sh', paths },
      revision: null,
    }).pipe(Effect.provide(BunServices.layer)),
  );
}

test('rejects a selected path whose ancestor is a symlink', async () => {
  const root = await project();
  await symlink(path.join(root, 'app'), path.join(root, 'linked'));

  await expect(
    snapshot(root, 'capture', ['app', 'linked/start.sh']),
  ).rejects.toThrow(/symlink/);
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
  expect(after.files.map((file) => file.path)).toEqual([
    'app/asset.bin',
    'app/start.sh',
  ]);
  expect(
    new Uint8Array(
      await readFile(path.join(root, 'after/source/app/asset.bin')),
    ),
  ).toEqual(binary);
});

test('directory selection respects project ignore rules for untracked credentials', async () => {
  const root = await project();
  await writeFile(path.join(root, '.gitignore'), 'app/credentials.json\n');
  await writeFile(
    path.join(root, 'app/credentials.json'),
    '{"token":"sensitive-value"}',
  );
  const source = await snapshot(root, 'capture');

  expect(source.files.map((file) => file.path)).toEqual(['app/start.sh']);
});
