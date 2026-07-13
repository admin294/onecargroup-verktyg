# Riddermark Bilverktyg — API (backend)

Source of truth for the endpoints the backend serves. Mirrors the shared
contract at `riddermark-api-contract.md`. If the backend deviates, this file is
updated and the change relayed to the frontend session.

Backend owns: `lib/`, `src/server.js`, `gate.json`, `docs/`. It also serves
`public/` (built by the frontend session) as static.

Base URL in production: `https://app.habitual.edgebot.app` (gate assigns it).

## Auth model

- Single shared staff **password** (`APP_PASSWORD`). `POST /api/login` verifies it
  constant-time and sets an **httpOnly** signed cookie
  (`rdm_session = HMAC-SHA256(SESSION_SECRET, "ok")`), `SameSite=Lax`,
  `Secure` in production, 7-day `Max-Age`.
- Staff actions (`/api/lookup`, `POST /api/records`) require the cookie → `401` without it.
- **View links are public**: `GET /api/records/:id` and `GET /v/:id` need no auth.

## Endpoints

### `POST /api/login`
Body `{ "password": "..." }`
- `200 { ok: true }` + `Set-Cookie` on success
- `401 { ok: false }` on wrong password
- `500 { ok:false, error:"server_not_configured" }` if `APP_PASSWORD` is unset

### `POST /api/logout`
`200 { ok: true }` and clears the cookie.

### `GET /api/me`
`200 { authed: boolean }` — whether the caller holds a valid session cookie.

### `POST /api/lookup`  (auth)
Body `{ "regnr": "RDM55F" }`
- `200 { ok: true, car: CAR }`
- `200 { ok: false, code, error }` with `code ∈ ["not_in_stock","fetch_error","bad_regnr"]`
- `401` if not authed

regnr is normalized (uppercased, spaces/hyphens stripped) and validated
(`3 letters + 3 digits` **or** `3 letters + 2 digits + 1 letter`) before lookup.

### `POST /api/kund/lookup`  (PUBLIC, no auth)
Body `{ "regnr": "RDM55F" }` → same shape as `/api/lookup`
(`{ok:true, car}` or `{ok:false, code, error}`). Unauthenticated — this is the
public customer surface (`/kund`). Rate-limited per IP (~20/min → `429 {ok:false,
code:"rate_limited"}` with a `Retry-After` header). Reuses the exact same
`lookupCar` logic as the staff endpoint; no write/admin endpoint is exposed publicly.

### `POST /api/records`  (auth)
Body `{ mode, regnrs, config, cars }`, `mode ∈ ["offert","jamforelse"]`.
Stores a **snapshot** (`cars` + `config` + `mode` + `regnrs`) as small JSON with
`createdAt` and a **7-day TTL**. Snapshot so a shared link still renders after a
car sells. Only URLs are stored — never image/PDF bytes.
- `200 { ok: true, id }`
- `400 { ok:false, error:"invalid_mode" | "no_cars" }`
- `401` if not authed

### `GET /api/records/:id`  (public)
- `200 { ok: true, record: { mode, regnrs, cars, config, createdAt } }`
- `404 { ok: false }` if missing, expired, or a bad id

## Test-drive bookings (provkörning)

The app only **stores + exposes** bookings. Email/SMS confirmation and calendar
sync are done by an **external automation** polling the auth-protected endpoints
below — the app never sends mail/SMS or touches a calendar.

### `POST /api/kund/boka`  (PUBLIC, rate-limited)
Same per-IP limiter as `/api/kund/lookup` (~20/min → `429 code:"rate_limited"`).
Body `{ regnr, carName, namn, telefon, mejl, datum, tid }`.
`namn` + `telefon` + `datum` + `tid` are required; `mejl` is optional but
format-checked when present.
- `200 { ok:true, bookingId, avbokaUrl: "/avboka/<cancelToken>" }`
- `400 { ok:false, code:"missing_fields", missing:[...] }` or `400 { ok:false, code:"bad_email" }`

### `POST /api/kund/avboka`  (PUBLIC, rate-limited)
Body `{ token }` → sets `status="cancelled"` (idempotent).
- `200 { ok:true }`
- `404 { ok:false, error:"Bokningen hittades inte" }` for an unknown token

### `GET /avboka/:token`  (PUBLIC)
Self-contained, on-brand HTML page: booking summary (bil, datum, tid, namn) + an
**Avboka** button that POSTs to `/api/kund/avboka`. Unknown/looked-up token →
friendly "Bokningen hittades inte" (`404`). Already-cancelled → "Provkörning avbokad".

### `GET /api/bokningar`  (auth)
Lists bookings, newest first. Query filters:
- `?status=pending` (or `cancelled`) — exact status
- `?unprocessed=1` — `status="pending"` **and** `processedAt === null`
- `?cancelledUnhandled=1` — `status="cancelled"` **and** `cancelHandledAt === null`
- `200 { ok:true, bookings: [ Booking, ... ] }` · `401` if not authed

### `POST /api/bokningar/:id/processed`  (auth)
Body `{ calendarEventId }` → sets `processedAt` (now) + `calendarEventId`.
- `200 { ok:true, booking }` · `404 { ok:false, error:"not_found" }`

