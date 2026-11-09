import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Relative base so the build works from any static host path (GitHub Pages project sites included).
// `--mode single` inlines everything into one HTML file for previews.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    target: 'es2022',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 1500,
  },
}));
