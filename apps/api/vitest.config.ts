import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/env.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
    pool: 'forks',
  },
});
