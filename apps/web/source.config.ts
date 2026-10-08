import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const { docs, meta } = defineDocs({
  dir: 'content/docs',
});

// Minimal hast shapes, enough for the checkmark plugin below
type HastText = { type: 'text'; value: string };
type HastElement = { type: 'element'; tagName: string; properties: Record<string, unknown>; children: HastNode[] };
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const CHECK = '✅';

function checkmark(): HastElement {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['bp-check'], role: 'img', ariaLabel: '✓' },
    children: [
      {
        type: 'element',
        tagName: 'svg',
        properties: {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 3.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          ariaHidden: 'true',
        },
        children: [{ type: 'element', tagName: 'path', properties: { d: 'm5 12.5 4.5 4.5L19 7.5' }, children: [] }],
      },
    ],
  };
}

/** Replaces the ✅ emoji in docs content with the brand checkmark */
function rehypeBrandCheckmarks() {
  const visit = (node: HastNode) => {
    if (!('children' in node) || !node.children) return;
    if ('tagName' in node && (node.tagName === 'code' || node.tagName === 'pre')) return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== 'text' || !(child as HastText).value.includes(CHECK)) {
        visit(child);
        return [child];
      }
      return (child as HastText).value
        .split(CHECK)
        .flatMap((part, i) => [...(i > 0 ? [checkmark()] : []), ...(part ? [{ type: 'text', value: part } as HastText] : [])]);
    });
  };
  return (tree: HastNode) => visit(tree);
}

/** Brand syntax colours (vault: Branding/06), with a dark counterpart on the dark palette */
type SyntaxPalette = {
  background: string;
  foreground: string;
  comment: string;
  keyword: string;
  string: string;
  fn: string;
  number: string;
  type: string;
};

function brandTheme(name: string, type: 'light' | 'dark', c: SyntaxPalette) {
  return {
    name,
    type,
    colors: { 'editor.background': c.background, 'editor.foreground': c.foreground },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.comment, fontStyle: 'italic' } },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'keyword.control',
          'keyword.operator.new',
          'keyword.operator.expression',
          'constant.language',
        ],
        settings: { foreground: c.keyword },
      },
      { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'], settings: { foreground: c.string } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: c.fn } },
      { scope: ['constant.numeric'], settings: { foreground: c.number } },
      { scope: ['entity.name.type', 'support.type', 'entity.name.class', 'support.class'], settings: { foreground: c.type } },
    ],
  };
}

const lightTheme = brandTheme('better-payment', 'light', {
  background: '#ffffff',
  foreground: '#13132b',
  comment: '#5a5a78',
  keyword: '#4338f2',
  string: '#087a55',
  fn: '#6a3fd8',
  number: '#a86207',
  type: '#2b2496',
});

const darkTheme = brandTheme('better-payment-dark', 'dark', {
  background: '#15152a',
  foreground: '#ecebfa',
  comment: '#8c8cab',
  keyword: '#a29dff',
  string: '#5fd6a8',
  fn: '#c8a6ff',
  number: '#f0b04a',
  type: '#8fb8ff',
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: { themes: { light: lightTheme, dark: darkTheme } },
    rehypePlugins: (plugins) => [rehypeBrandCheckmarks, ...plugins],
  },
});
