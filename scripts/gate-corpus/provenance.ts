import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function provenance(root: string) {
  async function git(...args: string[]) {
    const child = Bun.spawn(['git', ...args], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0) {
      throw new Error(`git ${args.join(' ')}: ${error}`);
    }

    return output;
  }

  const files = (await git('ls-files', '--others', '--exclude-standard', '-z'))
    .split('\0')
    .filter((file) => file !== '');
  const untracked = await Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: createHash('sha256')
        .update(await readFile(path.join(root, file)))
        .digest('hex'),
    })),
  );

  return {
    commit: (await git('rev-parse', 'HEAD')).trim(),
    diff: await git('diff', '--binary', 'HEAD'),
    status: await git('status', '--short'),
    untracked,
    bun: Bun.version,
  };
}
