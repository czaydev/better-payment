import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collectPages, siteUrl } from './docs-content.mjs';
import { readLocaleRegistry } from './locales.mjs';

const registry = readLocaleRegistry();
const web = fileURLToPath(new URL('../', import.meta.url));
const output = join(web, 'public');
const origin = siteUrl(process.env.NEXT_PUBLIC_BASE_PATH);
const pages = await collectPages(join(web, 'content/docs'), origin);
const index = await readFile(join(output, 'llms.txt'), 'utf8');
const full = await readFile(join(output, 'llms-full.txt'), 'utf8');
for (const page of pages) {
  const path = `llms/${page.lang}/${page.slug || 'index'}.md`;
  assert.ok(index.includes(`${origin}/${path}`), `Missing index entry: ${page.route}`);
  assert.equal(await readFile(join(output, path), 'utf8'), page.markdown);
  if (page.lang === registry.defaultLanguage)
    assert.ok(full.includes(page.markdown), `Missing English content: ${page.route}`);
}
const manifest = JSON.parse(
  await readFile(join(web, '../../packages/better-payment/package.json'), 'utf8'),
);
const coverage = JSON.parse(await readFile(join(output, 'api-reference/coverage.json'), 'utf8'));
assert.equal(coverage.version, manifest.version);
assert.equal(coverage.entries, Object.keys(manifest.exports).length);
assert.ok(coverage.exports.length > 0);
const html = new Map();
for (const item of coverage.exports) {
  const [file, anchor] = item.url.split('#');
  const path = join(output, 'api-reference', file);
  await access(path);
  if (!html.has(path)) html.set(path, await readFile(path, 'utf8'));
  if (anchor)
    assert.ok(
      html.get(path).includes(`id="${decodeURIComponent(anchor)}"`),
      `Missing API anchor: ${item.url}`,
    );
}
console.log(
  `Verified ${pages.length} Markdown pages and ${coverage.exports.length} public API destinations.`,
);
