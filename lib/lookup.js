// Full lookup: regnr -> inventory -> advertJson -> battery cert.
// Produces a clean, UI-ready car summary. Only fields we actually have are set;
// anything missing is omitted/null rather than invented.
import { findInInventory } from './inventory.js';
import { fetchAdvertJson } from './carDetail.js';
import { parseBatteryCert } from './battery.js';
import { normalizeRegnr, isValidRegnr } from './regnr.js';
import { getOwnerCount } from './carInfo.js';
import { log } from './log.js';

export class LookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LookupError';
    this.code = code; // 'invalid' | 'not_found' | 'fetch_failed'
  }
}

/** Swedish thousands formatting: 8623 -> "8 623". */
function sv(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toLocaleString('sv-SE').replace(/ /g, ' ');
}

// Pull the WLTP electric range (km) out of the attributes list, if present.
function wltpFromAttributes(attributes) {
  if (!Array.isArray(attributes)) return null;
  for (const a of attributes) {
    const d = a?.description || '';
    const m = d.match(/Elr[äa]ckvidd\s*\(WLTP\)[^0-9]*([0-9]{2,3})/i);
    if (m) return Number(m[1]);
  }
  // Fallback to NEDC if WLTP absent.
  for (const a of attributes) {
    const d = a?.description || '';
    const m = d.match(/Elr[äa]ckvidd\s*\(NEDC\)[^0-9]*([0-9]{2,3})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Strip a time component: "2026-01-21T00:00:00" -> "2026-01-21". */
function dateOnly(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : d;
}

function inspectionLike(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return {
    date: dateOnly(obj.date),
    mileageMil: obj.mileage ?? null,
  };
}

/**
 * Build the CAR object exactly per docs/API.md (the shared API contract).
 * Any field we cannot get is null — never faked. `battery` is filled by
 * lookupCar when a cert exists, else stays null (ICE / untested).
 */
export function normalizeCar(advert, entry) {
  const images = Array.isArray(advert.images)
    ? advert.images.map((i) => i?.url).filter(Boolean)
    : [];
  return {
    regnr: normalizeRegnr(advert.licenseplate || entry?.regnrLower),
    sourceUrl: entry?.url || null,
    make: advert.make || null,
    model: advert.model || null,
    modelDescription: advert.modelDescription || null,
    carName: advert.carName || null,
    modelYear: advert.modelYear ?? null,
    price: advert.price ?? null,
    initialPrice: advert.initialPrice ?? null,
    mileageMil: advert.mileage ?? null,
    color: advert.color || null,
    fuelType: advert.fuelType || null,
    gearbox: advert.gearboxType || null,
    batteryCapacityGrossKwh: advert.batteryCapacityGross ?? null,
    wltpRangeKm: wltpFromAttributes(advert.attributes),
    vin: advert.vinNumber || null,
    isSold: Boolean(advert.isSold),
    location: advert.location?.name || null,
    coverImage: images[0] || null,
    images,
    equipment: Array.isArray(advert.equipment)
      ? advert.equipment.map((e) => e?.description).filter(Boolean)
      : [],
    inspection: inspectionLike(advert.latestInspection),
    service: inspectionLike(advert.latestService),
    // batteryTestUrl is internal (drives the battery fetch); not part of CAR.
    battery: null,
    ownerCount: null,
  };
}

/**
 * Full lookup for one regnr.
 * @param {string} regnr
 * @param {{withBattery?:boolean}} [opts]
 * @returns {Promise<object>} normalized car summary (battery included when available)
 */
export async function lookupCar(regnr, opts = {}) {
  const { withBattery = true } = opts;
  const norm = normalizeRegnr(regnr);
  if (!isValidRegnr(norm)) {
    throw new LookupError(`Ogiltigt registreringsnummer: "${regnr}"`, 'bad_regnr');
  }

  log.info(`lookup ${norm} start`);
  const entry = await findInInventory(norm);
  if (!entry) {
    throw new LookupError('Bilen finns inte i Riddermarks lager', 'not_in_stock');
  }

  let advert;
  try {
    advert = await fetchAdvertJson(entry);
  } catch (err) {
    log.error(`lookup ${norm} advertJson failed:`, err.message);
    throw new LookupError('Kunde inte hämta bildata just nu', 'fetch_error');
  }

  const car = normalizeCar(advert, entry);

  const certUrl = advert.latestBatteryTestUrl || null;
  if (withBattery && certUrl) {
    try {
      car.battery = await parseBatteryCert(certUrl);
    } catch (err) {
      // Battery cert is best-effort: keep the URL so the PDF button still works.
      log.warn(`lookup ${norm} battery parse failed:`, err.message);
      car.battery = {
        certUrl,
        soh: null,
        rating: null,
        testDate: null,
        energyNowKwh: null,
        energyNewKwh: null,
        wltpNowKm: null,
        wltpNewKm: null,
      };
    }
  }

  // Owner count from car.info — cached ~24h, best-effort. Never breaks the lookup.
  car.ownerCount = await getOwnerCount(norm);

  log.info(
    `lookup ${norm} ok: ${car.make} ${car.model} price=${car.price} soh=${car.battery?.soh ?? '-'} owners=${car.ownerCount ?? '-'}`
  );
  return car;
}
