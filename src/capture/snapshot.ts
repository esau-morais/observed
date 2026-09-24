import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { sourceSchema, type Source } from './model';
import { json, sha256 } from './recipe';

export const variantSchema = Schema.Literals(['base', 'duplicate', 'visual']);

export type Variant = typeof variantSchema.Type;

export const snapshotApplication = Effect.fn('snapshotApplication')(
  function* (options: {
    projectRoot: string;
    directory: string;
    variant: Variant;
  }) {
    const fs = yield* FileSystem.FileSystem;

    const fixtureRoot = 'fixtures/request-lab';

    const entries = [
      'App.tsx',
      'main.tsx',
      'items.ts',
      'index.html',
      'style.css',
      'tokens.stylex.ts',
      'fixture-variant.d.ts',
      `${options.variant}.ts`,
    ];

    const files = [
      ...entries.map((entry) => `${fixtureRoot}/${entry}`),
      'package.json',
      'bun.lock',
      'src/capture/fixture-build.ts',
      'src/capture/application.ts',
      'src/capture/recipe.ts',
    ].sort();

    const records: Source['files'][number][] = [];

    for (const file of files) {
      const bytes = yield* fs.readFile(path.join(options.projectRoot, file));

      const output = path.join(options.directory, 'source', file);

      yield* fs.makeDirectory(path.dirname(output), { recursive: true });

      yield* fs.writeFile(output, bytes, { flag: 'wx' });

      records.push({ path: file, sha256: sha256(bytes) });
    }

    const identity = {
      entry: `${fixtureRoot}/${options.variant}.ts`,
      files: records,
    };

    return yield* Schema.decodeUnknownEffect(sourceSchema)({
      kind: 'snapshot',
      sha256: sha256(json(identity)),
      ...identity,
    });
  },
);
