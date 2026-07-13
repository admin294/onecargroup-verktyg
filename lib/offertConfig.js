// Data-driven offert configuration. Staff can edit these lists later without
// touching UI/logic. Prices in SEK. (From the prior iX3 tool.)

export const REGISTRERINGSAVGIFT = 1495;

// Garanti365-EV trappa (warranty ladder).
export const GARANTI_OPTIONS = [
  { id: 'garanti-0', label: 'Ingen förlängd garanti', years: 0, price: 0 },
  { id: 'garanti-1', label: 'Garanti365-EV — 1 år', years: 1, price: 5000 },
  { id: 'garanti-2', label: 'Garanti365-EV — 2 år', years: 2, price: 7500 },
  { id: 'garanti-3', label: 'Garanti365-EV — 3 år', years: 3, price: 9500 },
  { id: 'garanti-4', label: 'Garanti365-EV — 4 år', years: 4, price: 11000 },
  { id: 'garanti-5', label: 'Garanti365-EV — 5 år', years: 5, price: 13000 },
];

// Däckval (tire options) — editable example list.
export const DACK_OPTIONS = [
  { id: 'dack-behall', label: 'Behåll befintliga', price: 0 },
  { id: 'dack-nokian', label: 'Begagnade Nokian friktion', price: 19195 },
  { id: 'dack-continental', label: 'Continental VikingContact 7 (premium ny)', price: 31269 },
  { id: 'dack-nankang', label: 'Nankang WS-1 (budget ny)', price: 33201 },
  { id: 'dack-yokohama', label: 'Yokohama IceGuard IG53 (mellan ny)', price: 38860 },
];

export const DEFAULT_GARANTI_ID = 'garanti-0';
export const DEFAULT_DACK_ID = 'dack-behall';

function findOption(list, id, fallbackId) {
  return list.find((o) => o.id === id) || list.find((o) => o.id === fallbackId);
}

/**
 * Compute an offer total from a base car price + selected options.
 * @param {number} carPrice
 * @param {{garantiId?:string, dackId?:string}} sel
 * @returns {{lines:Array<{label:string,amount:number}>, total:number,
 *   garanti:object, dack:object}}
 */
export function computeOffer(carPrice, sel = {}) {
  const base = Number(carPrice) || 0;
  const garanti = findOption(GARANTI_OPTIONS, sel.garantiId, DEFAULT_GARANTI_ID);
  const dack = findOption(DACK_OPTIONS, sel.dackId, DEFAULT_DACK_ID);

  const lines = [
    { label: 'Bilpris', amount: base },
    { label: garanti.label, amount: garanti.price },
    { label: dack.label, amount: dack.price },
    { label: 'Registreringsavgift', amount: REGISTRERINGSAVGIFT },
  ];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, garanti, dack };
}

/** The config the frontend needs to render the offer builder. */
export function offertConfigPublic() {
  return {
    registreringsavgift: REGISTRERINGSAVGIFT,
    garantiOptions: GARANTI_OPTIONS,
    dackOptions: DACK_OPTIONS,
    defaultGarantiId: DEFAULT_GARANTI_ID,
    defaultDackId: DEFAULT_DACK_ID,
  };
}
