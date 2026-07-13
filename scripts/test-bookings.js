// Booking store unit test (no network, no server). Run: node scripts/test-bookings.js
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookings-'));
process.env.DATA_DIR = dir;

const {
  createBooking, getBooking, getBookingByToken, cancelByToken,
  listBookings, markProcessed, markCancelledHandled, _internals,
} = await import('../lib/bookings.js');

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`); failed++; }
};

console.log('create + shape');
const a = await createBooking({
  regnr: 'RDM55F', carName: 'BMW iX3', kundNamn: 'Anna', kundTelefon: '070123',
  kundMejl: 'anna@ex.se', onskadDatum: '2026-07-20', onskadTid: '14:00',
});
const shape = ['id','regnr','carName','kundNamn','kundTelefon','kundMejl','onskadDatum',
  'onskadTid','status','cancelToken','createdAt','processedAt','calendarEventId','cancelHandledAt'];
check('all fields present', shape.every((k) => k in a));
check('status pending', a.status === 'pending');
check('processedAt/calendarEventId/cancelHandledAt null', a.processedAt === null && a.calendarEventId === null && a.cancelHandledAt === null);
check('id is 10-char base62', /^[A-Za-z0-9]{10}$/.test(a.id));
check('cancelToken is 48 hex', /^[a-f0-9]{48}$/.test(a.cancelToken));

console.log('lookup by id + token');
check('getBooking by id', (await getBooking(a.id))?.id === a.id);
check('getBookingByToken', (await getBookingByToken(a.cancelToken))?.id === a.id);
check('bad id rejected', (await getBooking('../../etc/passwd')) === null);
check('bad token rejected', (await getBookingByToken('nothex!!')) === null);
check('unknown token → null', (await getBookingByToken('deadbeef'.repeat(2))) === null);

console.log('cancel idempotent');
const c1 = await cancelByToken(a.cancelToken);
check('cancel ok + status cancelled', c1.ok && c1.booking.status === 'cancelled');
const c2 = await cancelByToken(a.cancelToken);
check('second cancel still ok (idempotent)', c2.ok && c2.booking.status === 'cancelled');
check('unknown token cancel → ok:false', (await cancelByToken('a'.repeat(32))).ok === false);

console.log('filters');
// a second, still-pending booking
const b = await createBooking({ kundNamn: 'Bo', kundTelefon: '070999', onskadDatum: '2026-08-01', onskadTid: '09:00' });
const all = await listBookings();
check('lists both', all.length === 2);
check('newest first', all[0].id === b.id);
const unprocessed = await listBookings({ unprocessed: 1 });
check('unprocessed = pending & processedAt null (only b)', unprocessed.length === 1 && unprocessed[0].id === b.id);
const cancelledUnhandled = await listBookings({ cancelledUnhandled: 1 });
check('cancelledUnhandled (only a)', cancelledUnhandled.length === 1 && cancelledUnhandled[0].id === a.id);
check('status filter', (await listBookings({ status: 'pending' })).length === 1);

console.log('automation transitions');
const p = await markProcessed(b.id, 'gcal-xyz');
check('markProcessed sets processedAt + calendarEventId', !!p.processedAt && p.calendarEventId === 'gcal-xyz');
check('unprocessed now empty', (await listBookings({ unprocessed: 1 })).length === 0);
const h = await markCancelledHandled(a.id);
check('markCancelledHandled sets cancelHandledAt', !!h.cancelHandledAt);
check('cancelledUnhandled now empty', (await listBookings({ cancelledUnhandled: 1 })).length === 0);
check('markProcessed unknown id → null', (await markProcessed('zzzzzzzzzz', 'x')) === null);

await fs.rm(dir, { recursive: true, force: true });
console.log('');
if (failed) { console.error(`FAILED: ${failed} check(s)`); process.exit(1); }
console.log('ALL BOOKING CHECKS PASSED');
