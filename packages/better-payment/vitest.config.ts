import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/',
        'examples/',
        'tests/',
        'vitest.config.ts',
        'tsup.config.ts',
      ],
      include: ['src/**/*.ts'],
      // Floor just below the current numbers; raise it as coverage improves
      thresholds: {
        lines: 87,
        functions: 92,
        branches: 73,
        statements: 87,
      },
    },
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      'tests/fixtures/**',
      'tests/helpers/**',
      'tests/sandbox/**',
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
      'better-payment/testing': path.resolve(__dirname, './src/testing/index.ts'),
      'better-payment/plugins': path.resolve(__dirname, './src/plugins/index.ts'),
      'better-payment/next': path.resolve(__dirname, './src/adapters/next.ts'),
      'better-payment/express': path.resolve(__dirname, './src/adapters/express.ts'),
      'better-payment/hono': path.resolve(__dirname, './src/adapters/hono.ts'),
      'better-payment/fastify': path.resolve(__dirname, './src/adapters/fastify.ts'),
      'better-payment/elysia': path.resolve(__dirname, './src/adapters/elysia.ts'),
      'better-payment': path.resolve(__dirname, './src/index.ts'),
    },
  },
});
