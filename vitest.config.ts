import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['extension/src/test/setup.ts'],
    include: ['extension/src/**/*.test.ts', 'server/src/**/*.test.ts']
  }
});
