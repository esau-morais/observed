import stylexVite from '@stylexjs/unplugin/vite';
import type { UserOptions } from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';

// The official Vite adapter declares its plugin return as any in 0.19.1, and
// leaves out `babelConfig`, which it reads.
const stylex: (
  options?: Partial<UserOptions> & {
    babelConfig?: { presets?: (() => { sourceMaps: boolean })[] };
  },
) => PluginOption = stylexVite;

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(
    new URL(mode === 'test' ? './' : './viewer', import.meta.url),
  ),
  base: './',
  plugins:
    mode === 'test'
      ? []
      : [
          stylex({
            useCSSLayers: true,
            // Without its own map, the StyleX transform hands the next
            // plugin transformed code, and source maps would carry that
            // text in place of the file.
            babelConfig: { presets: [() => ({ sourceMaps: true })] },
          }),
          react(),
        ],
  resolve: {
    alias: { '/src': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/viewer', import.meta.url)),
    emptyOutDir: true,
    // The single-file report allows one script, so the viewer stays one
    // chunk of about 615 KB minified.
    chunkSizeWarningLimit: 660,
  },
}));
