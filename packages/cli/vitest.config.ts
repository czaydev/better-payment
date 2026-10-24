import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // `listen` binds a real local port in the end-to-end tests
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      'better-payment': '../better-payment/src/index.ts',
    },
  },
});
