// Fails when a built entry point grows past its gzip budget, or when the
// browser client pulls in server-only dependencies. Run after `pnpm build`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const budgets = [
  // 27 kB since the plugin system (hooks, events, plugin endpoints), 28 kB since
  // buildBasket() (ESM bundlers drop it when it is not imported), 29 kB since the
  // 0.8.1 security fixes (Akbank order check, body limits, response filtering),
  // 31 kB since the Kuveyt Türk provider, 34 kB since the EST provider, 38 kB since
  // the Sipay provider, 40 kB since QNB, 42 kB with Yapı Kredi, 44 kB with VakıfBank,
  // 46 kB with Albaraka Türk, 48 kB with Denizbank, 49 kB with QNBpay, 51 kB with Garanti BBVA alongside the
  // other providers
  { file: 'dist/index.mjs', maxGzipKb: 51 },
  { file: 'dist/index.js', maxGzipKb: 51 },
  { file: 'dist/client/index.mjs', maxGzipKb: 2 },
  { file: 'dist/client/index.js', maxGzipKb: 2 },
  { file: 'dist/testing/index.mjs', maxGzipKb: 8 },
  { file: 'dist/testing/index.js', maxGzipKb: 8 },
  // Official plugins, with every built-in error message language. Raise this for new
  // languages; translations are never shortened to fit it. 7 kB since the
  // notifications plugin, 9 kB with the openAPI plugin, 11 kB with failover. The
  // currencyConversion, redact, threeDSTimeout, captcha, rateLimit, pendingResolver,
  // refundApproval, webhookForwarding, mcp and telemetry plugins take the bundle to
  // 22.32 / 22.34 kB gzip; the 0.12.0 security fixes take it to 23.05 / 23.08 kB, so the
  // budget is 24 kB. ESM bundlers drop the plugins an application does not import.
  { file: 'dist/plugins/index.mjs', maxGzipKb: 24 },
  { file: 'dist/plugins/index.js', maxGzipKb: 24 },
  // The fraud rules engine is a separate subpath (`better-payment/fraud`); the plugins
  // barrel only re-exports its types, so it costs that entry point nothing. 3.90 kB
  // gzip measured on the merged tree, so its own budget is 4 kB.
  { file: 'dist/fraud/index.mjs', maxGzipKb: 4 },
  { file: 'dist/fraud/index.js', maxGzipKb: 4 },
  // The commission router is a separate subpath (`better-payment/commission-router`),
  // it is deliberately not in the plugins barrel: 7.83 / 7.85 kB gzip measured on the
  // merged tree, 8 kB leaves room for the matching rules an application adds.
  { file: 'dist/commission-router/index.mjs', maxGzipKb: 8 },
  { file: 'dist/commission-router/index.js', maxGzipKb: 8 },
  // The routing engine is a separate subpath: its conditions, weighted splits,
  // store and explain() would break the plugins barrel's budget. 5.57 / 5.58 kB gzip
  // measured against beta; 6 kB leaves room for a few more conditions.
  { file: 'dist/routing/index.mjs', maxGzipKb: 6 },
  { file: 'dist/routing/index.js', maxGzipKb: 6 },
  // Daily transaction lists and order matching (issue #41), a separate subpath so
  // the provider sources never weigh on better-payment or better-payment/plugins.
  // 9.65 kB gzip measured against beta, which the main entry pays 0.15 kB of.
  { file: 'dist/reconciliation/index.mjs', maxGzipKb: 10 },
  { file: 'dist/reconciliation/index.js', maxGzipKb: 10 },
  { file: 'dist/next/index.mjs', maxGzipKb: 1 },
  { file: 'dist/next/index.js', maxGzipKb: 1 },
  { file: 'dist/express/index.mjs', maxGzipKb: 1 },
  { file: 'dist/express/index.js', maxGzipKb: 1 },
  { file: 'dist/hono/index.mjs', maxGzipKb: 1 },
  { file: 'dist/hono/index.js', maxGzipKb: 1 },
  { file: 'dist/fastify/index.mjs', maxGzipKb: 1 },
  { file: 'dist/fastify/index.js', maxGzipKb: 1 },
  { file: 'dist/nestjs/index.mjs', maxGzipKb: 1 },
  { file: 'dist/nestjs/index.js', maxGzipKb: 1 },
  { file: 'dist/elysia/index.mjs', maxGzipKb: 1 },
  { file: 'dist/elysia/index.js', maxGzipKb: 1 },
  { file: 'dist/react-router/index.mjs', maxGzipKb: 1 },
  { file: 'dist/react-router/index.js', maxGzipKb: 1 },
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
