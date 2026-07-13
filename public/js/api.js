// api.js — tunt lager mot backend-endpointsen i API-kontraktet.
// Mock-läge (utveckling utan backend) slås på med ?mock=1 i URL:en; flaggan
// sparas i sessionStorage så delade /v/:id-länkar fungerar under demo.

import { MOCK_CARS, MOCK_NOT_IN_STOCK, RDM55F } from './fixture.js';
import { normRegnr } from './config.js';

const MOCK_KEY = 'rdm_mock';
if (new URLSearchParams(location.search).has('mock')) {
  sessionStorage.setItem(MOCK_KEY, '1');
}
export const MOCK = sessionStorage.getItem(MOCK_KEY) === '1';

const MOCK_RECORDS_KEY = 'rdm_mock_records';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* icke-JSON-svar */ }
  return { res, data };
}

async function get(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch { /* icke-JSON-svar */ }
  return { res, data };
}

// ---- Mock-hjälpare ----

function mockRecords() {
  try { return JSON.parse(localStorage.getItem(MOCK_RECORDS_KEY) || '{}'); }
  catch { return {}; }
}
function saveMockRecord(id, record) {
  const all = mockRecords();
  all[id] = record;
  localStorage.setItem(MOCK_RECORDS_KEY, JSON.stringify(all));
}
function mockId() {
  return 'demo-' + Math.random().toString(36).slice(2, 9);
}
// Mock-lookup: känd demo-bil → returnera den. Annat regnr → syntetisera en
// variant av RDM55F så att fälten ser rimliga ut, om det inte är ett
// medvetet "finns ej"-regnr.
function mockLookup(regnr) {
  const key = normRegnr(regnr);
  if (!key) return { ok: false, code: 'bad_regnr', error: 'Ange ett registreringsnummer.' };
  if (MOCK_NOT_IN_STOCK.has(key)) {
    return { ok: false, code: 'not_in_stock', error: 'Bilen finns inte i lager.' };
  }
  if (MOCK_CARS[key]) return { ok: true, car: MOCK_CARS[key] };
  const variant = { ...RDM55F, regnr: key, carName: `${RDM55F.carName} (demo ${key})`, isMock: true };
  return { ok: true, car: variant };
}

// ---- Publikt API ----

export async function apiMe() {
  if (MOCK) return { authed: sessionStorage.getItem('rdm_mock_authed') === '1' };
  try {
    const { data } = await get('/api/me');
    return { authed: !!(data && data.authed) };
  } catch {
    return { authed: false };
  }
}

export async function apiLogin(password) {
  if (MOCK) {
    await delay(300);
    if (password && String(password).length >= 1) {
      sessionStorage.setItem('rdm_mock_authed', '1');
      return { ok: true };
    }
    return { ok: false };
  }
  const { res, data } = await post('/api/login', { password });
  return { ok: res.ok && !!(data && data.ok) };
}

export async function apiLogout() {
  if (MOCK) {
    sessionStorage.removeItem('rdm_mock_authed');
    return { ok: true };
  }
  try { await post('/api/logout', {}); } catch { /* ignorera */ }
  return { ok: true };
}

// Slår upp ett regnr. Returnerar { ok, car } eller { ok:false, code, error }.
export async function apiLookup(regnr) {
  if (MOCK) {
    await delay(450);
    return mockLookup(regnr);
  }
  const { res, data } = await post('/api/lookup', { regnr: normRegnr(regnr) });
  if (res.status === 401) return { ok: false, code: 'unauthorized', error: 'Inte inloggad.' };
  if (data && typeof data.ok === 'boolean') return data;
  return { ok: false, code: 'fetch_error', error: 'Kunde inte hämta bilen.' };
}

// Publik kund-uppslagning (ingen auth) mot /api/kund/lookup. Samma svar-form
// som apiLookup. 429 = hastighetsbegränsad. Mock återanvänder mockLookup.
export async function apiKundLookup(regnr) {
  if (MOCK) {
    await delay(450);
    return mockLookup(regnr);
  }
  const { res, data } = await post('/api/kund/lookup', { regnr: normRegnr(regnr) });
  if (res.status === 429) return { ok: false, code: 'rate_limited', error: 'För många förfrågningar. Vänta en stund och försök igen.' };
  if (data && typeof data.ok === 'boolean') return data;
  return { ok: false, code: 'fetch_error', error: 'Kunde inte hämta bilen just nu.' };
}

// Bokar en provkörning (publik). Returnerar { ok, bookingId, avbokaUrl } eller { ok:false, error }.
export async function apiBoka({ regnr, carName, namn, telefon, mejl, datum, tid }) {
  if (MOCK) {
    await delay(400);
    const bookingId = 'bok-' + Math.random().toString(36).slice(2, 9);
    return { ok: true, bookingId, avbokaUrl: `/kund/avboka/${bookingId}` };
  }
  const { res, data } = await post('/api/kund/boka', { regnr, carName, namn, telefon, mejl, datum, tid });
  if (res.ok && data && data.ok) return data;
  return { ok: false, error: (data && data.error) || 'Kunde inte boka just nu.' };
}

// Sparar en post (offert/jämförelse) och returnerar { ok, id }.
export async function apiCreateRecord({ mode, regnrs, config, cars }) {
  if (MOCK) {
    await delay(350);
    const id = mockId();
    saveMockRecord(id, {
      mode, regnrs, cars, config,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id };
  }
  const { res, data } = await post('/api/records', { mode, regnrs, config, cars });
  if (res.ok && data && data.ok) return data;
  return { ok: false, error: (data && data.error) || 'Kunde inte skapa länk.' };
}

// Hämtar en sparad post (publikt, ingen auth). Returnerar { ok, record } eller { ok:false }.
export async function apiGetRecord(id) {
  if (MOCK) {
    await delay(250);
    const rec = mockRecords()[id];
    if (rec) return { ok: true, record: rec };
    return { ok: false };
  }
  const { res, data } = await get(`/api/records/${encodeURIComponent(id)}`);
  if (res.ok && data && data.ok) return data;
  return { ok: false };
}
