import stylex from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { Schema } from 'effect';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type PluginOption } from 'vite';

const optionsSchema = Schema.Struct({
  root: Schema.NonEmptyString,
  output: Schema.NonEmptyString,
  variant: Schema.Literals(['base', 'duplicate', 'visual']),
  dependencies: Schema.NonEmptyString,
});

const options = Schema.decodeUnknownSync(optionsSchema)({
  root: process.argv[2],
  output: process.argv[3],
  variant: process.argv[4],
  dependencies: process.argv[5],
});

const resolveDependency = createRequire(
  path.join(options.dependencies, '../package.json'),
).resolve;

// The official plugin publishes an any return type for each bundler entry point.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const stylexPlugin: PluginOption = stylex.vite({ useCSSLayers: true });

await build({
  configFile: false,
  root: options.root,
  base: './',
  plugins: [stylexPlugin, react()],
  resolve: {
    alias: [
      {
        find: 'fixture-variant',
        replacement: path.join(options.root, `${options.variant}.ts`),
      },
      ...[
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
        'effect',
        '@stylexjs/stylex',
      ].map((name) => ({
        find: new RegExp(`^${name}$`),
        replacement: resolveDependency(name),
      })),
      ...['@fontsource/geist', '@fontsource/geist-mono'].map((name) => ({
        find: name,
        replacement: path.join(options.dependencies, name),
      })),
    ],
  },
  build: {
    outDir: options.output,
    emptyOutDir: false,
  },
});
