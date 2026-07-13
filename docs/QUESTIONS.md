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

# Open questions / decisions (backend)

Resolved with a sensible default and kept moving; flag if any is wrong.

1. **APP_PASSWORD is a random secret by default.** Declared as a Tier-2 secret,
   so gate auto-generates a 64-char hex on first deploy. Staff can't memorize
   that — set a chosen value in Studio → Settings → Secrets. Decision: keep it a
   secret (not hardcoded); admin overrides with a memorable password post-deploy.

2. **`battery.energyNow/New` orientation.** The AVILOO summary line is
   `ENERGI77kWh | 82kWh` → we map left = *now* (current, 77), right = *new*
   (as-new, 82), which the detailed table confirms (Nuvarande 77,2 / Ny 82,0).
   Same for `WLTP-OMRÅDE433km | 460km` → now 433 / new 460. Matches the contract
   example.

3. **`wltpRangeKm` on CAR** is taken from advertJson `attributes`
   ("Elräckvidd (WLTP): min: 460"), not from `electricWltpRange` (that key is
   absent on advertJson — it only exists on the listing JSON). NEDC is used as a
   fallback when WLTP is missing.

4. **`service.date`** in advertJson carries a time (`2026-01-21T00:00:00`); we
   trim to date-only (`2026-01-21`) to match the contract's `inspection`/`service`
   shape.

5. **`/v/:id` page.** Backend serves `public/v.html` if the frontend provides one,
   otherwise the app shell (`public/index.html`) so the client can render the
   record from `GET /api/records/:id`. Frontend session decides which approach.

6. **Records payload trust.** `POST /api/records` stores the client-supplied
   `cars` snapshot as-is (URLs only). We validate `mode` and non-empty `cars`,
   cap the JSON body at 512 kb, and never fetch/store binary. We do not re-verify
   each car server-side — the snapshot is whatever the staff member just looked up.

7. **Cover image / images** are hotlinked `ride.blob.core.windows.net` URLs
   straight from advertJson. No resizing/proxying — per the "link, don't store"
   rule.

---

# One Car Group rebrand — decisions (frontend, `public/` only)

Rebrand from Riddermark → One Car Group (onecargroup.se, Uppsala used-car
dealer) plus removal of all battery UI. Judgement calls made where the brief
was ambiguous — each is easy to revert.

1. **Logo asset.** One Car Group only publishes a **square logo mark**, in two
   colour variants: `onecargrouplogga-140x140.png` is **white** (for dark
   backgrounds) and `cropped-One-Car-192x192.png` is **black**. The whole UI is
   on light surfaces, so the **black** variant is used in every logo slot
   (topbar/login/hero/share) and as the favicon — the white one would be
   invisible here. There is no horizontal wordmark; swap the `LOGO_DARK`
   constant in `public/js/{app,kund,view}.js` if one becomes available.

2. **Brand accent.** Sampled teal **#3AA6B9** (plus #2997AA / #003333) from
   onecargroup.se, replacing the tegelröda. `--brand` is set to a slightly
   deeper teal (`oklch(0.58 0.10 208)`) so white button text keeps ~4.5:1
   contrast; bright #3AA6B9 drives `theme-color` + tints. Error notices stay
   red. Update `--brand*` / `--ring` in `public/css/styles.css` if there's an
   official brand guide.

3. **Battery removal scope.** Removed the SOH badge + its "no test" fallback,
   all energy/WLTP-vs-new/cert-PDF content, `batteryLevel()`, the battery/`chip`
   CSS, and battery data from the fixtures. **Also removed the two EV spec rows
   `Räckvidd (WLTP)` and `Batteri (brutto)`** from `specRows()`, reading them as
   part of "energy/WLTP". If those should remain as ordinary specs, revert those
   two rows in `public/js/components.js`.

4. **Contact block.** onecargroup.se lists no named salesperson, so `KONTAKT`
   (`public/js/config.js`) uses the general dealership contact — `One Car Group`,
   `Försäljning · Uppsala`, `018-32 32 80`, `info@onecargroup.se`. Replace with a
   named seller if wanted.

5. **Fixture plates.** Mock regnrs (`RDM55F` etc.) are Riddermark-flavoured and
   `RDM55F` is the backend's "real" contract fixture. Left plate strings
   unchanged (backend owns the contract, outside `public/`); source URLs
   re-pointed to onecargroup.se paths (illustrative, mock-only).

6. **"Bäst batteri" best-of badge.** This seed has no best-of / row-align badge
   feature, so there was nothing to drop. Noted so a battery-based "best" isn't
   introduced later.
