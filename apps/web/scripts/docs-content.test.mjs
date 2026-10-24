import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import matter from 'gray-matter';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pageRoute, siteUrl, toMarkdown, collectPages } from './docs-content.mjs';
import { readLocaleRegistry } from './locales.mjs';
import { fileURLToPath } from 'node:url';

test('routes omit groups/index and preserve locale', () => {
  assert.deepEqual(pageRoute('(get-started)/index.mdx'), { lang: 'en', slug: '', route: '/docs' });
  assert.deepEqual(pageRoute('(get-started)\\installation.tr.mdx'), {
    lang: 'tr',
    slug: 'installation',
    route: '/tr/docs/installation',
  });
  assert.equal(pageRoute('reference/types.mdx').route, '/docs/reference/types');
});

test('stable and beta origins stay separate', () => {
  assert.equal(siteUrl(), 'https://better-payment.czaylabs.com');
  assert.equal(siteUrl('/beta'), 'https://better-payment.czaylabs.com/beta');
  assert.throws(() => siteUrl('https://other.example'), /Invalid/);
});

test('MDX becomes readable Markdown without changing code', () => {
  const code = "const result = { price: '1.00', callback: '<Callout />' };";
  const input = `import { x } from 'x';\n\n<Since version="0.11.0" />\n\n<Callout type="warn">\n\nNever retry payments.\n\n</Callout>\n\n<Tabs items={['Node']}>\n<Tab value="Node">\n\n\`\`\`ts\n${code}\n\`\`\`\n\n</Tab>\n</Tabs>\n\n<Card title="Install" href="/docs/installation" description="Set up the SDK" />\n\n<ApiReferenceLink />\n\n{/* comment */}`;
  const result = toMarkdown(input, siteUrl('/beta'), '/docs/test');
  assert.match(result, /Feature version: 0\.11\.0/);
  assert.match(result, /> Never retry payments/);
  assert.match(result, /https:\/\/better-payment.czaylabs.com\/beta\/docs\/installation/);
  assert.match(result, /\/beta\/api-reference\/index.html/);
  const tree = unified().use(remarkParse).parse(result);
  assert.equal(tree.children.find((node) => node.type === 'code').value, code);
  assert.doesNotMatch(result, /import \{ x \}|items=|\{\/\* comment/);
});

test('unsupported MDX fails visibly instead of silently losing content', () => {
  assert.throws(
    () => toMarkdown('<Unknown />', siteUrl(), '/docs/test'),
    /Unsupported MDX component/,
  );
  assert.throws(
    () => toMarkdown('{process.env.SECRET}', siteUrl(), '/docs/test'),
    /Unsupported MDX expression/,
  );
});

test('Turkish links and fragment links keep their language and deployment', () => {
  const result = toMarkdown(
    '[Setup](/docs/installation) [Section](#usage) [External](https://example.com)',
    siteUrl('/beta'),
    '/tr/docs/test',
  );
  assert.match(result, /\/beta\/tr\/docs\/installation/);
  assert.match(result, /\/beta\/tr\/docs\/test#usage/);
  assert.match(result, /https:\/\/example.com/);
});

test('cards without links remain plain text, tables and inline code survive', () => {
  const result = toMarkdown(
    '<Card title="Callbacks" description="Verify signatures" />\n\n| Field | Value |\n| --- | --- |\n| `status` | success |',
    siteUrl(),
    '/docs',
  );
  assert.match(result, /Callbacks: Verify signatures/);
  assert.doesNotMatch(result, /\]\(\)/);
  assert.match(result, /`status`/);
});

test('all real docs convert, with matching locale pages and unique routes', async () => {
  const registry = readLocaleRegistry();
  const pages = await collectPages(
    fileURLToPath(new URL('../content/docs/', import.meta.url)),
    siteUrl(),
  );
  const english = pages.filter((page) => page.lang === registry.defaultLanguage);
  assert.ok(english.length > 0);
  // Languages with docs "required" (Turkish today) must mirror every English page;
  // optional languages may cover any subset of the pages.
  for (const locale of registry.required.filter((code) => code !== registry.defaultLanguage)) {
    for (const page of english)
      assert.ok(pages.some((other) => other.lang === locale && other.slug === page.slug));
    assert.equal(pages.filter((page) => page.lang === locale).length, english.length);
  }
  assert.ok(pages.every((page) => registry.codes.includes(page.lang)));
  assert.equal(new Set(pages.map((page) => page.route)).size, pages.length);
});

test('every real code example survives conversion unchanged', async () => {
  const root = fileURLToPath(new URL('../content/docs/', import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.mdx'));
  const mdx = unified().use(remarkParse).use(remarkMdx);
  const md = unified().use(remarkParse);
  const blocks = (node) =>
    node.type === 'code'
      ? [{ lang: node.lang, value: node.value }]
      : (node.children ?? []).flatMap(blocks);
  for (const file of files) {
    const { content } = matter(await readFile(join(root, file), 'utf8'));
    const converted = toMarkdown(content, siteUrl(), pageRoute(file).route);
    assert.deepEqual(blocks(md.parse(converted)), blocks(mdx.parse(content)), file);
  }
});
