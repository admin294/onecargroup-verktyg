// AVILOO battery certificate parsing. Fetch the PDF in memory, extract SOH %.
// NEVER write the PDF to disk — parse the buffer, keep the number + the URL.
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { fetchBuffer } from './http.js';
import { log } from './log.js';

/**
 * Fetch + parse an AVILOO certificate PDF.
 * @param {string} url latestBatteryTestUrl (ride.blob.core.windows.net)
 * @returns {Promise<{soh:number|null, sohRaw:string|null, energyNow:string|null,
 *   energyNew:string|null, wltpNow:string|null, wltpNew:string|null,
 *   rating:string|null, certNumber:string|null, testDate:string|null,
 *   testMileage:string|null, certUrl:string}>}
 */
export async function parseBatteryCert(url) {
  const t0 = Date.now();
  const buf = await fetchBuffer(url, { timeoutMs: 30000 });
  const parsed = await pdf(buf);
  const text = parsed.text || '';
  log.info(`battery PDF parsed: ${buf.length} bytes, ${text.length} chars in ${Date.now() - t0}ms`);

  const soh = extractSoh(text);
  return {
    certUrl: url,
    soh,
    ...extractNiceToHaves(text),
  };
}

/** SOH % — required. Returns a number like 94.1 or null. */
function extractSoh(text) {
  // Primary: value right after "HÄLSOTILLSTÅND (SOH)".
  let m = text.match(/H[ÄA]LSOTILLST[ÅA]ND\s*\(SOH\)\s*([0-9]{1,3}[.,][0-9])\s*%/i);
  if (!m) {
    // Fallback: first "NN,N %" appearing after the first "SOH" mention.
    const idx = text.search(/SOH/i);
    if (idx >= 0) {
      const after = text.slice(idx);
      m = after.match(/([0-9]{1,3}[.,][0-9])\s*%/);
    }
  }
  if (!m) return null;
  const val = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(val) ? val : null;
}

// Nice-to-haves parsed from the certificate's summary block, matching the API
// contract's battery shape (numeric kWh / km). Every pattern is anchored on a
// label so we never mis-pair a stray number — absent label → null (never faked).
function extractNiceToHaves(text) {
  const out = {
    rating: null,
    testDate: null,
    energyNowKwh: null,
    energyNewKwh: null,
    wltpNowKm: null,
    wltpNewKm: null,
  };

  // "ENERGI77kWh | 82kWh"  → now | new
  const energy = text.match(/ENERGI\s*([0-9]+)\s*kWh\s*\|\s*([0-9]+)\s*kWh/i);
  if (energy) {
    out.energyNowKwh = Number(energy[1]);
    out.energyNewKwh = Number(energy[2]);
  }

  // "WLTP-OMRÅDE433km | 460km"  → now | new
  const wltp = text.match(/WLTP[-\s]?OMR[ÅA]DE\s*([0-9]+)\s*km\s*\|\s*([0-9]+)\s*km/i);
  if (wltp) {
    out.wltpNowKm = Number(wltp[1]);
    out.wltpNewKm = Number(wltp[2]);
  }

  // Rating text (e.g. "GOD HÄLSA – INGA AVVIKELSER UPPTÄCKTA").
  const rating = text.match(/((?:UTM[ÄA]RKT|MYCKET GOD|GOD|GODK[ÄA]ND|SVAG|D[ÅA]LIG)\s+H[ÄA]LSA[^\n]*)/i);
  if (rating) out.rating = rating[1].replace(/\s+/g, ' ').trim();

  // "DATUM OCH TID:\n2026-05-12 11:18"
  const date = text.match(/DATUM OCH TID:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i)
    || text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) out.testDate = date[1];

  return out;
}
