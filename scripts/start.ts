import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const project =
  args.length === 0 &&
  !(await Bun.file(path.join(root, 'observed.json')).exists())
    ? ['examples/request-lab']
    : args;
let child: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}

for (const command of [
  [process.execPath, 'install', '--frozen-lockfile'],
  [process.execPath, 'run', 'setup'],
  [process.execPath, 'src/workflow-cli.ts', 'run', ...project],
]) {
  if (interrupted) {
    process.exit(130);
  }

  child = Bun.spawn(command, {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await child.exited;

  if (code !== 0) {
    process.exit(code);
  }
}
