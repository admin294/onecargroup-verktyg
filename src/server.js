// One Car Group Bilverktyg — backend server.
// Implements the shared API contract (docs/API.md) and serves public/ (built by
// the frontend session) as static. Backend owns: lib/, server.js, gate.json, docs/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../lib/log.js';
import { lookupCar, LookupError } from '../lib/lookup.js';
import {
  checkPassword,
  makeToken,
  requireAuth,
  sessionCookie,
  clearCookie,
  parseCookies,
  isValidToken,
  isConfigured,
  COOKIE_NAME,
} from '../lib/auth.js';
import { saveRecord, getRecord, startCleanupTimer } from '../lib/store.js';
import { inventorySize } from '../lib/inventory.js';
import { rateLimit } from '../lib/rateLimit.js';
import {
  createBooking,
  getBookingByToken,
  cancelByToken,
  listBookings,
  markProcessed,
  markCancelledHandled,
} from '../lib/bookings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const VALID_MODES = new Set(['offert', 'jamforelse']);

const app = express();
app.disable('x-powered-by');
// Trust the reverse proxy (Caddy) so req.ip is the real client — needed for
// the per-IP rate limit on the public customer lookup.
app.set('trust proxy', true);
app.use(express.json({ limit: '512kb' }));

// Request log (info level).
app.use((req, _res, next) => {
  log.debug(`${req.method} ${req.path}`);
  next();
});

// ---- Auth ----------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!isConfigured()) {
    log.error('login attempted but APP_PASSWORD is not configured');
    return res.status(500).json({ ok: false, error: 'server_not_configured' });
  }
  if (!checkPassword(password)) {
    log.info('login failed (wrong password)');
    return res.status(401).json({ ok: false });
  }
  res.setHeader('Set-Cookie', sessionCookie(makeToken(), { secure: IS_PROD }));
  log.info('login ok');
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authed: isValidToken(cookies[COOKIE_NAME]) });
});

// ---- Lookup (auth) -------------------------------------------------------
app.post('/api/lookup', requireAuth, async (req, res) => {
  const { regnr } = req.body || {};
  if (!regnr || typeof regnr !== 'string') {
    return res.json({ ok: false, code: 'bad_regnr', error: 'Registreringsnummer saknas' });
  }
  try {
    const car = await lookupCar(regnr);
    res.json({ ok: true, car });
  } catch (err) {
    if (err instanceof LookupError) {
      return res.json({ ok: false, code: err.code, error: err.message });
    }
    log.error('lookup unexpected error:', err.message);
    res.json({ ok: false, code: 'fetch_error', error: 'Ett oväntat fel inträffade' });
  }
});

// ---- Public customer lookup (NO auth, rate-limited) ----------------------
// Reuses lookupCar exactly like the staff endpoint. No requireAuth. Capped to
// 20/min/IP. No write/admin endpoint is ever exposed publicly.
const kundLimiter = rateLimit({ windowMs: 60_000, max: 20 });
app.post('/api/kund/lookup', kundLimiter, async (req, res) => {
  const { regnr } = req.body || {};
  if (!regnr || typeof regnr !== 'string') {
    return res.json({ ok: false, code: 'bad_regnr', error: 'Registreringsnummer saknas' });
  }
  try {
    const car = await lookupCar(regnr);
    res.json({ ok: true, car });
  } catch (err) {
    if (err instanceof LookupError) return res.json({ ok: false, code: err.code, error: err.message });
    log.error('kund lookup unexpected error:', err.message);
    res.json({ ok: false, code: 'fetch_error', error: 'Ett oväntat fel inträffade' });
  }
});

// ---- Records / share links ----------------------------------------------
app.post('/api/records', requireAuth, async (req, res) => {
  const { mode, regnrs, config, cars } = req.body || {};
  if (!VALID_MODES.has(mode)) {
    return res.status(400).json({ ok: false, error: 'invalid_mode' });
  }
  if (!Array.isArray(cars) || cars.length === 0) {
    return res.status(400).json({ ok: false, error: 'no_cars' });
  }
  // Snapshot: hold only the cars array (URLs only — never image/PDF bytes),
  // the offert config, and the regnrs. Frontend renders /v/:id from this.
  const regnrList = Array.isArray(regnrs) && regnrs.length
    ? regnrs
    : cars.map((c) => c?.regnr).filter(Boolean);
  const record = await saveRecord({
    mode,
    payload: { regnrs: regnrList, cars, config: config ?? null },
  });
  res.json({ ok: true, id: record.id });
});

