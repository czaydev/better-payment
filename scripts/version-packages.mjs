#!/usr/bin/env node
// Prepares a release: `changeset version`, then the files changesets does not know about.
// Run by the "Release PR" workflow (changesets/action) and by `pnpm version-packages`.
//
// 1. `changeset version` consumes .changeset/*.md into package.json and CHANGELOG.md.
// 2. CHANGELOG.md: changesets inserts the new section right after the first line, above the
//    intro. Move it below the intro (before the latest release) and name its headings like
//    the rest of the file: Added / Changed (breaking) / Fixed.
// 3. src/version.ts and the VERSION example in the installation docs (en/tr) get the new version.
// 4. The docs changelog (apps/web/content/docs/reference/changelog*.mdx) gets the new version's
//    section, from the `<!-- docs -->` block of each changeset (scripts/docs-changelog.mjs).
//    A changeset without one falls back to its summary, in English on both pages.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUMP_SECTIONS, docsSection, readChangesets } from './docs-changelog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = `${root}packages/better-payment/`;
const changelogPath = `${pkgDir}CHANGELOG.md`;

const read = (path) => readFileSync(path, 'utf8');
const version = () => JSON.parse(read(`${pkgDir}package.json`)).version;

const before = version();
const changelogBefore = read(changelogPath);
// `changeset version` deletes the changesets, so read their docs entries first
const changesets = readChangesets(`${root}.changeset`).filter((changeset) => changeset.bump);

execFileSync('pnpm', ['exec', 'changeset', 'version'], { cwd: root, stdio: 'inherit' });

const next = version();
if (next === before) {
  console.log(`No changesets for better-payment; version stays ${before}.`);
  process.exit(0);
}

// 2. CHANGELOG.md
const HEADINGS = {
  'Major Changes': 'Changed (breaking)',
  'Minor Changes': 'Added',
  'Patch Changes': 'Fixed',
};
const changelogAfter = read(changelogPath);
const sectionStart = changelogAfter.indexOf(`\n## ${next}\n`);
if (sectionStart === -1) throw new Error(`CHANGELOG.md has no "## ${next}" section`);
// Everything after the title line of the old file follows the inserted section
const sectionEnd = changelogAfter.lastIndexOf(
  changelogBefore.slice(changelogBefore.indexOf('\n') + 1)
);
if (sectionEnd <= sectionStart) throw new Error('Could not find the new section in CHANGELOG.md');
const section = changelogAfter
  .slice(sectionStart + 1, sectionEnd)
  .replace(/^### (.+)$/gm, (line, name) => (HEADINGS[name] ? `### ${HEADINGS[name]}` : line))
  // A blank line around every heading (changesets formats with Prettier, which is turned off)
  .replace(/^(#{2,3} .+)\n+/gm, '$1\n\n')
  .replace(/\n*(\n#{2,3} )/g, '\n$1')
  .trim();

// Same file as before `changeset version`, with the section above the latest release
const latest = changelogBefore.indexOf('\n## ');
writeFileSync(
  changelogPath,
  latest === -1
    ? `${changelogBefore.trimEnd()}\n\n${section}\n`
    : `${changelogBefore.slice(0, latest + 1)}${section}\n\n${changelogBefore.slice(latest + 1)}`
);

// 3. src/version.ts and the installation docs
const replaceIn = (path, from, to) => {
  const text = read(path);
  if (!text.includes(from)) throw new Error(`${path} does not contain ${from}`);
  writeFileSync(path, text.replace(from, to));
};
replaceIn(`${pkgDir}src/version.ts`, `VERSION = '${before}'`, `VERSION = '${next}'`);
const docsDir = `${root}apps/web/content/docs/`;
const installationPages = readdirSync(docsDir, { recursive: true }).filter((file) =>
  /(^|\/)installation(\.tr)?\.mdx$/.test(file)
);
if (installationPages.length !== 2)
  throw new Error('Expected installation.mdx and installation.tr.mdx');
for (const file of installationPages)
  replaceIn(`${docsDir}${file}`, `// '${before}'`, `// '${next}'`);

// 4. Docs changelog
const entries = changesets.map((changeset) => {
  if (changeset.docs) return changeset.docs;
  console.warn(`${changeset.file}: ${changeset.error}; using its summary on both docs pages`);
  const { summary } = changeset;
  return { section: BUMP_SECTIONS[changeset.bump], en: summary, tr: summary };
});
const referenceDir = `${docsDir}reference/`;
for (const [file, lang] of [
  ['changelog.mdx', 'en'],
  ['changelog.tr.mdx', 'tr'],
]) {
  const path = `${referenceDir}${file}`;
  const text = read(path);
  if (text.split('\n').includes(`## ${next}`)) continue;
  const latest = text.indexOf('\n## ');
  const section = docsSection(next, entries, lang);
  writeFileSync(
    path,
    latest === -1
      ? `${text.trimEnd()}\n\n${section}\n`
      : `${text.slice(0, latest + 1)}${section}\n\n${text.slice(latest + 1)}`
  );
}
// Turkish headings keep the English heading ids ([#added-2] ...)
execFileSync('node', ['apps/web/scripts/check-translations.mjs', '--fix'], {
  cwd: root,
  stdio: 'inherit',
});

console.log(`better-payment ${before} → ${next}`);
