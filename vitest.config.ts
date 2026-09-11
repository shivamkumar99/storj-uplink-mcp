import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.mjs'],
    // Quiet the native addon's INFO banner when utils.ts loads storj-uplink-nodejs
    env: { UPLINK_LOG_LEVEL: 'error' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // Process entry points: index.ts connects the stdio transport on import and
      // setup.ts runs the interactive readline wizard on import. Neither can be
      // imported by a unit test without side effects.
      exclude: ['src/index.ts', 'src/setup.ts'],
    },
  },
});
