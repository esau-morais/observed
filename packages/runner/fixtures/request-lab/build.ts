import stylex from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { build, type PluginOption } from 'vite';

const stylexPlugin: PluginOption = stylex.vite({ useCSSLayers: true });

await build({
  configFile: false,
  root: import.meta.dirname,
  plugins: [stylexPlugin, react()],
  build: { outDir: 'dist', sourcemap: 'hidden' },
});
