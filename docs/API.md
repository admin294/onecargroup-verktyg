# One Car Group Bilverktyg — API (backend)

Source of truth for the endpoints the backend serves. Backend owns: `lib/`,
`src/server.js`, `gate.json`, `docs/`. It also serves `public/` (built by the
frontend session) as static.

Base URL in production: assigned by gate (`https://<service>.<org>.edgebot.app`).

## Auth model

- Single shared staff **password** (`APP_PASSWORD`). `POST /api/login` verifies it
  constant-time and sets an **httpOnly** signed cookie
  (`ocg_session = HMAC-SHA256(SESSION_SECRET, "ok")`), `SameSite=Lax`,
  `Secure` in production, 7-day `Max-Age`.
- Staff actions (`/api/lookup`, `POST /api/records`, `/api/bokningar*`) require the
  cookie → `401` without it.
- **Public surfaces need no auth**: `/api/kund/lookup`, `/api/kund/boka`,
  `/api/kund/avboka`, `GET /api/records/:id`, `GET /v/:id`, `GET /avboka/:token`.

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
Body `{ "regnr": "DSR51C" }`
- `200 { ok: true, car: CAR }`
- `200 { ok: false, code, error }` with `code ∈ ["not_in_stock","fetch_error","bad_regnr"]`
- `401` if not authed

regnr is normalized (uppercased, spaces/hyphens stripped) and validated
(`3 letters + 3 digits` **or** `3 letters + 2 digits + 1 letter`) before lookup.

### `POST /api/kund/lookup`  (PUBLIC, no auth)
Body `{ "regnr": "DSR51C" }` → same shape as `/api/lookup`
(`{ok:true, car}` or `{ok:false, code, error}`). Unauthenticated — this is the
public customer surface (`/kund`). Rate-limited per IP (~20/min → `429 {ok:false,
code:"rate_limited"}` with a `Retry-After` header). Reuses the exact same
`lookupCar` logic as the staff endpoint; no write/admin endpoint is exposed publicly.

### `POST /api/records`  (auth)
Body `{ mode, regnrs, config, cars }`, `mode ∈ ["offert","jamforelse"]`.
Stores a **snapshot** (`cars` + `config` + `mode` + `regnrs`) as small JSON with
`createdAt` and a **7-day TTL**. Snapshot so a shared link still renders after a
car sells. Only URLs are stored — never image bytes.
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
Self-contained HTML page: booking summary (bil, datum, tid, namn) + an **Avboka**
button that POSTs to `/api/kund/avboka`. Unknown token → friendly "Bokningen
hittades inte" (`404`). Already-cancelled → "Provkörning avbokad".

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
  "regnr": "DSR51C",
  "carName": "Volvo XC60, 257hk, 2026",
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

Exactly the contract shape. Every field the backend cannot fetch is `null` (or
`[]`) — never faked. **No `battery` field**: One Car Group has no battery-tested
EVs, so there is no SOH/AVILOO data.

```json
{
  "regnr": "DSR51C",
  "sourceUrl": "https://www.onecargroup.se/bil/volvo-xc60-recharge-t6-awd-plus-black-moms-drag-pano-nybilsgaranti/",
  "make": "Volvo",
  "model": "XC60",
  "modelDescription": "XC60 Recharge T6 AWD Plus Black MOMS Drag Pano Nybilsgaranti",
  "carName": "Volvo XC60, 257hk, 2026",
  "modelYear": 2026,
  "enginePower": 257,
  "price": 639800,
  "priceExMoms": 511840,
  "initialPrice": 639800,
  "mileageMil": 2577,
  "color": "Svart",
  "fuelType": "Hybrid el/bensin",
  "gearbox": "Automatisk",
  "vin": null,
  "isSold": false,
  "ownerCount": 3,
  "location": "Uppsala",
  "coverImage": "https://pro.bbcdn.io/1d/1dbf6221-6900-92b5-3af1-00008404e97a?rule=legacy-largest",
  "images": ["https://pro.bbcdn.io/1d/1dbf6221-6900-92b5-3af1-00008404e97a?rule=legacy-largest"],
  "equipment": ["LEASEBAR FÖR FÖRETAG", "Avdragbar moms", "Backkamera", "360-kamera"]
}
```

Notes:
- `mileageMil` is Swedish **mil** (1 mil = 10 km) — the site labels it "2 577 mil".
- `price` is the advertised price **incl. moms**. `priceExMoms` is the VAT-excluded
  figure (`price / 1.25`) and is set **only** for VAT-deductible ("MOMS") cars —
  the feed flags these with `price.showExcludingVat: true`. For non-MOMS cars
  `priceExMoms` is `null` (the site shows no ex-moms line for them). Verified live:
  `639 800 → 511 840 kr ex. moms`.
- `initialPrice` is the pre-discount price when the feed exposes one
  (`price.previousValue`), else it mirrors `price`.
- `enginePower` is horsepower (hk), also folded into `carName`.
- `carName` is a compact heading `"Make Model, NNNhk, YYYY"`; the fuller trim
  string lives in `modelDescription`.
- `vin` is `null` — the feed does not expose a chassis number today. If OCG adds
  one, `normalizeCar` picks it up from `data.vin` automatically.
- `ownerCount` (integer, or `null` when car.info is unavailable / rate-limited) is
  fetched from car.info and cached per regnr in the data volume for ~24h. It
  appears in both `/api/lookup` and `/api/kund/lookup`.
- `images`/`coverImage` are hotlinked `pro.bbcdn.io` URLs (largest format),
  ordered by the feed's `sortOrder`. No resizing/proxying — link, don't store.
- Fields Riddermark had but OCG's source lacks are **dropped** (not sent as null):
  `battery`, `batteryCapacityGrossKwh`, `wltpRangeKm`, `inspection`, `service`.

## Data source (single feed, cached ~1h)

One Car Group's website renders its inventory client-side from a JSON feed:

```
GET https://www.onecargroup.se/wp-json/accesspackage/v1/cars
```

One call returns the **entire inventory** (~90 cars) with every field already
structured (`regNo`, `make`, `model`, `modelRaw`, `price`, `milage`, `images`,
`equipment`, `city`, …). There is **no per-car detail fetch**: the feed entry *is*
the detail. The `/bil/<slug>/` HTML detail pages carry only page-level JSON-LD
(WebSite / Organization / BreadcrumbList) — never the car data — so this REST feed
is the correct and only reliable structured source.

`lib/inventory.js` fetches the feed, indexes it by `regNo` (uppercased), caches it
in memory for `INVENTORY_TTL_MINUTES` (default 60) and mirrors the raw feed to the
data volume (`DATA_DIR/inventory.json`). On an upstream failure it falls back to the
last disk cache so lookups keep working through a brief outage.

Owner count (`car.info`) is a separate best-effort per-regnr fetch, cached ~24h.

## Storage / TTL
- Records: flat JSON files under `DATA_DIR` (default `/app/data`, a persisted
  volume). Ids are 10-char base62 (unguessable).
- `RECORD_TTL_DAYS` (default 7): an hourly sweep deletes older records and logs
  each deletion; expired records are also hidden lazily on read.
- No images are ever written to disk — only hotlinked URLs live in records.

## Config / env
- `APP_PASSWORD` (Tier 2 auto-gen; override in Studio for a memorable value).
- `SESSION_SECRET` (Tier 2 auto-gen).
- `PORT`, `NODE_ENV` (Tier 1, injected by gate).
- Optional: `DATA_DIR`, `RECORD_TTL_DAYS`, `INVENTORY_TTL_MINUTES`, `OCG_CARS_URL`,
  `LOG_LEVEL`.