### `POST /api/bokningar/:id/cancelled-handled`  (auth)
Sets `cancelHandledAt` (now).
- `200 { ok:true, booking }` · `404 { ok:false, error:"not_found" }`

### Booking object
```json
{
  "id": "sDPgBCDBey",
  "regnr": "RDM55F",
  "carName": "BMW iX3",
  "kundNamn": "Anna Andersson",
  "kundTelefon": "0701234567",
  "kundMejl": "anna@example.se",
  "onskadDatum": "2026-07-20",
  "onskadTid": "14:00",
  "status": "pending",
  "cancelToken": "e6e947ec58f00691029549d577c4e2861e050e9a47d13b02",
  "createdAt": "2026-07-13T14:00:00.000Z",
  "processedAt": null,
  "calendarEventId": null,
  "cancelHandledAt": null
}
```
- `status ∈ ["pending","cancelled"]`. `regnr`, `carName`, `kundMejl` may be `null`.
- `cancelToken` is unguessable (48 hex). Bookings persist in the data volume
  (`DATA_DIR/bookings`) with **no TTL** — the automation owns their lifecycle.

### Static / pages
- `GET /` → app shell (`public/index.html`); until the frontend ships `public/`,
  a minimal placeholder with the Powered-by-GATE footer link is served.
- `GET /v/:id` → public read-only view page. Serves `public/v.html` if present,
  else the app shell (client renders it from `/api/records/:id`). No auth.
- `GET /healthz` → `{ ok: true }` (infra probe).
- Any unmatched path → app shell (SPA fallback).

## CAR object

Exactly the contract shape. Every field the backend cannot fetch is `null` —
never faked. `battery` is `null` for ICE / untested cars.

```json
{
  "regnr": "RDM55F",
  "sourceUrl": "https://www.riddermarkbil.se/kopa-bil/bmw/rdm55f/",
  "make": "BMW",
  "model": "iX3",
  "modelDescription": "286hk Charged Panorama Adapt-fart Elstol Läder MOMS",
  "carName": "BMW iX3, 286hk, 2021",
  "modelYear": 2021,
  "price": 364800,
  "initialPrice": 364800,
  "mileageMil": 8623,
  "color": "Svart",
  "fuelType": "El",
  "gearbox": "Automatisk",
  "batteryCapacityGrossKwh": 80,
  "wltpRangeKm": 460,
  "vin": "WBY7X4101MS156671",
  "isSold": false,
  "ownerCount": 3,
  "location": "Örebro",
  "coverImage": "https://ride.blob.core.windows.net/car-images/....jpg",
  "images": ["https://ride.blob.core.windows.net/car-images/....jpg"],
  "equipment": ["Leasbar/MOMS", "Charged", "Panoramaglastak"],
  "inspection": { "date": "2025-04-08", "mileageMil": 6715 },
  "service": { "date": "2026-01-21", "mileageMil": 8173 },
  "battery": {
    "soh": 94.1,
    "rating": "GOD HÄLSA – INGA AVVIKELSER UPPTÄCKTA",
    "certUrl": "https://ride.blob.core.windows.net/battery-tests/....pdf",
    "testDate": "2026-05-12",
    "energyNowKwh": 77, "energyNewKwh": 82,
    "wltpNowKm": 433, "wltpNewKm": 460
  }
}
```

Notes:
- `mileageMil` is Swedish **mil** (1 mil = 10 km) — label "8 623 mil".
- `ownerCount` (integer, or `null` when car.info is unavailable / rate-limited)
  is fetched from car.info and cached per regnr in the data volume for ~24h. It
  appears in both `/api/lookup` and `/api/kund/lookup`.
- `wltpRangeKm` comes from advertJson `attributes` ("Elräckvidd (WLTP)"), falling
  back to NEDC when WLTP is absent.
- If the AVILOO PDF parses but a nice-to-have field is missing, that field is
  `null` while `soh` + `certUrl` remain set (so the "Visa batteritest (PDF)"
  button always works when a cert exists).

## Data sources (live, cached in memory ~30 min)
1. Next.js `buildId` — scraped from the homepage HTML; re-scraped on a data-route 404.
2. Inventory index — `server-sitemap-adverts.xml` → `regnr → { brand, url }` (~5300 cars).
3. Car detail — `/_next/data/<buildId>/kopa-bil/<brand>/<regnr>.json` → `pageProps.advertJson`.
4. Battery — AVILOO PDF parsed in memory with `pdf-parse` (never written to disk).

## Storage / TTL
- Records: flat JSON files under `DATA_DIR` (default `/app/data`, a persisted
  volume). Ids are 10-char base62 (unguessable).
- `RECORD_TTL_DAYS` (default 7): an hourly sweep deletes older records and logs
  each deletion; expired records are also hidden lazily on read.
- No images or PDFs are ever written to disk — only hotlinked URLs live in records.

## Config / env
- `APP_PASSWORD` (Tier 2 auto-gen; override in Studio for a memorable value).
- `SESSION_SECRET` (Tier 2 auto-gen).
- `PORT`, `NODE_ENV` (Tier 1, injected by gate).
- Optional: `DATA_DIR`, `RECORD_TTL_DAYS`, `LOG_LEVEL`.
