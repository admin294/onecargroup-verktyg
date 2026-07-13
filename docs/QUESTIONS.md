# Frontend — öppna frågor & antaganden

Frontend-CS byggde `public/` mot `riddermark-api-contract.md`. Punkterna nedan är
antaganden som gjordes där kontraktet var tyst, plus saker backend-CS behöver
bekräfta. Inget här blockerar bygget — allt har en rimlig standard som fungerar
i mockläge (`?mock=1`).

## Routing / servering

1. **`/v/:id` → statisk fil.** Frontend förutsätter att backend serverar
   `public/v.html` för alla `/v/:id`-vägar (t.ex. `sendFile('v.html')`). `view.js`
   läser id:t från `location.pathname` (`/v/<id>`), med `?id=<id>` som reserv.
   *Behövs:* bekräfta rewrite-regeln, annars 404:ar delade länkar.
2. **`/` och SPA-fallback.** `index.html` serveras på `/`. Inga andra klientvägar
   används, så ingen catch-all behövs för verktyget.

## API-antaganden

3. **`POST /api/records`-body.** Frontend skickar `{ mode, regnrs, config, cars }`
   där `cars` är hela CAR-objekt (för snapshot) och `config` är `null` i
   jämförelseläge. Stämmer det med hur backend snapshottar?
4. **`GET /api/records/:id`-svar.** Frontend läser `record.{mode, cars, config,
   createdAt}`. `regnrs` läses inte i vyn men skadar inte om det finns med.
5. **401 vid utgången session.** Vid `401` på `/api/lookup` visar verktyget ett
   fel och skickar tillbaka till login efter ~1s. Bekräfta att `/api/lookup`
   svarar `401` (inte `200 {ok:false}`) när cookien saknas/gått ut.
6. **Regnr-normalisering.** Frontend versaliserar och tar bort blanksteg/bindestreck
   innan `regnr` skickas. Om backend vill ha rått värde, säg till.

## Branding / externa resurser

7. **Logotyp hotlinkas** från
   `https://webfiles24.blob.core.windows.net/webfiles/new-design/assets/logo/logo-dark.png`.
   Paletten är samplad direkt ur logotypen (tegelrött `#B4180C` / `#A81818`).
   Bekräfta att hotlinking av loggan är okej i prod (annars lägg den i `public/`).
8. **Typsnitt** (Familjen Grotesk + JetBrains Mono) laddas från Google Fonts.
   Om en CSP blockerar `fonts.googleapis.com` / `fonts.gstatic.com` behöver de
   antingen tillåtas eller self-hostas.
9. **Bilder & batteri-PDF hotlinkas** från annonsens URL:er (aldrig kopierade,
   enligt kontraktet). `<img>`-hotlinking kräver ingen CORS. Batteri-PDF öppnas i
   ny flik. Om Riddermarks CDN sätter `Referrer-Policy`/hotlink-skydd kan bilder
   falla bort — då visas en tom platshållare (hanteras redan gracefully).
10. **Mockbilder** använder `picsum.photos` (endast i mockläge, aldrig i prod).

## Powered by GATE

11. Footerlänken renderas verbatim som `Powered by GATE` med markören
    `data-gate-powered` på `<a>`-taggen. Href pekar på `https://gate1.dev`.
    Bekräfta om en annan mål-URL önskas.

## Offert / affärslogik

12. Garanti-trappan, däckpriserna, registreringsavgiften (1495 kr) och
    total-formeln ligger i `public/js/config.js` (frontend äger dem enligt
    kontraktet). Ändras en konstant räcker det att uppdatera den filen.
13. Momstexten under totalen är generell ("inkl. moms där det anges"). Säg till
    om Riddermark vill ha en exakt momsrad eller annan formulering.
14. Kundfälten (namn, org/pers.nr, telefon, e-post, anteckning) sparas i `config`
    och visas i den publika offertvyn. Inga fält är obligatoriska.

---

# Open questions / decisions (backend — One Car Group data layer)

Resolved with a sensible default and kept moving; flag if any is wrong.

1. **Data source = the site's own JSON feed, not per-page scraping.** The prompt
   described scraping `/bilar/` for detail URLs, then parsing each `/bil/<slug>/`
   page's JSON-LD. On inspection the listing renders client-side and the detail
   pages' JSON-LD is only page metadata (WebSite/Organization/BreadcrumbList) —
   **no car data**. The site itself renders from
   `GET /wp-json/accesspackage/v1/cars`, which returns the **whole inventory
   (~90 cars) fully structured in one call**. We use that feed as the single
   source (`lib/inventory.js`). It's strictly better: structured, complete, no
   buildId/HTML fragility, one request. No per-car detail fetch is needed.

2. **`mileageMil` unit.** The feed's `milage` is in Swedish **mil** — verified
   against the live detail page which labels the same value "Miltal 2 577 mil".
   Mapped straight to `mileageMil` (matching the contract's mil convention).

3. **`price` / `priceExMoms`.** `price.value` is the advertised price **incl.
   moms**; the ex-moms figure the site shows is exactly `price / 1.25`
   (verified: 639 800 → 511 840). We set `priceExMoms` only when
   `price.showExcludingVat === true` (VAT-deductible "MOMS" cars, 59/91 in stock);
   otherwise `null`. `initialPrice` uses `price.previousValue` when present.

4. **No battery / no EV range.** OCG has no battery-tested cars, so `battery`,
   `batteryCapacityGrossKwh` and `wltpRangeKm` are removed from the CAR shape
   (the feed's range/consumption numbers are mostly 0 and unreliable). `battery.js`
   / AVILOO PDF parsing is deleted.

5. **`inspection` / `service` dropped.** The OCG feed exposes no besiktning/service
   history (carfax `reportExists:false`), so these Riddermark fields are removed
   rather than always-null.

6. **`vin` is `null`.** The feed has no chassis number today. `normalizeCar` reads
   `data.vin` so it lights up automatically if OCG ever adds one. ("vin if present".)

7. **`ownerCount` kept as-is** via `lib/carInfo.js` (anonymous car.info lookup,
   24h cache + global backoff). Verified live: DSR51C → 3 owners. Often `null` when
   car.info rate-limits — never blocks the lookup.

8. **Inventory cache in the data volume.** The feed is cached in memory for
   `INVENTORY_TTL_MINUTES` (default 60, "refresh ~hourly") and mirrored to
   `DATA_DIR/inventory.json`; on an upstream failure we serve the last disk copy so
   lookups survive a brief outage. Warmed on boot.

9. **APP_PASSWORD is a random secret by default.** Declared in `.env.example` as a
   Tier-2 secret, so gate auto-generates a 64-char hex on first deploy. Staff can't
   memorize that — set a chosen value in Studio → Settings → Secrets. Same for
   `SESSION_SECRET` (backs the `ocg_session` cookie).

10. **Records payload trust.** `POST /api/records` stores the client-supplied
    `cars` snapshot as-is (URLs only). We validate `mode` and non-empty `cars`,
    cap the body at 512 kb, and never fetch/store binary. Snapshot = whatever the
    staff member just looked up.

11. **Cover image / images** are hotlinked `pro.bbcdn.io` URLs (largest format)
    straight from the feed — no resizing/proxying, per "link, don't store".

12. **Avboka page palette.** The self-contained `/avboka/:token` page in
    `server.js` uses a brand-neutral graphite palette (was Riddermark tegelrött).
    The frontend session owns the real One Car Group palette — swap the two CSS
    vars if a brand colour is preferred.
