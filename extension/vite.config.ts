import { defineConfig, type UserConfig } from 'vite';
import { resolve } from 'node:path';

const outDir = resolve(__dirname, '..', 'dist');

// Main build: background (ES module) + popup HTML.
// Content script is built separately (see vite.config.content.ts) as IIFE.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});