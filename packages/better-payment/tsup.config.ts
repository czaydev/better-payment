import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'testing/index': 'src/testing/index.ts',
    'plugins/index': 'src/plugins/index.ts',
    'next/index': 'src/adapters/next.ts',
    'express/index': 'src/adapters/express.ts',
    'hono/index': 'src/adapters/hono.ts',
    'fastify/index': 'src/adapters/fastify.ts',
    'elysia/index': 'src/adapters/elysia.ts',
    'react-router/index': 'src/adapters/react-router.ts',
  },
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // better-payment/testing and /plugins import classes from the main entry at runtime
  external: ['better-payment'],
  // Smaller published bundles; sourcemaps keep stack traces readable.
  minify: true,
  // Keep class and function names: error names, instanceof checks in user code
  // and provider names derived from constructor.name must survive minification.
  keepNames: true,
});
