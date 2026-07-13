// Inventory index for One Car Group.
//
// Source: the dealer feed the website itself renders from —
//   GET https://www.onecargroup.se/wp-json/accesspackage/v1/cars
// One call returns the FULL inventory (~90 cars) with every field we need
// already structured (regNo, price, milage, images, equipment, …). There is no
// per-car fetch: the feed entry IS the detail. Detail pages (/bil/<slug>/) only
// carry page-level JSON-LD (WebSite/Organization), never the car data, so the
// API is the correct — and only reliable — structured source.
//
// The index maps regNo(UPPER) -> the raw feed entry. Cached in memory (~1h) and
// mirrored to the data volume so a restart / brief upstream outage still serves.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fetchJson } from './http.js';
import { log } from './log.js';
import { normalizeRegnr } from './regnr.js';

export const CARS_URL =
  process.env.OCG_CARS_URL ||
  'https://www.onecargroup.se/wp-json/accesspackage/v1/cars';

const TTL_MS = Number(process.env.INVENTORY_TTL_MINUTES || 60) * 60 * 1000;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(DATA_DIR, 'inventory.json');

// { map: Map<regNo, entry>, at: epochMs } — the live in-memory index.
let cache = { map: null, at: 0 };

/** Build a regNo(UPPER) -> entry map from the raw feed array. */
function indexByRegnr(cars) {
  const map = new Map();
  if (!Array.isArray(cars)) return map;
  for (const entry of cars) {
    const regnr = normalizeRegnr(entry?.data?.regNo);
    if (!regnr) continue; // no plate → not addressable by our lookup
    map.set(regnr, entry);
  }
  return map;
}

/** Persist the raw feed to the data volume (best-effort; never throws). */
async function writeDiskCache(cars) {
  try {
    fsSync.mkdirSync(DATA_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify({ at: Date.now(), cars }), 'utf8');
  } catch (e) {
    log.warn(`inventory disk cache write failed: ${e.message}`);
  }
}

/** Load the last persisted feed from disk (stale is fine as a fallback). */
async function readDiskCache() {
  try {
    const c = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
    if (Array.isArray(c.cars)) return c;
  } catch { /* no usable disk cache */ }
  return null;
}

/**
 * Fetch the feed and refresh both caches. On network failure, fall back to the
 * last disk cache so lookups keep working during a brief upstream outage.
 */
async function refresh() {
  const t0 = Date.now();
  try {
    const cars = await fetchJson(CARS_URL, { timeoutMs: 30000 });
    const map = indexByRegnr(cars);
    cache = { map, at: Date.now() };
    await writeDiskCache(cars);
    log.info(`inventory loaded: ${map.size} cars in ${Date.now() - t0}ms`);
    return map;
  } catch (err) {
    log.error(`inventory fetch failed: ${err.message} — trying disk cache`);
    const disk = await readDiskCache();
    if (disk) {
      const map = indexByRegnr(disk.cars);
      // Mark it slightly stale so the next access retries the network, but keep
      // serving rather than failing every lookup.
      cache = { map, at: Date.now() - TTL_MS + 60_000 };
      log.warn(`inventory served from disk cache: ${map.size} cars (age ${Math.round((Date.now() - disk.at) / 60000)}min)`);
      return map;
    }
    throw err;
  }
}

/** Get the current index, refreshing if the in-memory copy is stale/empty. */
async function getMap() {
  const now = Date.now();
  if (cache.map && now - cache.at < TTL_MS) {
    log.debug('inventory cache hit');
    return cache.map;
  }
  return refresh();
}

/**
 * Look up a regnr in the inventory index.
 * @returns {Promise<object|null>} the raw feed entry, or null if not in stock
 */
export async function findInInventory(regnr) {
  const key = normalizeRegnr(regnr);
  if (!key) return null;
  const map = await getMap();
  return map.get(key) || null;
}

/** For diagnostics / warm-up / tests. */
export async function inventorySize() {
  const map = await getMap();
  return map.size;
}
