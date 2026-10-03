// Changelog lines for `changeset version`, in the style of CHANGELOG.md: one bullet per
// changeset, no commit hashes. scripts/version-packages.mjs moves the new section below the
// intro of CHANGELOG.md and renames its headings.

/** @type {import('@changesets/types').ChangelogFunctions} */
module.exports = {
  async getReleaseLine(changeset) {
    const [firstLine, ...rest] = changeset.summary.split('\n').map((line) => line.trimEnd());
    return [`- ${firstLine}`, ...rest.map((line) => (line ? `  ${line}` : line))].join('\n');
  },
  // better-payment is the only published package, so there are no dependency bumps to list
  async getDependencyReleaseLine() {
    return '';
  },
};