app.get('/api/records/:id', async (req, res) => {
  const record = await getRecord(req.params.id);
  if (!record) return res.status(404).json({ ok: false });
  res.json({
    ok: true,
    record: {
      mode: record.mode,
      regnrs: record.payload.regnrs,
      cars: record.payload.cars,
      config: record.payload.config,
      createdAt: record.createdAt,
    },
  });
});

// ---- Test-drive bookings (provkörning) -----------------------------------
// The app only STORES + EXPOSES bookings. Email/SMS confirmation + calendar are
// handled by an external automation polling the auth-protected endpoints below.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// PUBLIC: create a booking. Same rate limiter as /api/kund/lookup.
app.post('/api/kund/boka', kundLimiter, async (req, res) => {
  const b = req.body || {};
  const namn = str(b.namn);
  const telefon = str(b.telefon);
  const datum = str(b.datum);
  const tid = str(b.tid);
  const mejl = str(b.mejl);

  const missing = [];
  if (!namn) missing.push('namn');
  if (!telefon) missing.push('telefon');
  if (!datum) missing.push('datum');
  if (!tid) missing.push('tid');
  if (missing.length) {
    return res.status(400).json({ ok: false, code: 'missing_fields', error: 'Fyll i namn, telefon, datum och tid.', missing });
  }
  if (mejl && !EMAIL_RE.test(mejl)) {
    return res.status(400).json({ ok: false, code: 'bad_email', error: 'Ogiltig e-postadress.' });
  }

  const booking = await createBooking({
    regnr: str(b.regnr) || null,
    carName: str(b.carName) || null,
    kundNamn: namn,
    kundTelefon: telefon,
    kundMejl: mejl || null,
    onskadDatum: datum,
    onskadTid: tid,
  });
  res.json({ ok: true, bookingId: booking.id, avbokaUrl: `/avboka/${booking.cancelToken}` });
});

// PUBLIC: cancel by token (idempotent). Same rate limiter.
app.post('/api/kund/avboka', kundLimiter, async (req, res) => {
  const token = str((req.body || {}).token);
  const result = await cancelByToken(token);
  if (!result.ok) return res.status(404).json({ ok: false, error: 'Bokningen hittades inte' });
  res.json({ ok: true });
});

// PUBLIC: self-contained cancellation page for the customer's link.
app.get('/avboka/:token', async (req, res) => {
  const booking = await getBookingByToken(req.params.token);
  res.status(booking ? 200 : 404).type('html').send(renderAvbokaPage(booking, req.params.token));
});

// ---- Booking poll endpoints for the automation (auth) --------------------
app.get('/api/bokningar', requireAuth, async (req, res) => {
  const filters = {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    unprocessed: req.query.unprocessed === '1' || req.query.unprocessed === 'true',
    cancelledUnhandled: req.query.cancelledUnhandled === '1' || req.query.cancelledUnhandled === 'true',
  };
  const bookings = await listBookings(filters);
  res.json({ ok: true, bookings });
});

app.post('/api/bokningar/:id/processed', requireAuth, async (req, res) => {
  const { calendarEventId } = req.body || {};
  const booking = await markProcessed(req.params.id, calendarEventId ?? null);
  if (!booking) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, booking });
});

app.post('/api/bokningar/:id/cancelled-handled', requireAuth, async (req, res) => {
  const booking = await markCancelledHandled(req.params.id);
  if (!booking) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, booking });
});

// ---- Health --------------------------------------------------------------
app.get('/healthz', async (_req, res) => {
  res.json({ ok: true });
});

// ---- Static + SPA fallbacks ---------------------------------------------
app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

// Public read-only share page. Serve v.html if the frontend provides one,
// otherwise fall back to the app shell (client renders via /api/records/:id).
app.get('/v/:id', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'v.html'), (err) => {
    if (err) res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (e2) => {
      if (e2) res.status(200).send(FALLBACK_HTML);
    });
  });
});

