# One Car Group Bilverktyg

Self-serve web tool for **One Car Group** staff to build **car comparisons** (jämförelse) and **customer offers** (offert) from just a registration number.

Enter a regnr → the tool pulls live inventory data from onecargroup.se and builds a side-by-side comparison or a configurable offer (garanti + däck + live total). Results are shareable via public links that auto-expire after 7 days. There is a public customer surface (`/kund`) too.

- **Password-protected** staff area; **public** share links (`/v/<id>`) and customer lookup (`/kund`).
- **Link, don't store**: car images are hotlinked, never copied. Saved records are tiny JSON with a 7-day TTL cleanup — the server never fills up.
- No battery/AVILOO data (One Car Group has no battery-tested EVs).

## Data source (onecargroup.se)
- `GET /wp-json/accesspackage/v1/cars` → the whole inventory (~90 cars) fully structured in one call: regNo, make/model, price (incl. + ex. moms), milage (mil), equipment, images, city. Indexed by regnr and cached ~1h (in memory + data volume). See `docs/API.md`.
- `car.info` → owner count ("Antal ägare") per regnr, best-effort, cached ~24h.

## Stack
Node 22, Express. Backend owns `lib/`, `src/server.js`, `gate.json`, `docs/`; the frontend session owns `public/`.

Built with GATE.
