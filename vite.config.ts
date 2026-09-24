import stylexVite from '@stylexjs/unplugin/vite';
import type { UserOptions } from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';

// The official Vite adapter declares its plugin return as any in 0.19.1.
const stylex: (options?: Partial<UserOptions>) => PluginOption = stylexVite;

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(
    new URL(mode === 'test' ? './' : './viewer', import.meta.url),
  ),
  base: './',
  plugins: mode === 'test' ? [] : [stylex({ useCSSLayers: true }), react()],
  resolve: {
    alias: { '/src': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/viewer', import.meta.url)),
    emptyOutDir: true,
  },
}));
