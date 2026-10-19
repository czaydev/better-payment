#!/usr/bin/env node
// Prepares a release: `changeset version`, then the files changesets does not know about.
// Run by the "Release PR" workflow (changesets/action) and by `pnpm version-packages`.
//
// 1. `changeset version` consumes .changeset/*.md into package.json and CHANGELOG.md.
// 2. CHANGELOG.md: changesets inserts the new section above the latest release. Name its
//    headings like the rest of the file: Added / Changed (breaking) / Fixed.
// 3. src/version.ts and the VERSION example in the installation docs (en/tr) get the new version.
// 4. The docs changelog (apps/web/content/docs/reference/changelog*.mdx) gets the new version's
//    section, from the `<!-- docs -->` block of each changeset (scripts/docs-changelog.mjs).
//    A changeset without one falls back to its summary, in English on both pages.
//
// Prereleases: the `beta` branch is in changesets pre mode (.changeset/pre.json), so each beta
// gets only the changesets added since the previous one. After `changeset pre exit`, the stable
// version gets all of them, and its `-beta.N` sections are removed from both changelogs.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUMP_SECTIONS, docsSection, readChangesets } from './docs-changelog.mjs';
import { creditFor } from './credits.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = `${root}packages/better-payment/`;
const changelogPath = `${pkgDir}CHANGELOG.md`;

const read = (path) => readFileSync(path, 'utf8');
const version = () => JSON.parse(read(`${pkgDir}package.json`)).version;

const before = version();
const changelogBefore = read(changelogPath);
// `changeset version` deletes the changesets, so read their docs entries first
const prePath = `${root}.changeset/pre.json`;
const pre = existsSync(prePath) ? JSON.parse(read(prePath)) : null;
// In pre mode, `changeset version` moves the released changesets to .changeset/pre/. After
// `changeset pre exit`, the stable version is made of all of them.
const changesets = [
  ...readChangesets(`${root}.changeset`),
  ...(pre?.mode === 'exit' ? readChangesets(`${root}.changeset/pre`) : []),
].filter((changeset) => changeset.bump);
// changesets 3 exits with code 1 when there is nothing to version
if (!changesets.length) {
  console.log(`No changesets for better-payment; version stays ${before}.`);
  process.exit(0);
}

execFileSync('pnpm', ['exec', 'changeset', 'version'], { cwd: root, stdio: 'inherit' });

const next = version();
if (next === before) {
  console.log(`No changesets for better-payment; version stays ${before}.`);
  process.exit(0);
}

// The stable version's section replaces its prerelease sections (`## 0.12.0-beta.0` ...)
const stable = !next.includes('-');
const withoutPrereleases = (text) => {
  if (!stable) return text;
  const heading = `\n## ${next}-`;
  let start;
  while ((start = text.indexOf(heading)) !== -1) {
    const end = text.indexOf('\n## ', start + 1);
    text =
      end === -1
        ? `${text.slice(0, start).trimEnd()}\n`
        : text.slice(0, start + 1) + text.slice(end + 1);
  }
  return text;
};

// 2. CHANGELOG.md
const HEADINGS = {
  'Major Changes': 'Changed (breaking)',
  'Minor Changes': 'Added',
  'Patch Changes': 'Fixed',
};
const changelogAfter = read(changelogPath);
const sectionStart = changelogAfter.indexOf(`\n## ${next}\n`);
if (sectionStart === -1) throw new Error(`CHANGELOG.md has no "## ${next}" section`);
// changesets 3 inserts the section above the latest release, so it ends where that one starts
const nextRelease = changelogAfter.indexOf('\n## ', sectionStart + 1);
const sectionEnd = nextRelease === -1 ? changelogAfter.length : nextRelease + 1;
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
  withoutPrereleases(
    latest === -1
      ? `${changelogBefore.trimEnd()}\n\n${section}\n`
      : `${changelogBefore.slice(0, latest + 1)}${section}\n\n${changelogBefore.slice(latest + 1)}`
  )
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
// Contributors are thanked here too, unless the entry already thanks someone by hand
const entries = await Promise.all(
  changesets.map(async (changeset) => {
    let entry;
    if (changeset.docs) entry = changeset.docs;
    else {
      console.warn(`${changeset.file}: ${changeset.error}; using its summary on both docs pages`);
      const { summary } = changeset;
      entry = { section: BUMP_SECTIONS[changeset.bump], en: summary, tr: summary };
    }
    const credit = /thanks|teşekkür/i.test(`${entry.en} ${entry.tr}`)
      ? null
      : await creditFor(basename(changeset.file, '.md'));
    if (!credit) return entry;
    const link = `[@${credit.login}](https://github.com/${credit.login})`;
    return { ...entry, en: `${entry.en} Thanks to ${link}.`, tr: `${entry.tr} Teşekkürler ${link}.` };
  })
);
const referenceDir = `${docsDir}reference/`;
for (const [file, lang] of [
  ['changelog.mdx', 'en'],
  ['changelog.tr.mdx', 'tr'],
]) {
  const path = `${referenceDir}${file}`;
  const text = withoutPrereleases(read(path));
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
