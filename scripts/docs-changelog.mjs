// The docs changelog entry of a changeset (apps/web/content/docs/reference/changelog*.mdx).
//
// A changeset's summary is its CHANGELOG.md line. Below it, a `<!-- docs -->` block holds the
// entry for the docs changelog, in English and Turkish, with links to the docs:
//
//   ---
//   "better-payment": minor
//   ---
//
//   Add the React Router adapter: `better-payment/react-router` ...
//
//   <!-- docs -->
//   section: added
//   en: **[React Router adapter](/docs/integrations/frameworks#react-router):** ...
//   tr: **[React Router adaptörü](/docs/integrations/frameworks#react-router):** ...
//
// `section` is optional: added, changed, changed-breaking or fixed. Without it, the bump picks
// one (major: changed-breaking, minor: added, patch: fixed). Breaking changes are `minor` while
// the version is 0.x, so they need `section: changed-breaking`.
//
// .changeset/changelog.cjs leaves the block out of CHANGELOG.md, scripts/version-packages.mjs
// writes the entries into the docs changelog, and scripts/check-changesets.mjs (CI) checks that
// every changeset has one.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DOCS_MARKER = '<!-- docs -->';

export const SECTIONS = {
  'changed-breaking': { en: 'Changed (breaking)', tr: 'Değişenler (geriye uyumsuz)' },
  changed: { en: 'Changed', tr: 'Değişenler' },
  added: { en: 'Added', tr: 'Eklenenler' },
  fixed: { en: 'Fixed', tr: 'Düzeltilenler' },
};

export const BUMP_SECTIONS = { major: 'changed-breaking', minor: 'added', patch: 'fixed' };

/**
 * Reads one changeset file. Returns `{ file, bump, summary, docs }`, where `bump` is the
 * better-payment bump (or null), `summary` the CHANGELOG.md text on one line, and `docs`
 * `{ section, en, tr }`, or `error` when the block is missing or incomplete.
 */
export function readChangeset(path) {
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const bump =
    frontmatter &&
    /^\s*["']?better-payment["']?\s*:\s*(major|minor|patch)\s*$/m.exec(frontmatter[1]);
  const body = frontmatter ? source.slice(frontmatter[0].length) : source;
  const start = body.indexOf(DOCS_MARKER);
  const summary = (start === -1 ? body : body.slice(0, start))
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .join(' ');
  const result = { file: path, bump: bump ? bump[1] : null, summary };
  if (start === -1) return { ...result, error: `no ${DOCS_MARKER} block` };

  const fields = {};
  let current = null;
  for (const line of body.slice(start + DOCS_MARKER.length).split('\n')) {
    const field = /^(section|en|tr):\s*(.*)$/.exec(line);
    if (field) {
      current = field[1];
      fields[current] = field[2].trim();
    } else if (current && line.trim()) {
      // A long entry can continue on the next lines
      fields[current] += ` ${line.trim()}`;
    }
  }
  if (!fields.en) return { ...result, error: `the ${DOCS_MARKER} block has no "en:" line` };
  if (!fields.tr) return { ...result, error: `the ${DOCS_MARKER} block has no "tr:" line` };
  const section = fields.section || BUMP_SECTIONS[result.bump];
  if (!SECTIONS[section])
    return {
      ...result,
      error: `unknown section "${fields.section}" (use ${Object.keys(SECTIONS).join(', ')})`,
    };
  return { ...result, docs: { section, en: fields.en, tr: fields.tr } };
}

/** Every changeset in .changeset/ (README.md aside) */
export function readChangesets(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => readChangeset(join(dir, name)));
}

/** The `## <version>` section of the docs changelog in one language */
export function docsSection(version, entries, lang) {
  const lines = [`## ${version}`];
  for (const [key, names] of Object.entries(SECTIONS)) {
    const items = entries.filter((entry) => entry.section === key);
    if (!items.length) continue;
    lines.push('', `### ${names[lang]}`, '', ...items.map((entry) => `- ${entry[lang]}`));
  }
  return lines.join('\n');
}
