// Data-layer smoke test. Verifies the lookup pipeline against RDM55F plus the
// store TTL sweep. Run: node scripts/test-data.js
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { lookupCar, LookupError } from '../lib/lookup.js';
import { computeOffer } from '../lib/offertConfig.js';
import { normalizeRegnr, isValidRegnr } from '../lib/regnr.js';

let failed = 0;
function ok(name) {
  console.log(`  ✓ ${name}`);
}
function check(name, cond) {
  if (cond) ok(name);
  else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

async function testRegnr() {
  console.log('regnr normalize/validate');
  check('lowercase+spaces normalize', normalizeRegnr(' rdm 55f ') === 'RDM55F');
  check('hyphen strip', normalizeRegnr('abc-123') === 'ABC123');
  check('valid 3+3', isValidRegnr('ABC123'));
  check('valid 3+2+1', isValidRegnr('RDM55F'));
  check('invalid junk', !isValidRegnr('12ABC3'));
}

async function testLookup() {
  console.log('lookup RDM55F (live)');
  const car = await lookupCar('RDM55F');
  console.log(
    `    -> ${car.make} ${car.model} | ${car.price} kr | ${car.mileageMil} mil | SOH ${car.battery?.soh} | WLTP ${car.wltpRangeKm}km`
  );
  check('make BMW', car.make === 'BMW');
  check('model iX3', car.model === 'iX3');
  check('price 364800', car.price === 364800);
  check('mileageMil 8623', car.mileageMil === 8623);
  check('gearbox Automatisk', car.gearbox === 'Automatisk');
  check('vin set', car.vin === 'WBY7X4101MS156671');
  check('location Örebro', car.location === 'Örebro');
  check('wltpRangeKm 460', car.wltpRangeKm === 460);
  check('battery.soh ~94.1', Math.abs((car.battery?.soh ?? 0) - 94.1) < 0.05);
  check('battery.rating GOD HÄLSA', /GOD H/.test(car.battery?.rating || ''));
  check('battery.energyNowKwh 77', car.battery?.energyNowKwh === 77);
  check('battery.energyNewKwh 82', car.battery?.energyNewKwh === 82);
  check('battery.wltpNowKm 433', car.battery?.wltpNowKm === 433);
  check('battery.wltpNewKm 460', car.battery?.wltpNewKm === 460);
  check('battery.certUrl set', typeof car.battery?.certUrl === 'string' && car.battery.certUrl.includes('blob.core.windows.net'));
  check('images hotlinked (https only)', car.images.length > 0 && car.images.every((u) => /^https:\/\//.test(u)));
  check('coverImage set', !!car.coverImage);
  check('equipment list non-empty', car.equipment.length > 0);
  check('inspection shape', car.inspection && car.inspection.date === '2025-04-08');
  return car;
}

async function testOffer(car) {
  console.log('offer total math');
  const { total, lines } = computeOffer(car.price, { garantiId: 'garanti-3', dackId: 'dack-continental' });
  // 364800 + 9500 + 31269 + 1495
  check('total = 407064', total === 364800 + 9500 + 31269 + 1495);
  check('4 breakdown lines', lines.length === 4);
}

async function testNotFound() {
  console.log('unknown regnr');
  try {
    await lookupCar('ZZZ999');
    check('should have thrown not_in_stock', false);
  } catch (e) {
    check('LookupError not_in_stock', e instanceof LookupError && e.code === 'not_in_stock');
  }
}

async function testStoreTTL() {
  console.log('store TTL sweep (short TTL override)');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdm-store-'));
  process.env.DATA_DIR = dir;
  process.env.RECORD_TTL_DAYS = '0'; // everything is immediately expired
  const store = await import('../lib/store.js?ttl-test'); // fresh module w/ env
  const rec = await store.saveRecord({ mode: 'offert', payload: { regnr: 'RDM55F', total: 407064 } });
  check('record file id length ok', rec.id.length === 10);
  // With TTL=0 the record is already expired -> getRecord returns null.
  const got = await store.getRecord(rec.id);
  check('expired record lazily hidden', got === null);
  const removed = await store.cleanupExpired();
  check('cleanup removed >=1', removed >= 1);
  await fs.rm(dir, { recursive: true, force: true });
}

async function testStoreLive() {
  console.log('store save/get roundtrip (long TTL)');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdm-store2-'));
  process.env.DATA_DIR = dir;
  process.env.RECORD_TTL_DAYS = '7';
  const store = await import('../lib/store.js?live-test');
  const rec = await store.saveRecord({ mode: 'jamforelse', payload: { regnrs: ['RDM55F'] } });
  const got = await store.getRecord(rec.id);
  check('roundtrip payload intact', got && got.payload.regnrs[0] === 'RDM55F');
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
