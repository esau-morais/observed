import { $ } from 'bun';
import { Schema } from 'effect';
import { chmod, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { build as buildViewer, type Plugin } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const readManifest = async (directory: string) =>
  Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        version: Schema.String,
        license: Schema.optional(Schema.String),
        repository: Schema.optional(
          Schema.Union([Schema.String, Schema.Struct({ url: Schema.String })]),
        ),
      }),
    ),
  )(await Bun.file(path.join(directory, 'package.json')).text());
const { version } = await readManifest(root);

async function git(...args: string[]) {
  const result = await $`git ${args}`.cwd(root).quiet().nothrow();

  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

const checkout = await git('rev-parse', '--verify', 'HEAD^{commit}');
// GitHub downloads an action pinned by SHA without its Git history, so
// action.yml passes that SHA to a source build on the runner.
const pinned = process.env.OBSERVED_SOURCE_COMMIT ?? '';
const downloaded =
  process.env.GITHUB_ACTIONS === 'true' && /^[0-9a-f]{40}$/.test(pinned)
    ? pinned
    : null;
const commit = checkout ?? downloaded;
const status =
  checkout === null
    ? null
    : await git('status', '--porcelain', '--untracked-files=no');
if (checkout !== null && status === null) {
  console.error(
    'git status failed, so the build cannot say whether it has changes',
  );
  process.exit(1);
}

const build = {
  version,
  commit,
  trackedChanges: status === null ? false : status !== '',
};

await rm(path.join(root, 'dist'), { recursive: true, force: true });

const bundled = new Set<string>();

function addPackages(files: Iterable<string>) {
  for (const file of files) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(file);

    if (match?.[1] !== undefined) {
      bundled.add(match[1]);
    }
  }
}

for (const [entry, name] of [
  ['src/workflow-cli.ts', 'observed.js'],
  ['scripts/github-action.ts', 'github-action.js'],
] as const) {
  const output = await Bun.build({
    entrypoints: [path.join(root, entry)],
    target: 'bun',
    naming: name,
    outdir: path.join(root, 'dist'),
    define: { OBSERVED_BUILD: JSON.stringify(build) },
    external: ['agent-browser'],
    banner: '#!/usr/bin/env bun',
    metafile: true,
  });

  if (!output.success) {
    for (const message of output.logs) {
      console.error(message);
    }

    process.exit(1);
  }

  addPackages(Object.keys(output.metafile?.inputs ?? {}));
}

const collectModules: Plugin = {
  name: 'observed-collect-modules',
  generateBundle() {
    addPackages(this.getModuleIds());
  },
};

await buildViewer({
  configFile: path.join(root, 'vite.config.ts'),
  plugins: [collectModules],
  logLevel: 'warn',
});

// Bundling drops the dependencies' own license files, which their licenses
// require to accompany the copies.
const notices: string[] = [];

// Packages offered under a choice of licenses, with the one Observed takes.
// EPL-2.0 asks a binary distribution to say where the source is.
const choices = new Map([
  [
    'elkjs',
    (version: string) =>
      `Observed distributes elkjs under EPL-2.0. Its source is at https://github.com/kieler/elkjs/tree/${version}.`,
  ],
]);

for (const name of [...bundled].sort()) {
  const directory = path.join(root, 'node_modules', name);
  const manifest = await readManifest(directory);
  const licenseFile = (await readdir(directory)).find((file) =>
    /^(?:licen[cs]e|copying)(?:\.|$)/i.test(file),
  );
  const repository =
    typeof manifest.repository === 'string'
      ? manifest.repository
      : manifest.repository?.url;

  if (
    licenseFile === undefined &&
    (manifest.license === undefined || repository === undefined)
  ) {
    console.error(`${name} names no license file, license and repository`);
    process.exit(1);
  }

  const choice = choices.get(name)?.(manifest.version);

  notices.push(
    `${name} ${manifest.version} (${manifest.license ?? 'see below'})\n\n${choice === undefined ? '' : `${choice}\n\n`}${
      licenseFile === undefined
        ? `The package ships no license file. Its license text is in ${String(repository)}.`
        : (await Bun.file(path.join(directory, licenseFile)).text()).trim()
    }`,
  );
}

await Bun.write(
  path.join(root, 'dist/THIRD-PARTY-NOTICES.txt'),
  `Observed's published files include code and fonts from these packages.\n\n${notices.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
);

await chmod(path.join(root, 'dist/observed.js'), 0o755);

console.log(
  `Built Observed ${version} from ${commit ?? 'an unknown commit'}${build.trackedChanges ? ' with uncommitted changes' : ''}`,
);
