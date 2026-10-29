import { defineConfig } from 'tsup';

/**
 * One entry: the CLI binary. It is Node-only (node:http, node:fs) and is never
 * imported by the browser or edge bundles of `better-payment`.
 * `better-payment` stays external: the CLI uses the installed library, it does not
 * copy it into dist.
 */
export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  keepNames: true,
  external: ['better-payment'],
  banner: { js: '#!/usr/bin/env node' },
});
