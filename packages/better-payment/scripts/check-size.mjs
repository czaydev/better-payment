// Fails when a built entry point grows past its gzip budget, or when the
// browser client pulls in server-only dependencies. Run after `pnpm build`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const budgets = [
  // 27 kB since the plugin system (hooks, events, plugin endpoints)
  { file: 'dist/index.mjs', maxGzipKb: 27 },
  { file: 'dist/index.js', maxGzipKb: 27 },
  { file: 'dist/client/index.mjs', maxGzipKb: 2 },
  { file: 'dist/client/index.js', maxGzipKb: 2 },
  { file: 'dist/testing/index.mjs', maxGzipKb: 8 },
  { file: 'dist/testing/index.js', maxGzipKb: 8 },
  // Official plugins, with every built-in error message language. Raise this for new
  // languages; translations are never shortened to fit it.
  { file: 'dist/plugins/index.mjs', maxGzipKb: 5 },
  { file: 'dist/plugins/index.js', maxGzipKb: 5 },
  { file: 'dist/next/index.mjs', maxGzipKb: 1 },
  { file: 'dist/next/index.js', maxGzipKb: 1 },
  { file: 'dist/express/index.mjs', maxGzipKb: 1 },
  { file: 'dist/express/index.js', maxGzipKb: 1 },
  { file: 'dist/hono/index.mjs', maxGzipKb: 1 },
  { file: 'dist/hono/index.js', maxGzipKb: 1 },
  { file: 'dist/fastify/index.mjs', maxGzipKb: 1 },
  { file: 'dist/fastify/index.js', maxGzipKb: 1 },
];

// better-payment/client must stay browser-safe
const clientForbidden = ['axios', 'crypto', 'node:'];

let failed = false;

for (const { file, maxGzipKb } of budgets) {
  const source = readFileSync(file);
  const gzipKb = gzipSync(source).length / 1024;
  const ok = gzipKb <= maxGzipKb;
  failed ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${file}: ${gzipKb.toFixed(2)} kB gzip (budget ${maxGzipKb} kB)`
  );

  if (file.startsWith('dist/client/')) {
    const code = source.toString();
    for (const name of clientForbidden) {
      const pattern = new RegExp(`(?:from\\s*|require\\()\\s*['"]${name}`);
      if (pattern.test(code)) {
        failed = true;
        console.log(`FAIL ${file}: imports server-only module '${name}'`);
      }
    }
  }
}

if (failed) {
  process.exit(1);
}
