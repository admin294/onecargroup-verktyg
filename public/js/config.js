// config.js — offert-konstanter, totalberäkning och formatterare.
// Dessa konstanter ägs av frontend enligt API-kontraktet. Backend lagrar bara
// `config`-objektet i posten; själva prislogiken bor här.

// Garanti-trappa (Garanti365-EV), SEK. 0 år = 0 kr. 5000 kr per år.
// 5 år är en KAMPANJ: 13000 kr i stället för ordinarie 25000 kr.
export const GARANTI_SEK = { 0: 0, 1: 5000, 2: 10000, 3: 15000, 4: 20000, 5: 13000 };

// Kampanjinfo per garantiår (ordinarie pris + etikett) för år med rabatt.
export const GARANTI_KAMPANJ = { 5: { ordinariePris: 25000, etikett: 'KAMPANJ' } };

// Registreringsavgift — egen rad i offerten.
export const REG_AVGIFT_SEK = 1495;

// Säljarkontakt som visas på den publika kundsidan (/kund).
export const KONTAKT = {
  namn: 'One Car Group',
  titel: 'Försäljning · Uppsala',
  telefon: '018-32 32 80',
  mejl: 'info@onecargroup.se',
  sprak: 'Svenska',
};

// Kampanjen gäller i 48 timmar. Nedräkningen ankras till postens createdAt
// (delad länk) eller till sidladdningen (live-byggaren innan den sparats).
export const KAMPANJ_TIMMAR = 48;

// Deadline (ms) = startpunkt (ms) + 48 h.
export function kampanjDeadline(startMs) {
  return Number(startMs) + KAMPANJ_TIMMAR * 3600 * 1000;
}

// Återstående ms → "HH:MM:SS" (klampas till 00:00:00, aldrig negativt).
export function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms) / 1000));
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

// Däckval. Ordningen här är visningsordningen i gränssnittet.
export const DACK = [
  { key: 'behall',      label: 'Inga vinterdäck',                       desc: 'Inga vinterdäck tillkommer',    price: 0 },
  { key: 'nokian',      label: 'Begagnade Nokian friktion',             desc: '5–6 mm mönsterdjup',            price: 19195 },
  { key: 'continental', label: 'Continental VikingContact 7',           desc: 'Premium, nya',                  price: 31269 },
  { key: 'nankang',     label: 'Nankang WS-1',                          desc: 'Budget, nya',                   price: 33201 },
  { key: 'yokohama',    label: 'Yokohama IceGuard IG53',                desc: 'Mellanklass, nya',              price: 38860 },
];

export const DACK_BY_KEY = Object.fromEntries(DACK.map((d) => [d.key, d]));

export const GARANTI_AR = [0, 1, 2, 3, 4, 5];

// Standardkonfig för en ny offert.
export function defaultConfig() {
  return {
    warrantyYears: 0,
    tireOptionKey: 'behall',
    customer: { name: '', org: '', email: '', phone: '' },
    notes: '',
  };
}

// Total = bilpris + garanti + däck + registreringsavgift.
// Returnerar en radbrytning så gränssnittet kan visa den post för post.
export function priceBreakdown(car, config) {
  const cfg = config || defaultConfig();
  const carPrice = Number(car?.price) || 0;
  const warrantyYears = GARANTI_SEK[cfg.warrantyYears] != null ? cfg.warrantyYears : 0;
  const garanti = GARANTI_SEK[warrantyYears] || 0;
  const dack = DACK_BY_KEY[cfg.tireOptionKey] || DACK_BY_KEY.behall;

  const lines = [
    { key: 'car',      label: car?.carName || 'Bilpris',                                amount: carPrice, base: true },
    { key: 'garanti',  label: warrantyYears ? `Garanti365-EV, ${warrantyYears} år${GARANTI_KAMPANJ[warrantyYears] ? ' (kampanj)' : ''}` : 'Garanti', amount: garanti, muted: !warrantyYears, sub: warrantyYears ? null : 'Ingen förlängd garanti' },
    { key: 'dack',     label: `Däck: ${dack.label}`,                                    amount: dack.price, muted: !dack.price, sub: dack.desc },
    { key: 'reg',      label: 'Registreringsavgift',                                    amount: REG_AVGIFT_SEK },
  ];
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total, garanti, dack, warrantyYears };
}

// ---- Formatterare (svensk lokalisering) ----

const sek0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// "364 800 kr". null → "—".
export function kr(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${sek0.format(Math.round(Number(n)))} kr`;
}

// Rått tal utan enhet: "364 800".
export function num(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return sek0.format(Number(n));
}

// "8 623 mil" (mileageMil är svenska mil, 1 mil = 10 km).
export function mil(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${sek0.format(Number(n))} mil`;
}

// "94,1 %".
export function pct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${(digits === 1 ? dec1 : sek0).format(Number(n))} %`;
}

// "460 km".
export function km(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${sek0.format(Number(n))} km`;
}

// ISO-datum → "8 apr 2025". Faller tillbaka till råtext om ogiltigt.
export function datum(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Vilket regnr som helst → normaliserad versal utan blanksteg.
export function normRegnr(s) {
  return String(s || '').toUpperCase().replace(/[\s-]+/g, '').trim();
}
