import assert from 'node:assert/strict';

// Run against a production server, after `pnpm --filter web build` and `start`.
// Pass http://localhost:3000/beta when testing a build with NEXT_PUBLIC_BASE_PATH=/beta.
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
let checked = 0;

async function request(path, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: { 'Accept-Language': 'en', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  checked++;
  return response;
}

for (const prefix of ['', '/tr']) {
  for (const path of ['/not-found-check', '/not-found-check/nested', '/docs/not-found-check']) {
    const response = await request(`${prefix}${path}`);
    assert.equal(response.status, 404, `${prefix}${path}: expected HTTP 404`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /<meta name="robots" content="[^"]*noindex/);
  }

  for (const path of ['/docs', '/docs/quick-start']) {
    const response = await request(`${prefix}${path}`);
    assert.equal(response.status, 200, `${prefix}${path}: existing docs must still load`);
  }
}

// Missing-page negotiation should use the same language behavior as the rest of the site.
for (const headers of [{ 'Accept-Language': 'tr' }, { Cookie: 'bp_locale=tr' }]) {
  const response = await request('/not-found-check', headers);
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location'), base).pathname,
    `${new URL(base).pathname.replace(/\/$/, '')}/tr/not-found-check`);
}

for (const path of ['/brand/better-payment-horizontal-color.svg', '/brand/better-payment-horizontal-dark.svg']) {
  const response = await request(path, { Cookie: 'bp_locale=tr' });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/);
}
const search = await request('/api/search?query=callback');
assert.equal(search.status, 200, 'Search API must not be captured by the fallback route');
assert.match(search.headers.get('content-type') ?? '', /application\/json/);
assert.ok(Array.isArray(await search.json()));

for (const theme of ['not-found-lanes', 'not-found-lanes-dark']) {
  const path = `/brand/not-found/${theme}.webp`;
  const response = await request(path, { Cookie: 'bp_locale=tr' });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /image\/webp/);
  assert.ok((await response.arrayBuffer()).byteLength > 0, `${path}: empty artwork`);
}

console.log(`Passed ${checked} HTTP checks at ${base}. Verify localized content, links, focus and themes in a browser too.`);