// Root + anything else not matched → app shell (so the SPA can route).
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) res.status(200).type('html').send(FALLBACK_HTML);
  });
});

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Self-contained cancellation page in a brand-neutral graphite palette (the
// frontend session owns the real One Car Group palette). No external assets.
// The Avboka button POSTs the token to /api/kund/avboka. Handles not-found and
// already-cancelled states.
function renderAvbokaPage(booking, token) {
  const shell = (body) => `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Avboka provkörning — One Car Group</title>
<style>
  :root{ --brand:#1a1a1a; --brand-dark:#000; --ink:#1a1a1a; --muted:#6b6b6b;
    --bg:#f5f4f2; --card:#fff; --line:#e6e3df; --radius:14px; }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:var(--bg);color:var(--ink);display:flex;min-height:100vh;
    align-items:center;justify-content:center;padding:1.5rem;line-height:1.5}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
    max-width:30rem;width:100%;padding:2rem;box-shadow:0 6px 24px rgba(0,0,0,.06)}
  h1{margin:0 0 .25rem;font-size:1.4rem}
  .lead{color:var(--muted);margin:0 0 1.25rem}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;margin:0 0 1.5rem;
    padding:1rem;background:var(--bg);border-radius:10px}
  dt{color:var(--muted)} dd{margin:0;font-weight:600}
  button{width:100%;border:0;border-radius:10px;padding:.85rem 1rem;font-size:1rem;
    font-weight:700;color:#fff;background:var(--brand);cursor:pointer}
  button:hover{background:var(--brand-dark)} button:disabled{opacity:.5;cursor:default}
  .msg{margin-top:1rem;font-weight:600}
  .ok{color:var(--brand)} .err{color:var(--muted)}
  footer{margin-top:1.5rem;font-size:.8rem;color:var(--muted);text-align:center}
  footer a{color:inherit}
</style></head><body><main class="card">${body}
<footer><a href="https://gate.software/?ref=poweredby" target="_blank" rel="noopener"
  data-gate-powered style="color:inherit;font:inherit;text-decoration:underline;">Powered by GATE</a></footer>
</main></body></html>`;

  if (!booking) {
    return shell(`<h1>Bokningen hittades inte</h1>
<p class="lead">Länken är ogiltig eller så har bokningen redan tagits bort.</p>`);
  }

  const bil = booking.carName || booking.regnr || 'Provkörning';
  const alreadyCancelled = booking.status === 'cancelled';
  const summary = `<dl>
    <dt>Bil</dt><dd>${escapeHtml(bil)}</dd>
    <dt>Datum</dt><dd>${escapeHtml(booking.onskadDatum)}</dd>
    <dt>Tid</dt><dd>${escapeHtml(booking.onskadTid)}</dd>
    <dt>Namn</dt><dd>${escapeHtml(booking.kundNamn)}</dd>
  </dl>`;

  if (alreadyCancelled) {
    return shell(`<h1>Provkörning avbokad</h1>
<p class="lead">Den här bokningen är redan avbokad.</p>${summary}`);
  }

  return shell(`<h1>Avboka provkörning</h1>
<p class="lead">Vill du avboka din provkörning hos One Car Group?</p>${summary}
<button id="avboka">Avboka provkörning</button>
<div class="msg" id="msg"></div>
<script>
  var token = ${JSON.stringify(token)};
  var btn = document.getElementById('avboka'), msg = document.getElementById('msg');
  btn.addEventListener('click', function(){
    btn.disabled = true; msg.textContent = 'Avbokar…'; msg.className = 'msg';
    fetch('/api/kund/avboka', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ token: token }) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (res.ok && res.j.ok) { msg.textContent = 'Din provkörning är avbokad. Tack!'; msg.className = 'msg ok'; btn.style.display='none'; }
        else { msg.textContent = (res.j && res.j.error) || 'Något gick fel. Försök igen.'; msg.className = 'msg err'; btn.disabled = false; }
      })
      .catch(function(){ msg.textContent = 'Något gick fel. Försök igen.'; msg.className = 'msg err'; btn.disabled = false; });
  });
</script>`);
}

// Minimal placeholder shown only until the frontend session ships public/.
const FALLBACK_HTML = `<!doctype html><meta charset="utf-8">
<title>One Car Group Bilverktyg</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>One Car Group Bilverktyg</h1>
<p>Backend är igång. Frontend (public/) byggs i en separat session.</p>
<p><a href="https://gate.software/?ref=poweredby" target="_blank" rel="noopener" data-gate-powered style="color:inherit;font:inherit;text-decoration:underline;">Powered by GATE</a></p>
</body>`;

app.listen(PORT, async () => {
  log.info(`One Car Group Bilverktyg backend listening on :${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  if (!isConfigured()) log.warn('APP_PASSWORD not set — /api/login will 500 until configured');
  startCleanupTimer();
  // Warm the inventory cache so the first lookup is fast (best-effort).
  inventorySize()
    .then((n) => log.info(`inventory warmed: ${n} cars`))
    .catch((e) => log.warn('inventory warm failed:', e.message));
});
