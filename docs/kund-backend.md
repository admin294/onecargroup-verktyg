# Backend patch — public customer surface (`/kund`) + owner count

> **Historical (already applied).** This is the original patch note from the
> Riddermark seed; `lib/rateLimit.js`, `lib/carInfo.js`, the `ownerCount` wiring
> and `/api/kund/lookup` are all live in the code today. The `RDM55F` / `battery`
> references below are Riddermark-era context — the One Car Group data layer has
> **no battery field** and is documented in `API.md`. Kept for provenance.

The frontend for the public customer tool (`public/kund.html`, `public/js/kund.js`)
and the owner-count **display** ship in this PR. The **backend** pieces below could
not be committed by the frontend session: `src/` and `lib/` are owned by the backend
session (filesystem `nobody`, read-only to the frontend session), so this file is the
ready-to-apply patch. Everything here is drop-in and matches the existing style
(`fetchWithUA` from `lib/http.js`, the `DATA_DIR` convention from `lib/store.js`).

Apply the four changes below, then `node --check` the touched files.

---

## 1. NEW FILE — `lib/rateLimit.js`

Minimal in-memory per-IP fixed-window limiter for the public lookup.

```js
// rateLimit.js — minimal in-memory per-IP fixed-window rate limiter.
// Blunts abuse of the public (unauthenticated) customer lookup; not distributed.
// Buckets are pruned on a timer so the map can't grow unbounded. Requires
// `app.set('trust proxy', true)` so req.ip reflects the real client behind Caddy.
import { log } from './log.js';

export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map(); // ip -> { count, reset }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (e.reset <= now) hits.delete(ip);
  }, windowMs);
  if (timer.unref) timer.unref();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let e = hits.get(ip);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(ip, e); }
    e.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - e.count)));

    if (e.count > max) {
      const retry = Math.ceil((e.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      log.warn(`rate limit hit for ${ip} (${e.count}/${max})`);
      return res.status(429).json({
        ok: false, code: 'rate_limited',
        error: 'För många förfrågningar. Vänta en stund och försök igen.',
      });
    }
    next();
  };
}
```

---

## 2. NEW FILE — `lib/carInfo.js`

Owner count ("Antal ägare") from car.info, cache-first. car.info rate-limits hard
(HTTP 429, long `Retry-After`), so a fresh cache hit never refetches, and any
failure degrades to `null` — the Riddermark lookup must still succeed.

```js
// carInfo.js — owner count ("Antal ägare") from car.info, with a persistent
// per-regnr cache in the data volume. car.info rate-limits hard, so a cache hit
// NEVER refetches within TTL, and every failure path returns null (best-effort).
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fetchWithUA } from './http.js';
import { normalizeRegnr } from './regnr.js';
import { log } from './log.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'carinfo');
const TTL_MS = Number(process.env.CARINFO_TTL_HOURS || 24) * 60 * 60 * 1000;
const TIMEOUT_MS = Number(process.env.CARINFO_TIMEOUT_MS || 8000);

const cachePath = (regnr) => path.join(CACHE_DIR, `${regnr}.json`);

async function readCache(regnr) {
  try {
    const c = JSON.parse(await fs.readFile(cachePath(regnr), 'utf8'));
    if (Date.now() - c.at <= TTL_MS) return c; // fresh (a cached null still counts)
  } catch { /* miss */ }
  return null;
}
async function writeCache(regnr, ownerCount) {
  try {
    fsSync.mkdirSync(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath(regnr), JSON.stringify({ regnr, ownerCount, at: Date.now() }), 'utf8');
  } catch (e) { log.warn(`carinfo cache write failed for ${regnr}: ${e.message}`); }
}

// VERIFIED against RDM55F (= 3): <span class="sptitle">Antal ägare</span> 3
function parseOwnerCount(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<span class="sptitle">Antal ägare<\/span>\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Owner count for a regnr. Cache-first; always resolves to an integer or null. */
export async function getOwnerCount(regnr) {
  const norm = normalizeRegnr(regnr);
  if (!norm) return null;

  const cached = await readCache(norm);
  if (cached) { log.debug(`carinfo cache hit ${norm}=${cached.ownerCount}`); return cached.ownerCount; }

  const url = `https://www.car.info/sv-se/license-plate/S/${norm}`;
  try {
    const res = await fetchWithUA(url, { timeoutMs: TIMEOUT_MS });
    if (res.status === 429) {
      log.warn(`carinfo 429 for ${norm} (retry-after=${res.headers.get('retry-after') ?? '?'}) — null`);
      return null; // do NOT cache a rate-limited miss → retry on the next lookup
    }
    if (!res.ok) { log.warn(`carinfo ${norm} → ${res.status}`); return null; }
    const owner = parseOwnerCount(await res.text());
    await writeCache(norm, owner); // cache the real result (incl. a genuine null) for TTL
    log.info(`carinfo ${norm} ownerCount=${owner ?? '-'}`);
    return owner;
  } catch (e) {
    log.warn(`carinfo fetch failed for ${norm}: ${e.message} — null`);
    return null;
  }
}
```

---

## 3. PATCH — `lib/lookup.js` (set `car.ownerCount`)

1. Add the import near the other `lib/` imports at the top:

```js
import { getOwnerCount } from './carInfo.js';
```

2. In `normalizeCar(...)`, add a default field so the shape is stable
   (next to `battery: null,`):

```js
    ownerCount: null,
