// carInfo backoff/cache test. Uses a fake globalThis.fetch so it NEVER touches
// real car.info. Proves: (1) after a 429 the global backoff blocks all further
// network calls until blockedUntil; (2) a fresh cache hit returns with no
// network; (3) the warmer/fetch caches a real success once unblocked.
// Run: node scripts/test-carinfo.js
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carinfo-'));
process.env.DATA_DIR = dir;
process.env.CARINFO_TTL_HOURS = '24';

// Fake network: a call counter + a scripted next response.
let calls = 0;
let next = { status: 200, headers: {}, body: '' };
globalThis.fetch = async () => {
  calls += 1;
  const { status, headers, body } = next;
  return new Response(body, { status, headers });
};

const { getOwnerCount, _internals } = await import('../lib/carInfo.js');

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`); failed++; }
};

// 1. A 429 (retry-after 60s) triggers exactly one network call and sets backoff.
console.log('429 → global backoff');
next = { status: 429, headers: { 'retry-after': '60' }, body: 'rate limited' };
const r1 = await getOwnerCount('AAA111');
check('429 returns null', r1 === null);
check('one network call made', calls === 1);
check('now blocked', _internals.isBlocked() === true);
const cachedAfter429 = await fs
  .readFile(path.join(dir, 'carinfo', 'AAA111.json'), 'utf8')
  .then(() => true)
  .catch(() => false);
check('429 wrote NO cache file', cachedAfter429 === false);
check('AAA111 enqueued for warming', _internals.queued('AAA111') === true);

// 2. While blocked, further lookups skip the network entirely.
console.log('while blocked → no network');
next = { status: 200, headers: {}, body: '<span class="sptitle">Antal ägare</span> 9' };
const r2 = await getOwnerCount('BBB222');
check('blocked lookup returns null', r2 === null);
check('no extra network call (still 1)', calls === 1);
check('BBB222 enqueued for later warming', _internals.queued('BBB222') === true);

// 3. A fresh cache hit returns without any network call.
console.log('fresh cache hit → no network');
await fs.mkdir(path.join(dir, 'carinfo'), { recursive: true });
await fs.writeFile(
  path.join(dir, 'carinfo', 'CCC333.json'),
  JSON.stringify({ regnr: 'CCC333', ownerCount: 7, at: Date.now() }),
);
const callsBefore = calls;
const r3 = await getOwnerCount('CCC333');
check('cache hit returns cached value', r3 === 7);
check('no network call for cache hit', calls === callsBefore);

// 4. Once the backoff clears, a real success is fetched + cached (parse works).
console.log('unblocked → fetch + cache success');
_internals.setBlockedUntil(0); // simulate cool-down elapsed
next = { status: 200, headers: {}, body: '<div><span class="sptitle">Antal ägare</span>\n   3</div>' };
const r4 = await getOwnerCount('RDM55F');
check('parses ownerCount 3', r4 === 3);
check('one more network call', calls === callsBefore + 1);
const r4again = await getOwnerCount('RDM55F');
check('second call served from cache (no refetch)', r4again === 3 && calls === callsBefore + 1);

// 5. The warmer drains the queue one item per tick, only when unblocked.
console.log('warmer drains queue when unblocked');
_internals.clearPending();
_internals.setBlockedUntil(0);
// Prime the queue via a blocked deferral, then unblock and warm.
_internals.setBlockedUntil(Date.now() + 60_000);
await getOwnerCount('DDD444'); // deferred + queued
check('DDD444 queued while blocked', _internals.queued('DDD444') === true);
check('warmTick is a no-op while blocked', (await (async () => { const c = calls; await _internals.warmTick(); return calls === c; })()));
_internals.setBlockedUntil(0);
next = { status: 200, headers: {}, body: '<span class="sptitle">Antal ägare</span> 5' };
const c5 = calls;
await _internals.warmTick();
check('warmTick fetched one queued regnr', calls === c5 + 1);
check('queue drained', _internals.pendingSize() === 0);
const warmed = await getOwnerCount('DDD444');
check('warmed value now cached (=5, no new fetch)', warmed === 5 && calls === c5 + 1);

await fs.rm(dir, { recursive: true, force: true });
console.log('');
if (failed) { console.error(`FAILED: ${failed} check(s)`); process.exit(1); }
console.log('ALL CARINFO CHECKS PASSED');
