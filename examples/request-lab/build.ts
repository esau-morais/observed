import stylex from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { build, type PluginOption } from 'vite';

// The official plugin publishes an any return type for each bundler entry point.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const stylexPlugin: PluginOption = stylex.vite({ useCSSLayers: true });

await build({
  configFile: false,
  root: import.meta.dirname,
  plugins: [stylexPlugin, react()],
  build: { outDir: 'dist' },
});
