// Next.js buildId for riddermarkbil.se. Changes on their deploys.
// Scrape from homepage HTML, cache ~30 min. Exposed refresh() to bust on 404.
import { fetchText } from './http.js';
import { log } from './log.js';

const BASE = 'https://www.riddermarkbil.se';
const TTL_MS = 30 * 60 * 1000;

let cache = { value: null, at: 0 };

async function scrape() {
  const html = await fetchText(BASE + '/');
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error('Kunde inte hitta buildId i startsidans HTML');
  log.info('buildId scraped:', m[1]);
  return m[1];
}

/** Get cached buildId (scrapes if stale/empty). */
export async function getBuildId() {
  const now = Date.now();
  if (cache.value && now - cache.at < TTL_MS) {
    log.debug('buildId cache hit:', cache.value);
    return cache.value;
  }
  const value = await scrape();
  cache = { value, at: now };
  return value;
}

/** Force a re-scrape (used when a data route 404s → stale buildId). */
export async function refreshBuildId() {
  log.info('buildId force refresh');
  const value = await scrape();
  cache = { value, at: Date.now() };
  return value;
}

export const BASE_URL = BASE;
