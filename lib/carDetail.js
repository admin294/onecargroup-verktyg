// Car detail JSON via Next.js data route (no HTML parsing).
// GET /_next/data/<buildId>/kopa-bil/<brand>/<regnr-lower>.json -> pageProps.advertJson
// On 404 the buildId is stale -> re-scrape once and retry.
import { fetchWithUA, HttpError } from './http.js';
import { getBuildId, refreshBuildId, BASE_URL } from './buildId.js';
import { log } from './log.js';

function dataUrl(buildId, brand, regnrLower) {
  return `${BASE_URL}/_next/data/${buildId}/kopa-bil/${brand}/${regnrLower}.json`;
}

async function fetchData(buildId, brand, regnrLower) {
  const url = dataUrl(buildId, brand, regnrLower);
  const res = await fetchWithUA(url, { timeoutMs: 25000 });
  if (res.status === 404) throw new HttpError(`404 ${url}`, 404);
  if (!res.ok) throw new HttpError(`GET ${url} → ${res.status}`, res.status);
  return res.json();
}

/**
 * Fetch the raw advertJson for a car.
 * @param {{brand:string, regnrLower:string}} entry inventory entry
 * @returns {Promise<object>} advertJson
 */
export async function fetchAdvertJson({ brand, regnrLower }) {
  let buildId = await getBuildId();
  let json;
  try {
    json = await fetchData(buildId, brand, regnrLower);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      log.warn('data route 404 — refreshing buildId and retrying once');
      buildId = await refreshBuildId();
      json = await fetchData(buildId, brand, regnrLower);
    } else {
      throw err;
    }
  }
  const advert = json?.pageProps?.advertJson;
  if (!advert) throw new Error('advertJson saknas i data-svaret');
  return advert;
}
