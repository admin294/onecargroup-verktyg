// Data-layer smoke test for the One Car Group inventory. Verifies the live
// lookup pipeline (against a real, currently-listed regnr picked from the feed
// so it can't rot when a car sells), the ex-moms math, and the store TTL sweep.
// Run: node scripts/test-data.js
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { lookupCar, LookupError } from '../lib/lookup.js';
import { findInInventory, inventorySize, CARS_URL } from '../lib/inventory.js';
import { fetchJson } from '../lib/http.js';
import { computeOffer } from '../lib/offertConfig.js';
import { normalizeRegnr, isValidRegnr } from '../lib/regnr.js';

let failed = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
function check(name, cond) {
  if (cond) ok(name);
  else { console.error(`  ✗ ${name}`); failed++; }
}

async function testRegnr() {
  console.log('regnr normalize/validate');
  check('lowercase+spaces normalize', normalizeRegnr(' dsr 51c ') === 'DSR51C');
  check('hyphen strip', normalizeRegnr('abc-123') === 'ABC123');
  check('valid 3+3', isValidRegnr('ABC123'));
  check('valid 3+2+1', isValidRegnr('DSR51C'));
  check('invalid junk', !isValidRegnr('12ABC3'));
}

// Pick a real, currently-listed regnr straight from the live feed.
async function pickLiveRegnr() {
  const cars = await fetchJson(CARS_URL, { timeoutMs: 30000 });
  const first = cars.find((c) => c?.data?.regNo);
  assert(first, 'feed returned no cars with a regNo');
  return normalizeRegnr(first.data.regNo);
}

async function testLookup() {
  const size = await inventorySize();
  console.log(`inventory loaded (${size} cars)`);
  check('inventory non-empty', size > 0);

  const regnr = await pickLiveRegnr();
  console.log(`lookup ${regnr} (live)`);
  const car = await lookupCar(regnr);
  console.log(`    -> ${car.make} ${car.model} | ${car.price} kr | ex.moms ${car.priceExMoms} | ${car.mileageMil} mil | owners ${car.ownerCount}`);

  check('regnr echoed & valid', car.regnr === regnr && isValidRegnr(car.regnr));
  check('sourceUrl is a /bil/ permalink', typeof car.sourceUrl === 'string' && /\/bil\//.test(car.sourceUrl));
  check('make set', typeof car.make === 'string' && car.make.length > 0);
  check('carName built', typeof car.carName === 'string' && car.carName.length > 0);
  check('price is a positive number', typeof car.price === 'number' && car.price > 0);
  check('mileageMil is a number', typeof car.mileageMil === 'number');
  check('gearbox set', typeof car.gearbox === 'string');
  check('fuelType set', typeof car.fuelType === 'string');
  check('location set', typeof car.location === 'string');
  check('images hotlinked (https only)', car.images.length > 0 && car.images.every((u) => /^https:\/\//.test(u)));
  check('coverImage = first image', car.coverImage === car.images[0]);
  check('equipment list non-empty', car.equipment.length > 0);
  check('equipment entities decoded (no &amp;)', car.equipment.every((e) => !/&amp;|&#/.test(e)));
  check('no battery field', !('battery' in car));
  check('ownerCount is int or null', car.ownerCount === null || Number.isInteger(car.ownerCount));

  // ex-moms invariant: present iff the feed flags the car as VAT-deductible,
  // and always price / 1.25 when present.
  if (car.priceExMoms != null) {
    check('priceExMoms === round(price / 1.25)', car.priceExMoms === Math.round(car.price / 1.25));
  } else {
    ok('priceExMoms null (non-moms car)');
  }
  return car;
}

async function testOffer(car) {
  console.log('offer total math');
  const { total, lines } = computeOffer(car.price, { garantiId: 'garanti-3', dackId: 'dack-continental' });
  check('total = price + garanti + dack + reg', total === car.price + 9500 + 31269 + 1495);
  check('4 breakdown lines', lines.length === 4);
}

async function testNotFound() {
  console.log('unknown regnr (valid format, not in stock)');
  try {
    await lookupCar('ZZZ999');
    check('should have thrown not_in_stock', false);
  } catch (e) {
    check('LookupError not_in_stock', e instanceof LookupError && e.code === 'not_in_stock');
  }
  console.log('bad regnr format');
  try {
    await lookupCar('!!');
    check('should have thrown bad_regnr', false);
  } catch (e) {
    check('LookupError bad_regnr', e instanceof LookupError && e.code === 'bad_regnr');
  }
}

async function testStoreTTL() {
  console.log('store TTL sweep (short TTL override)');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocg-store-'));
  process.env.DATA_DIR = dir;
  process.env.RECORD_TTL_DAYS = '0';
  const store = await import('../lib/store.js?ttl-test');
  const rec = await store.saveRecord({ mode: 'offert', payload: { regnr: 'DSR51C', total: 650000 } });
  check('record file id length ok', rec.id.length === 10);
  check('expired record lazily hidden', (await store.getRecord(rec.id)) === null);
  check('cleanup removed >=1', (await store.cleanupExpired()) >= 1);
  await fs.rm(dir, { recursive: true, force: true });
}

async function testStoreLive() {
  console.log('store save/get roundtrip (long TTL)');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocg-store2-'));
  process.env.DATA_DIR = dir;
  process.env.RECORD_TTL_DAYS = '7';
  const store = await import('../lib/store.js?live-test');
  const rec = await store.saveRecord({ mode: 'jamforelse', payload: { regnrs: ['DSR51C'] } });
  const got = await store.getRecord(rec.id);
  check('roundtrip payload intact', got && got.payload.regnrs[0] === 'DSR51C');
  check('path traversal id rejected', (await store.getRecord('../../etc/passwd')) === null);
  await fs.rm(dir, { recursive: true, force: true });
}

async function main() {
  await testRegnr();
  const car = await testLookup();
  await testOffer(car);
  await testNotFound();
  await testStoreTTL();
  await testStoreLive();
  console.log('');
  if (failed) {
    console.error(`FAILED: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('ALL DATA-LAYER CHECKS PASSED');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
