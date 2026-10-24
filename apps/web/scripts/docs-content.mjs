import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { readLocaleRegistry, fileLocale, localeRoute, routeLocale } from './locales.mjs';

const registry = readLocaleRegistry();
const markdown = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkStringify);
const text = (value) => ({ type: 'text', value });
const paragraph = (value) => ({ type: 'paragraph', children: [text(value)] });

export function siteUrl(basePath = '') {
  if (basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath)) throw new Error('Invalid docs base path');
  return `https://better-payment.czaylabs.com${basePath.replace(/\/$/, '')}`;
}

export function pageRoute(file) {
  const lang = fileLocale(registry, file);
  const suffix = new RegExp(`\\.(?:${registry.codes.join('|')})\\.mdx$`);
  const segments = file
    .replaceAll('\\', '/')
    .replace(suffix, '')
    .replace(/\.mdx$/, '')
    .split('/')
    .filter((part) => !/^\(.*\)$/.test(part));
  if (segments.at(-1) === 'index') segments.pop();
  return {
    lang,
    slug: segments.join('/'),
    route: localeRoute(registry, lang, `/docs${segments.length ? '/' + segments.join('/') : ''}`),
  };
}

/** Convert MDX syntax, never execute expressions or imports from documentation. */
export function toMarkdown(content, origin, route) {
  const tree = markdown.parse(content);
  const locale = routeLocale(registry, route);
  const prefix = localeRoute(registry, locale, '');
  const url = (value) => {
    if (value.startsWith('/') && !value.startsWith('//')) {
      const localized =
        prefix && /^\/docs(?:\/|#|$)/.test(value) ? `${prefix}${value}` : value;
      return `${origin}${localized}`;
    }
    return value.startsWith('#') ? `${origin}${route}${value}` : value;
  };
  function convert(node) {
    if (node.type === 'mdxjsEsm') return [];
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      if (!node.value.trim() || /^\/\*[\s\S]*\*\/$/.test(node.value.trim())) return [];
      throw new Error(`Unsupported MDX expression in ${route}: ${node.value}`);
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const attrs = Object.fromEntries(
        (node.attributes ?? [])
          .filter((a) => typeof a.value === 'string')
          .map((a) => [a.name, a.value]),
      );
      const children = (node.children ?? []).flatMap(convert);
      switch (node.name) {
        case 'Since':
          return [
            paragraph(
              `Feature version: ${attrs.version}. Check this documentation's release before use.`,
            ),
          ];
        case 'ApiReferenceLink':
          return [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  url: `${origin}/api-reference/index.html`,
                  children: [text('API reference (English)')],
                },
              ],
            },
          ];
        case 'Card':
          return [
            {
              type: 'paragraph',
              children: [
                attrs.href
                  ? {
                      type: 'link',
                      url: url(attrs.href),
                      children: [text(attrs.title ?? 'Documentation')],
                    }
                  : text(attrs.title ?? 'Documentation'),
                ...(attrs.description ? [text(`: ${attrs.description}`)] : []),
              ],
            },
            ...children,
          ];
        case 'Callout':
          return [
            {
              type: 'blockquote',
              children: [...(attrs.title ? [paragraph(attrs.title)] : []), ...children],
            },
          ];
        case 'Tab':
          return [...(attrs.value ? [paragraph(attrs.value)] : []), ...children];
        case 'Tabs':
        case 'Cards':
        case null:
          return children;
        case 'br':
          return [{ type: 'break' }];
        default:
          throw new Error(`Unsupported MDX component in ${route}: ${node.name}`);
      }
    }
    const result = { ...node };
    if (result.children) result.children = result.children.flatMap(convert);
    if (result.type === 'link' || result.type === 'image' || result.type === 'definition')
      result.url = url(result.url);
    return [result];
  }
  return markdown.stringify(convert(tree)[0]);
}

export async function collectPages(root, origin) {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) =>
          entry.isDirectory() ? walk(join(dir, entry.name)) : join(dir, entry.name),
        ),
      )
    ).flat();
  }
  const files = (await walk(root)).filter((file) => file.endsWith('.mdx')).sort();
  const disabled = new Set(registry.disabled);
  const seen = new Set();
  return Promise.all(
    files.map(async (file) => {
      const relativeFile = relative(root, file);
      const suffix = /\.([a-z0-9-]+)\.mdx$/.exec(relativeFile.replaceAll('\\', '/'))?.[1];
      if (suffix && disabled.has(suffix))
        throw new Error(
          `${relativeFile}: "${suffix}" is disabled in locales.json; enable it before adding translations`
        );
      const { data, content } = matter(await readFile(file, 'utf8'));
      const page = pageRoute(relativeFile);
      if (seen.has(page.route)) throw new Error(`Duplicate docs route: ${page.route}`);
      seen.add(page.route);
      if (typeof data.title !== 'string') throw new Error(`Missing title: ${file}`);
      return {
        ...page,
        title: data.title,
        description: data.description ?? '',
        markdown: `# ${data.title}\n\nSource: ${origin}${page.route}\n\n${toMarkdown(content, origin, page.route)}`,
      };
    }),
  );
}
