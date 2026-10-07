// Changelog lines for `changeset version`, in the style of CHANGELOG.md: one bullet per
// changeset, no commit hashes. scripts/version-packages.mjs moves the new section below the
// intro of CHANGELOG.md and renames its headings. The `<!-- docs -->` block of a changeset is the
// docs changelog entry (scripts/docs-changelog.mjs), so it is left out here.

/** @type {import('@changesets/types').ChangelogFunctions} */
module.exports = {
  async getReleaseLine(changeset) {
    const summary = changeset.summary.split('<!-- docs -->')[0].trim();
    const [firstLine, ...rest] = summary.split('\n').map((line) => line.trimEnd());
    return [`- ${firstLine}`, ...rest.map((line) => (line ? `  ${line}` : line))].join('\n');
  },
  // better-payment is the only published package, so there are no dependency bumps to list
  async getDependencyReleaseLine() {
    return '';
  },
};
