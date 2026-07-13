// Test-drive bookings (provkörningsbokningar). Persisted as small JSON files in
// the data volume, same style as lib/store.js. The app only STORES + EXPOSES
// bookings — email/SMS confirmation and calendar sync are done by an external
// automation that polls the auth-protected /api/bokningar endpoints. No TTL:
// bookings live until the automation (or an admin) is done with them.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from './log.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const BOOKINGS_DIR = path.join(DATA_DIR, 'bookings');

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function ensureDir() {
  fsSync.mkdirSync(BOOKINGS_DIR, { recursive: true });
}

/** Unguessable 10-char base62 id. */
function genId(len = 10) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % 62];
  return out;
}

/** Unguessable cancel token (48 hex chars). */
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function bookingPath(id) {
  return path.join(BOOKINGS_DIR, `${id}.json`);
}

// Path-traversal guards.
const isSafeId = (id) => typeof id === 'string' && /^[A-Za-z0-9]{6,16}$/.test(id);
const isSafeToken = (t) => typeof t === 'string' && /^[a-f0-9]{16,64}$/i.test(t);

async function readBooking(id) {
  try {
    return JSON.parse(await fs.readFile(bookingPath(id), 'utf8'));
  } catch {
    return null;
  }
}
async function writeBooking(b) {
  ensureDir();
  await fs.writeFile(bookingPath(b.id), JSON.stringify(b), 'utf8');
}

/**
 * Create a booking. Caller is responsible for input validation; this trusts the
 * (already-validated) fields and stamps the storage/lifecycle metadata.
 * @returns {Promise<object>} the stored booking
 */
export async function createBooking({
  regnr, carName, kundNamn, kundTelefon, kundMejl, onskadDatum, onskadTid,
}) {
  ensureDir();
  let id = genId();
  for (let i = 0; i < 5 && fsSync.existsSync(bookingPath(id)); i++) id = genId();

  const booking = {
    id,
    regnr: regnr ?? null,
    carName: carName ?? null,
    kundNamn,
    kundTelefon,
    kundMejl: kundMejl ?? null,
    onskadDatum,
    onskadTid,
    status: 'pending',
    cancelToken: genToken(),
    createdAt: new Date().toISOString(),
    processedAt: null,
    calendarEventId: null,
    cancelHandledAt: null,
  };
  await writeBooking(booking);
  log.info(`booking created: ${id} regnr=${regnr ?? '-'} datum=${onskadDatum} ${onskadTid}`);
  return booking;
}

/** Load a booking by id (or null). */
export async function getBooking(id) {
  if (!isSafeId(id)) return null;
  return readBooking(id);
}

/** Find a booking by its cancel token (or null). */
export async function getBookingByToken(token) {
  if (!isSafeToken(token)) return null;
  ensureDir();
  let files;
  try {
    files = await fs.readdir(BOOKINGS_DIR);
  } catch {
    return null;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const b = await readBooking(file.slice(0, -5));
    if (b && b.cancelToken === token) return b;
  }
  return null;
}

/**
 * Cancel a booking by token. Idempotent — cancelling an already-cancelled
 * booking still succeeds. Returns { ok, booking } or { ok:false } when unknown.
 */
export async function cancelByToken(token) {
  const booking = await getBookingByToken(token);
  if (!booking) return { ok: false, booking: null };
  if (booking.status !== 'cancelled') {
    booking.status = 'cancelled';
    await writeBooking(booking);
    log.info(`booking cancelled by customer: ${booking.id}`);
  }
  return { ok: true, booking };
}

/**
 * List bookings, newest first, with optional filters:
 *  - status: exact status match ('pending' | 'cancelled')
 *  - unprocessed: only status 'pending' with processedAt === null
 *  - cancelledUnhandled: only status 'cancelled' with cancelHandledAt === null
 */
export async function listBookings({ status, unprocessed, cancelledUnhandled } = {}) {
  ensureDir();
  let files;
  try {
    files = await fs.readdir(BOOKINGS_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const b = await readBooking(file.slice(0, -5));
    if (!b) continue;
    if (unprocessed && !(b.status === 'pending' && b.processedAt === null)) continue;
    if (cancelledUnhandled && !(b.status === 'cancelled' && b.cancelHandledAt === null)) continue;
    if (status && b.status !== status) continue;
    out.push(b);
  }
  out.sort((a, z) => (z.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

/** Mark a booking processed by the automation (calendar event created). */
export async function markProcessed(id, calendarEventId) {
  const booking = await getBooking(id);
  if (!booking) return null;
  booking.processedAt = new Date().toISOString();
  booking.calendarEventId = calendarEventId ?? null;
  await writeBooking(booking);
  log.info(`booking processed: ${id} calendarEventId=${booking.calendarEventId ?? '-'}`);
  return booking;
}

/** Mark a cancellation as handled by the automation (calendar event removed). */
export async function markCancelledHandled(id) {
  const booking = await getBooking(id);
  if (!booking) return null;
  booking.cancelHandledAt = new Date().toISOString();
  await writeBooking(booking);
  log.info(`booking cancellation handled: ${id}`);
  return booking;
}

export const _internals = { DATA_DIR, BOOKINGS_DIR, genId, genToken, isSafeId, isSafeToken };
