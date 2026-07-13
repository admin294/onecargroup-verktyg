// Full lookup: regnr -> inventory feed entry -> clean, UI-ready car summary.
// One Car Group sells no EVs with battery certificates, so there is no battery
// field: the shape is make/model/price/mileage/equipment/images + priceExMoms.
// Only fields we actually have are set; anything missing is omitted/null rather
// than invented.
import { findInInventory } from './inventory.js';
import { normalizeRegnr, isValidRegnr } from './regnr.js';
import { getOwnerCount } from './carInfo.js';
import { log } from './log.js';

export class LookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LookupError';
    this.code = code; // 'bad_regnr' | 'not_in_stock' | 'fetch_error'
  }
}

// Swedish VAT is 25%; the advertised price is incl. moms and the ex-moms figure
// the site shows is exactly price / 1.25 (verified: 639 800 → 511 840).
const VAT_DIVISOR = 1.25;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the handful of HTML entities the feed emits (e.g. "fram &amp; bak"). */
function decodeEntities(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[name.toLowerCase()] : m))
    .trim();
}

/** Pick the largest ("main") image URL from a feed image object. */
function mainImageUrl(img) {
  const fmts = Array.isArray(img?.imageFormats) ? img.imageFormats : [];
  const byName = (n) => fmts.find((f) => f?.name === n)?.url;
  const url = byName('main') || byName('thumb') || fmts[0]?.url || null;
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
}

/** All image URLs, ordered by the feed's sortOrder, https-only, deduped. */
function imageUrls(images) {
  if (!Array.isArray(images)) return [];
  const ordered = [...images].sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0));
  const urls = ordered.map(mainImageUrl).filter(Boolean);
  return [...new Set(urls)];
}

/**
 * Build the CAR object from a One Car Group feed entry. Every field we cannot
 * derive is null/empty — never faked. No battery (OCG has no battery tests).
 * @param {object} entry raw feed entry { title, permalink, data }
 */
export function normalizeCar(entry) {
  const d = entry?.data || {};
  const price = d.price?.value ?? d.currentPrice ?? null;
  const showExVat = Boolean(d.price?.showExcludingVat);
  const priceExMoms = showExVat && price != null ? Math.round(price / VAT_DIVISOR) : null;

  const make = d.make || null;
  const model = d.model || null;
  const hk = Number.isFinite(d.enginePower) ? d.enginePower : null;
  const year = d.modelYear ?? null;
  // Compact heading in the same shape the frontend expects ("Make Model, NNNhk, YYYY").
  const carName =
    [make && model ? `${make} ${model}` : make || model, hk ? `${hk}hk` : null, year || null]
      .filter(Boolean)
      .join(', ') || decodeEntities(entry?.title) || null;

  const images = imageUrls(d.images);

  return {
    regnr: normalizeRegnr(d.regNo),
    sourceUrl: entry?.permalink || null,
    make,
    model,
    modelDescription: decodeEntities(d.modelRaw) || null,
    carName,
    modelYear: year,
    enginePower: hk,
    price,
    priceExMoms,
    initialPrice: d.price?.previousValue ?? price,
    mileageMil: Number.isFinite(d.milage) ? d.milage : null,
    color: decodeEntities(d.freetextColor || d.color) || null,
    fuelType: d.fuel || null,
    gearbox: d.gearBox || null,
    vin: d.vin || null, // not present in the OCG feed today → null
    isSold: false, // sold cars drop out of the feed entirely
    location: d.city || d.dealer?.address?.city || null,
    coverImage: images[0] || null,
    images,
    equipment: Array.isArray(d.equipment)
      ? d.equipment.map(decodeEntities).filter(Boolean)
      : [],
    ownerCount: null, // filled below, best-effort
  };
}

/**
 * Full lookup for one regnr.
 * @param {string} regnr
 * @returns {Promise<object>} normalized car summary
 */
export async function lookupCar(regnr) {
  const norm = normalizeRegnr(regnr);
  if (!isValidRegnr(norm)) {
    throw new LookupError(`Ogiltigt registreringsnummer: "${regnr}"`, 'bad_regnr');
  }

  log.info(`lookup ${norm} start`);
  let entry;
  try {
    entry = await findInInventory(norm);
  } catch (err) {
    log.error(`lookup ${norm} inventory failed:`, err.message);
    throw new LookupError('Kunde inte hämta lagerdata just nu', 'fetch_error');
  }
  if (!entry) {
    throw new LookupError('Bilen finns inte i One Car Groups lager', 'not_in_stock');
  }

  const car = normalizeCar(entry);

  // Owner count from car.info — cached ~24h, best-effort. Never breaks the lookup.
  car.ownerCount = await getOwnerCount(norm);

  log.info(
    `lookup ${norm} ok: ${car.make} ${car.model} price=${car.price} exMoms=${car.priceExMoms ?? '-'} owners=${car.ownerCount ?? '-'}`
  );
  return car;
}
