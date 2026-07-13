# Riddermark Bilverktyg

Self-serve web tool for **Riddermark Bil** staff to build **car comparisons** (jämförelse) and **customer offers** (offert) from just a registration number.

Enter a regnr → the tool pulls live data + the AVILOO battery certificate (SOH) from riddermarkbil.se, and builds a side-by-side comparison or a configurable offer (garanti + däck + live total). Results are shareable via public links that auto-expire after 7 days.

- **Password-protected** staff area; **public** share links (`/v/<id>`).
- **Link, don't store**: images and battery PDFs are hotlinked, never copied. Saved records are tiny JSON with a 7-day TTL cleanup — the server never fills up.
- Riddermark-branded.

## Data sources (riddermarkbil.se)
- `server-sitemap-adverts.xml` → regnr → car URL (inventory index).
- `_next/data/<buildId>/kopa-bil/<brand>/<regnr>.json` → `advertJson` (specs, equipment, inspection, `latestBatteryTestUrl`).
- AVILOO battery PDF → parsed for SOH %.

## Stack
Node 22. Deploys on merge to `main` (GATE project `habitual-riddermark-verktyg`).

Built with GATE.
