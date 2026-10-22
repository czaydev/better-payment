#!/usr/bin/env node
// Supply-chain hygiene for .github/workflows: every third-party action is pinned to a full commit
// SHA with its version in a trailing comment, every workflow and job declares least-privilege
// `permissions:`, and every job has a `timeout-minutes`. Run in CI (ci.yml → Supply-chain hygiene).
//
//   node scripts/check-workflow-hygiene.mjs              structural checks, no network
//   node scripts/check-workflow-hygiene.mjs --verify     also asks GitHub that each pinned SHA is
//                                                        the commit of the version in its comment
//
// --verify is for maintainers and for a scheduled workflow: it needs the API, and unauthenticated
// calls are rate limited (set GH_TOKEN or GITHUB_TOKEN to raise the limit).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const VERIFY = process.argv.includes('--verify');

const SHA = /^[0-9a-f]{40}$/;
const problems = [];
const pins = new Map();

/** First directory-level indent inside `jobs:`, which is where a job name lives */
function jobIndent(lines) {
  const jobs = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobs === -1) return -1;
  for (let index = jobs + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    return /^\s+/.test(line) ? line.match(/^\s+/)[0].length : -1;
  }
  return -1;
}

/** The keys directly under a job, as `name -> line` */
function jobKeys(lines, start, indent) {
  const keys = new Map();
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const current = line.match(/^\s+/)?.[0].length ?? 0;
    if (current <= indent) break;
    if (current === indent + 2) {
      const key = /^([\w-]+):/.exec(line.trim());
      if (key && !keys.has(key[1])) keys.set(key[1], line);
    }
  }
  return keys;
}

const files = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

for (const name of files) {
  const path = join(WORKFLOWS, name);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const where = (line) => `${relative(ROOT, path)}:${line + 1}`;

  if (!lines.some((line) => /^permissions:/.test(line))) {
    problems.push(
      `${where(0)} ${name}: no workflow-level "permissions:". Without it the token inherits the repository default, which is broader than a workflow needs.`
    );
  }

  const jobs = jobIndent(lines);
  if (jobs === -1) continue;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s+/)?.[0].length ?? 0;
    if (indent !== jobs || !/^\s*[\w][\w.-]*:\s*(#.*)?$/.test(line)) continue;

    const jobName = line.trim().replace(/:.*$/, '');
    const keys = jobKeys(lines, index + 1, jobs);
    if (!keys.has('runs-on')) continue;

    if (!keys.has('permissions')) {
      problems.push(
        `${where(index)} job "${jobName}": no "permissions:". Declare the least the job uses ("contents: read", plus a write scope only where it really writes), so a compromised step cannot widen the token.`
      );
    }
    if (!keys.has('timeout-minutes')) {
      problems.push(`${where(index)} job "${jobName}": no "timeout-minutes:", so a hung job burns runners forever.`);
    }
  }

  lines.forEach((line, index) => {
    const used = /^\s*(?:-\s+)?(?:[\w'-]+:\s+)*uses:\s*(\S+)\s*(?:#\s*(\S+))?\s*$/.exec(line);
    if (!used) return;
    const [ref, comment] = [used[1], used[2]];
    if (ref.startsWith('./') || ref.startsWith('docker://')) return;

    const [source] = ref.split('@');
    if (!/^[\w.-]+\/[\w.-]+(\/[\w.-]+)*$/.test(source)) {
      problems.push(`${where(index)} "${ref}": not an owner/repo action reference.`);
      return;
    }
    const version = ref.split('@')[1] ?? '';
    if (!SHA.test(version)) {
      problems.push(
        `${where(index)} "${ref}": a tag or branch is a moving reference. Pin the full 40-character commit SHA: ${source}@<sha> # ${comment || 'vX.Y.Z'}`
      );
      return;
    }
    if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(comment ?? '')) {
      problems.push(
        `${where(index)} "${ref}": pinned to a SHA but the trailing comment is "${comment ?? ''}", not a version like "# v1.2.3". Dependabot and reviewers need to read which release this SHA is.`
      );
      return;
    }
    pins.set(`${source}@${version}`, { comment, file: where(index) });
  });
}

if (VERIFY) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = { 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  for (const [ref, { comment, file }] of [...pins].sort()) {
    const [source, sha] = ref.split('@');
    const tag = await api(`repos/${source}/git/ref/tags/${comment}`, headers);
    if (!tag) {
      problems.push(`${file} ${ref}: tag ${comment} does not exist in ${source}, so this pin cannot be checked.`);
      continue;
    }
    const commit = tag.object.type === 'tag' ? await api(`repos/${source}/git/tags/${tag.object.sha}`, headers) : null;
    const target = commit ? commit.object.sha : tag.object.sha;
    if (target !== sha) {
      problems.push(
        `${file} ${ref}: ${comment} resolves to ${target}, not ${sha}. The comment and the SHA disagree.`
      );
    } else {
      console.log(`✓ ${source}@${sha.slice(0, 10)} = ${comment} (${tag.object.type === 'tag' ? 'annotated tag' : 'lightweight tag'})`);
    }
  }
}

async function api(path, headers) {
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API ${path} returned HTTP ${response.status}`);
  return response.json();
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error(`\n${problems.length} workflow hygiene problem(s). See CONTRIBUTING.md → CI and supply chain.`);
  process.exit(1);
}

console.log(
  `✓ ${files.length} workflow file(s): ${pins.size} third-party action reference(s) pinned by SHA, least-privilege permissions and timeouts present.`
);
