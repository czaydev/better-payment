#!/usr/bin/env node
// Checks that every changeset has a docs changelog entry in English and Turkish
// (see scripts/docs-changelog.mjs for the format). Run in CI.

import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { readChangesets, DOCS_MARKER } from './docs-changelog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const changesets = readChangesets(`${root}.changeset`);
const problems = changesets.filter((changeset) => changeset.bump && changeset.error);

for (const { file, error } of problems) console.error(`✗ ${relative(root, file)}: ${error}`);
if (problems.length) {
  console.error(
    `\nAdd a ${DOCS_MARKER} block with "en:" and "tr:" lines to each changeset. See CONTRIBUTING.md → Releases.`
  );
  process.exit(1);
}
console.log(`✓ ${changesets.length} changeset(s), each with a docs changelog entry (en/tr).`);