```

3. In `lookupCar(...)`, after the `battery` block and before the final
   `log.info(...) / return car;`, add (cache-first, best-effort, never throws):

```js
  // Owner count from car.info — cached ~24h, best-effort. Never breaks the lookup.
  car.ownerCount = await getOwnerCount(norm);
```

(Optional: run it concurrently with the battery parse via `Promise.all` if you
want to shave the cold-miss latency; the cache makes repeat lookups instant.)

---

## 4. PATCH — `src/server.js` (public endpoint + rate limit + trust proxy)

1. Add the import next to the other `lib/` imports:

```js
import { rateLimit } from '../lib/rateLimit.js';
```

2. Right after `app.disable('x-powered-by');`, trust the proxy so `req.ip` is the
   real client (needed for per-IP limiting behind Caddy):

```js
app.set('trust proxy', true);
```

3. Add the **public, unauthenticated** lookup — place it right after the existing
   `app.post('/api/lookup', requireAuth, ...)` block. Note: NO `requireAuth`, and
   it is rate-limited to 20/min/IP. It reuses `lookupCar` exactly like the staff
   endpoint. No write/admin endpoint is exposed publicly.

```js
// ---- Public customer lookup (NO auth, rate-limited) ----------------------
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
```

4. `/kund` page routing: **already works** — `express.static(PUBLIC_DIR, { ... extensions: ['html'] })`
   serves `public/kund.html` for `GET /kund` (static is registered before the
   `app.get('*')` fallback). No route change required. If you want it explicit,
   add before `app.get('*', ...)`:

```js
app.get('/kund', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'kund.html')));
```

The staff app (`/` behind `APP_PASSWORD`), `/api/login`, `/api/lookup`,
`/api/records`, and `/v/:id` are all unchanged.

---

## Verification (after applying)

```bash
node --check lib/rateLimit.js lib/carInfo.js lib/lookup.js src/server.js
# staff still gated:
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' -d '{"regnr":"RDM55F"}'   # → 401
# public works, no auth, returns ownerCount 3:
curl -s -X POST localhost:3000/api/kund/lookup -H 'content-type: application/json' -d '{"regnr":"RDM55F"}' | jq '.car.ownerCount'   # → 3
# second call hits the car.info cache (see log: "carinfo cache hit RDM55F=3"); no refetch
curl -s localhost:3000/kund -o /dev/null -w '%{http_code}\n'   # → 200 (kund.html)
```

## API.md addition (the backend session owns `docs/API.md`)

Add under the lookup section:

> ### Public customer lookup (no auth)
> - `POST /api/kund/lookup` body `{ "regnr": "RDM55F" }` → same shape as `/api/lookup`
>   (`{ok:true, car}` or `{ok:false, code, error}`). Unauthenticated. Rate-limited
>   per IP (~20/min → `429 {ok:false, code:"rate_limited"}` with `Retry-After`).
>
> The CAR object gains `ownerCount` (integer, or `null` when car.info is
> unavailable / rate-limited). Owner count is fetched from car.info and cached per
> regnr in the data volume for ~24h.
