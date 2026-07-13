// carInfo.js — owner count ("Antal ägare") from car.info, cache-first and
// self-throttling. car.info rate-limits hard (HTTP 429 + long Retry-After), so:
//   • a fresh 24h cache hit NEVER hits the network;
//   • a GLOBAL backoff window (blockedUntil) stops ALL car.info requests while
//     rate-limited — during a block we return the cache or null and enqueue the
//     regnr for later warming, so a lookup is never slowed by car.info;
//   • a LAZY WARMER drains the queue one regnr per minute, only when unblocked,
//     so owner counts populate within a couple of minutes without hammering.
// Every failure path returns null (best-effort) and never breaks the lookup.
// A 429 is NEVER cached as a value; a genuine result (incl. a real null) is.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fetchWithUA } from './http.js';
import { normalizeRegnr } from './regnr.js';
import { log } from './log.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'carinfo');
const TTL_MS = Number(process.env.CARINFO_TTL_HOURS || 24) * 60 * 60 * 1000;
const TIMEOUT_MS = Number(process.env.CARINFO_TIMEOUT_MS || 6000);
const DEFAULT_BACKOFF_MS = Number(process.env.CARINFO_BACKOFF_SECONDS || 900) * 1000; // 15 min
const WARM_INTERVAL_MS = Number(process.env.CARINFO_WARM_INTERVAL_MS || 60_000);
const QUEUE_MAX = Number(process.env.CARINFO_QUEUE_MAX || 200);

// Module-level state: the global cool-down deadline and the warm queue.
let blockedUntil = 0;
const pending = new Set(); // regnrs waiting to be warmed (deduped, capped)

const cachePath = (regnr) => path.join(CACHE_DIR, `${regnr}.json`);
const isBlocked = (now = Date.now()) => now < blockedUntil;

async function readCache(regnr) {
  try {
    const c = JSON.parse(await fs.readFile(cachePath(regnr), 'utf8'));
    if (Date.now() - c.at <= TTL_MS) return c; // fresh (a cached null still counts)
  } catch { /* miss */ }
  return null;
}
async function writeCache(regnr, ownerCount) {
  try {
    fsSync.mkdirSync(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath(regnr), JSON.stringify({ regnr, ownerCount, at: Date.now() }), 'utf8');
  } catch (e) { log.warn(`carinfo cache write failed for ${regnr}: ${e.message}`); }
}

// VERIFIED against RDM55F (= 3): <span class="sptitle">Antal ägare</span> 3
function parseOwnerCount(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<span class="sptitle">Antal ägare<\/span>\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function enqueue(norm) {
  if (pending.has(norm)) return;
  if (pending.size >= QUEUE_MAX) return; // cap the queue so it can't grow unbounded
  pending.add(norm);
}

// The ONE network path. Sets the global backoff on 429 (and enqueues for a later
// retry). Never throws; returns the owner count, or null on any miss/failure.
async function fetchAndCache(norm) {
  const url = `https://www.car.info/sv-se/license-plate/S/${norm}`;
  try {
    const res = await fetchWithUA(url, { timeoutMs: TIMEOUT_MS });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      const backoffMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : DEFAULT_BACKOFF_MS;
      blockedUntil = Date.now() + backoffMs;
      enqueue(norm); // retry once the cool-down clears
      log.warn(`carinfo 429 for ${norm} — global backoff ${Math.round(backoffMs / 1000)}s`);
      return null; // do NOT cache a rate-limited miss
    }
    if (!res.ok) { log.warn(`carinfo ${norm} → ${res.status}`); return null; }
    const owner = parseOwnerCount(await res.text());
    await writeCache(norm, owner); // cache the real result (incl. a genuine null) for TTL
    log.info(`carinfo ${norm} ownerCount=${owner ?? '-'}`);
    return owner;
  } catch (e) {
    log.warn(`carinfo fetch failed for ${norm}: ${e.message} — null`);
    return null;
  }
}

/**
 * Owner count for a regnr. Cache-first; never hits the network while blocked.
 * Always resolves to an integer or null, and never throws.
 */
export async function getOwnerCount(regnr) {
  const norm = normalizeRegnr(regnr);
  if (!norm) return null;

  const cached = await readCache(norm);
  if (cached) { log.debug(`carinfo cache hit ${norm}=${cached.ownerCount}`); return cached.ownerCount; }

  if (isBlocked()) {
    enqueue(norm); // warm it later; do not slow the lookup while rate-limited
    log.debug(`carinfo blocked (${Math.round((blockedUntil - Date.now()) / 1000)}s left) — deferring ${norm}`);
    return null;
  }

  return fetchAndCache(norm);
}

// One warmer tick: only when unblocked, pop a single pending regnr and cache it.
async function warmTick() {
  if (isBlocked() || pending.size === 0) return;
  const norm = pending.values().next().value;
  pending.delete(norm);
  const cached = await readCache(norm);
  if (cached) return; // already warmed since it was queued
  log.debug(`carinfo warming ${norm} (queue ${pending.size} left)`);
  await fetchAndCache(norm);
}

const warmer = setInterval(() => { warmTick().catch(() => {}); }, WARM_INTERVAL_MS);
if (warmer.unref) warmer.unref();

// Test-only hooks (not part of the public API).
export const _internals = {
  parseOwnerCount,
  warmTick,
  isBlocked,
  getBlockedUntil: () => blockedUntil,
  setBlockedUntil: (v) => { blockedUntil = v; },
  pendingSize: () => pending.size,
  queued: (norm) => pending.has(normalizeRegnr(norm)),
  clearPending: () => pending.clear(),
};
