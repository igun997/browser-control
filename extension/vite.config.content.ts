import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const outDir = resolve(__dirname, '..', 'dist');

// Separate build for content script as IIFE (no ES module imports).
// Chrome content scripts run in page context and cannot use import statements.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir,
    emptyOutDir: false, // Don't wipe main build output
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'BrowserControlsContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        // Ensure no ES module syntax
        format: 'iife',
      },
    },
  },
});
