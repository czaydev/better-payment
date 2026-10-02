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

/** Brand syntax colours (vault: Branding/06), light only */
const brandTheme = {
  name: 'better-payment',
  type: 'light' as const,
  colors: { 'editor.background': '#ffffff', 'editor.foreground': '#13132b' },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#5a5a78', fontStyle: 'italic' } },
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
      settings: { foreground: '#4338f2' },
    },
    { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'], settings: { foreground: '#087a55' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: '#6a3fd8' } },
    { scope: ['constant.numeric'], settings: { foreground: '#a86207' } },
    { scope: ['entity.name.type', 'support.type', 'entity.name.class', 'support.class'], settings: { foreground: '#2b2496' } },
  ],
};

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: { themes: { light: brandTheme, dark: brandTheme } },
    rehypePlugins: (plugins) => [rehypeBrandCheckmarks, ...plugins],
  },
});
