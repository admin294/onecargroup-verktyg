// Inventory index: regnr(UPPER) -> { brand, regnrLower, url }.
// Source: server-sitemap-adverts.xml (~2 MB, ~5000 URLs). Cache ~30 min in memory.
import { fetchText } from './http.js';
import { log } from './log.js';
import { BASE_URL } from './buildId.js';
import { normalizeRegnr } from './regnr.js';

const SITEMAP_URL = BASE_URL + '/server-sitemap-adverts.xml';
const TTL_MS = 30 * 60 * 1000;

let cache = { map: null, at: 0 };

// Each <loc>: https://www.riddermarkbil.se/kopa-bil/<brand-slug>/<regnr-lower>/
const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
const PATH_RE = /\/kopa-bil\/([^/]+)\/([^/]+)\/?$/;

function parseSitemap(xml) {
  const map = new Map();
  let m;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const loc = m[1].trim();
    const pm = loc.match(PATH_RE);
    if (!pm) continue;
    const brand = pm[1];
    const regnrLower = pm[2];
    const key = normalizeRegnr(regnrLower);
    if (!key) continue;
    map.set(key, { brand, regnrLower, url: loc });
  }
  return map;
}

async function load() {
  const t0 = Date.now();
  const xml = await fetchText(SITEMAP_URL, { timeoutMs: 30000 });
  const map = parseSitemap(xml);
  log.info(`inventory loaded: ${map.size} cars in ${Date.now() - t0}ms`);
  return map;
}

async function getMap() {
  const now = Date.now();
  if (cache.map && now - cache.at < TTL_MS) {
    log.debug('inventory cache hit');
    return cache.map;
  }
  const map = await load();
  cache = { map, at: now };
  return map;
}

/**
 * Look up a regnr in the inventory index.
 * @returns {Promise<{brand:string, regnrLower:string, url:string}|null>}
 */
export async function findInInventory(regnr) {
  const key = normalizeRegnr(regnr);
  if (!key) return null;
  const map = await getMap();
  return map.get(key) || null;
}

/** For diagnostics / tests. */
export async function inventorySize() {
  const map = await getMap();
  return map.size;
}
