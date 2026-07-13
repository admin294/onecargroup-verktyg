// components.js — delade renderbyggstenar för både verktyget och den publika vyn.

import { kr, mil, datum, formatCountdown } from './config.js';
import { apiBoka } from './api.js';

// ---- Mini-hyperscript ----
// h('div', {class:'x', onClick:fn, dataset:{id:1}}, child, 'text', [list])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// SVG-ikoner (inga emojis) — enkel stroke-uppsättning.
const ICON = {
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h1.5a1.5 1.5 0 0 0 0-3H9v6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-4 4 3 3-2 4 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  phone: '<path d="M6.5 4h3l1.2 4-2 1.2a11 11 0 0 0 4.6 4.6l1.2-2 4 1.2v3a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 5 6.6 1.5 1.5 0 0 1 6.5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
};
export function icon(name, cls) {
  const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
  return h('span', { class: 'ico ' + (cls || ''), html: svg });
}

// ---- Specifikationsrader ----
export function specRows(car) {
  const rows = [
    ['Pris', kr(car.price), 'strong'],
    ['Årsmodell', car.modelYear ?? '—'],
    ['Mätarställning', mil(car.mileageMil)],
    ['Färg', car.color || '—'],
    ['Drivmedel', car.fuelType || '—'],
    ['Växellåda', car.gearbox || '—'],
    ['Antal ägare', car.ownerCount != null ? String(car.ownerCount) : 'uppgift saknas'],
    ['Ort', car.location || '—'],
  ];
  return h('dl', { class: 'specs' },
    rows.map(([k, v, mod]) => h('div', { class: 'specs__row' },
      h('dt', {}, k),
      h('dd', { class: 'mono' + (mod === 'strong' ? ' specs__strong' : '') }, v),
    )),
  );
}

// Besiktning / service som småkort (kan vara null).
export function historyRows(car) {
  const items = [];
  if (car.inspection && car.inspection.date) {
    items.push(['Besiktigad', `${datum(car.inspection.date)}`, car.inspection.mileageMil != null ? mil(car.inspection.mileageMil) : null]);
  }
  if (car.service && car.service.date) {
    items.push(['Servad', `${datum(car.service.date)}`, car.service.mileageMil != null ? mil(car.service.mileageMil) : null]);
  }
  if (!items.length) return null;
  return h('div', { class: 'history' },
    items.map(([k, d, m]) => h('div', { class: 'history__item' },
      h('span', { class: 'history__k' }, k),
      h('span', { class: 'history__d' }, d, m ? h('span', { class: 'history__m mono' }, ' · ' + m) : null),
    )),
  );
}

// ---- Utrustningslista ----
export function equipmentList(car) {
  const eq = Array.isArray(car.equipment) ? car.equipment : [];
  if (!eq.length) return null;
  return h('ul', { class: 'equip' }, eq.map((e) => h('li', { class: 'equip__item' }, icon('check', 'equip__ico'), e)));
}

// ---- Bildgalleri + lightbox ----
export function gallery(car) {
  const imgs = imageList(car);
  if (!imgs.length) {
    return h('div', { class: 'gallery gallery--empty' }, icon('image'), h('span', {}, 'Inga bilder'));
  }
  const grid = h('div', { class: 'gallery' },
    imgs.map((src, i) => h('button', {
      class: 'gallery__thumb', type: 'button', 'aria-label': `Bild ${i + 1} av ${imgs.length}`,
      onClick: () => openLightbox(imgs, i),
    }, h('img', { src, alt: `${car.carName || 'Bil'} bild ${i + 1}`, loading: 'lazy', onError: onImgError }))),
  );
  return grid;
}
export function imageList(car) {
  const set = [];
  if (car.coverImage) set.push(car.coverImage);
  for (const s of (car.images || [])) if (s && !set.includes(s)) set.push(s);
  return set;
}
function onImgError(e) {
  const t = e.currentTarget;
  const wrap = t.closest('.gallery__thumb, .lightbox__stage, .cover');
  if (wrap) wrap.classList.add('img-broken');
  t.remove();
}

// Lightbox — en enda instans, återanvänds. Tangentbord: Esc, piltangenter.
let lb = null;
function ensureLightbox() {
  if (lb) return lb;
  const stage = h('div', { class: 'lightbox__stage' });
  const counter = h('div', { class: 'lightbox__counter mono' });
  const root = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', hidden: true },
    h('button', { class: 'lightbox__close', type: 'button', 'aria-label': 'Stäng', onClick: closeLightbox }, icon('close')),
    h('button', { class: 'lightbox__nav lightbox__nav--prev', type: 'button', 'aria-label': 'Föregående', onClick: () => step(-1) }, icon('arrow')),
    stage,
    h('button', { class: 'lightbox__nav lightbox__nav--next', type: 'button', 'aria-label': 'Nästa', onClick: () => step(1) }, icon('arrow')),
    counter,
  );
  root.addEventListener('click', (e) => { if (e.target === root) closeLightbox(); });
  document.body.appendChild(root);
  lb = { root, stage, counter, imgs: [], i: 0 };
  return lb;
}
function renderLightbox() {
  const { stage, counter, imgs, i } = lb;
  clear(stage);
  stage.appendChild(h('img', { src: imgs[i], alt: `Bild ${i + 1}`, onError: onImgError }));
  counter.textContent = `${i + 1} / ${imgs.length}`;
  lb.root.querySelector('.lightbox__nav--prev').style.visibility = imgs.length > 1 ? 'visible' : 'hidden';
  lb.root.querySelector('.lightbox__nav--next').style.visibility = imgs.length > 1 ? 'visible' : 'hidden';
}
function step(d) {
  if (!lb) return;
  lb.i = (lb.i + d + lb.imgs.length) % lb.imgs.length;
  renderLightbox();
}
export function openLightbox(imgs, start = 0) {
  ensureLightbox();
  lb.imgs = imgs; lb.i = start;
  lb.root.hidden = false;
  document.body.classList.add('no-scroll');
  renderLightbox();
  document.addEventListener('keydown', onLbKey);
}
function closeLightbox() {
  if (!lb) return;
  lb.root.hidden = true;
  document.body.classList.remove('no-scroll');
  document.removeEventListener('keydown', onLbKey);
}
function onLbKey(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
}

// ---- Bilrubrik (märke/modell + regnr-skylt) ----
export function carHeader(car, opts = {}) {
  return h('div', { class: 'carhead' },
    h('div', { class: 'carhead__main' },
      h('h3', { class: 'carhead__name' }, car.carName || `${car.make || ''} ${car.model || ''}`.trim() || 'Bil'),
      car.modelDescription ? h('p', { class: 'carhead__desc' }, car.modelDescription) : null,
    ),
    h('div', { class: 'carhead__side' },
      plate(car.regnr),
      opts.onRemove ? h('button', { class: 'iconbtn carhead__remove', type: 'button', 'aria-label': 'Ta bort', onClick: opts.onRemove }, icon('close')) : null,
    ),
  );
}

// Svensk registreringsskylt.
export function plate(regnr) {
  return h('span', { class: 'plate' }, h('span', { class: 'plate__eu' }, 'S'), h('span', { class: 'plate__nr mono' }, regnr || '—'));
}

// Källänk till annonsen på onecargroup.se.
export function sourceLink(car) {
  if (!car.sourceUrl) return null;
  return h('a', { class: 'sourcelink', href: car.sourceUrl, target: '_blank', rel: 'noopener' },
    icon('external'), 'Visa annons');
}

// Bannerremsa när posten renderas i mock-läge.
export function mockRibbon() {
  return h('div', { class: 'mockribbon' }, 'Demoläge — mockdata, ingen backend');
}

// Säljarkontakt — prominent kort på kundsidan. Fält som fortfarande är
// platshållare ("[TELEFON]") renderas som text i stället för klickbar länk,
// så de blir automatiskt klickbara när riktiga uppgifter fylls i.
export function kontaktBlock(kontakt, opts = {}) {
  const isPlaceholder = (v) => !v || /^\[.*\]$/.test(String(v).trim());
  const row = (label, ico, value, href) => {
    const val = isPlaceholder(value)
      ? h('span', { class: 'kontakt__val kontakt__val--ph' }, value || '—')
      : h('a', { class: 'kontakt__val', href }, value);
    return h('div', { class: 'kontakt__row' }, icon(ico, 'kontakt__ico'), h('span', { class: 'kontakt__label' }, label), val);
  };
  return h('aside', { class: 'kontakt' + (opts.compact ? ' kontakt--compact' : '') },
    h('div', { class: 'kontakt__head' },
      h('span', { class: 'kontakt__kicker' }, 'Din kontakt hos One Car Group'),
      h('div', { class: 'kontakt__namn' }, kontakt.namn || '—'),
      (kontakt.titel || kontakt.sprak)
        ? h('div', { class: 'kontakt__titel' }, [kontakt.titel, kontakt.sprak].filter(Boolean).join(' · '))
        : null,
    ),
    h('div', { class: 'kontakt__rows' },
      row('Telefon', 'phone', kontakt.telefon, `tel:${String(kontakt.telefon || '').replace(/\s+/g, '')}`),
      row('E-post', 'mail', kontakt.mejl, `mailto:${kontakt.mejl || ''}`),
    ),
  );
}

// Coverbild med prisetikett.
export function cover(car) {
  const src = car.coverImage || (car.images && car.images[0]);
  return h('div', { class: 'cover' },
    src ? h('img', { src, alt: car.carName || 'Bild', loading: 'lazy', onError: onImgError }) : icon('image'),
    car.price != null ? h('div', { class: 'cover__price' }, kr(car.price)) : null,
  );
}

// Fullt bilkort — används i jämförelsen (verktyg + publik vy).
export function carCard(car, opts = {}) {
  return h('article', { class: 'carcard' },
    cover(car),
    h('div', { class: 'carcard__body' },
      carHeader(car, opts),
      specRows(car),
      historyRows(car),
      equipmentList(car),
      gallery(car),
      sourceLink(car),
    ),
  );
}

// Bildetalj för offert — bredare kolumnlayout.
export function offertCar(car) {
  return h('div', { class: 'carcard offert__carcard' },
    cover(car),
    h('div', { class: 'carcard__body' },
      carHeader(car),
      specRows(car),
      historyRows(car),
      equipmentList(car),
      gallery(car),
      sourceLink(car),
    ),
  );
}

// Prisradbrytning som DOM (delas av offertbyggaren och publika vyn).
export function breakdownView(breakdown) {
  const { lines, total, warrantyYears, dack } = breakdown;
  const card = h('div', { class: 'breakdown' },
    h('div', { class: 'breakdown__head' }, h('div', { class: 'panel__title' }, 'Prisspecifikation')),
    h('div', { class: 'breakdown__rows' },
      lines.map((l) => h('div', { class: 'brow' + (l.muted ? ' brow--muted' : '') },
        h('div', {},
          h('span', { class: 'brow__label' }, l.label),
          l.sub ? h('span', { class: 'brow__sub' }, l.sub) : null,
        ),
        h('span', { class: 'brow__amt' }, kr(l.amount)),
      )),
    ),
    h('div', { class: 'brow brow--total' },
      h('span', { class: 'brow__label' }, 'Att betala'),
      h('span', { class: 'brow__amt value-pop', key: total }, kr(total)),
    ),
    h('div', { class: 'breakdown__disclaimer' }, 'Alla bud och offerter gäller i 24h pga rådande marknad.'),
    h('div', { class: 'breakdown__note' }, 'Priset inkluderar moms där det anges. Registreringsavgift ingår. Erbjudandet gäller i mån av lager.'),
  );

  // Förmån (ej prisrad): vid köp av både däck och garanti ingår extra värden.
  const hasTire = dack && dack.key !== 'behall';
  const hasWarranty = Number(warrantyYears) >= 1;
  if (!hasTire || !hasWarranty) return card;
  return h('div', { class: 'breakdown-wrap' }, card, ingarBox());
}

// Kampanjnedräkning — urgency-banner som räknar ned till en fast deadline (ms).
// Deadline ankras av anroparen (createdAt + 48 h för sparade poster, annars
// sidladdning + 48 h). Uppdaterar varje sekund och städar sitt intervall när
// elementet inte längre sitter i DOM:en. Vid utgång byts texten mot ett
// slutbudskap i stället för en negativ siffra.
export function countdownBanner(deadlineMs) {
  const timeEl = h('span', { class: 'countdown__time mono' });
  const label = h('span', { class: 'countdown__label' }, 'Kampanjpris gäller i');
  const banner = h('div', { class: 'countdown' }, icon('clock', 'countdown__ico'), label, timeEl);

  function expired() {
    banner.classList.add('countdown--expired');
    clear(banner);
    banner.appendChild(icon('clock', 'countdown__ico'));
    banner.appendChild(h('span', { class: 'countdown__label' }, 'Kampanjerbjudandet har gått ut'));
  }
  function tick() {
    const rem = deadlineMs - Date.now();
    if (rem <= 0) { expired(); return false; }
    timeEl.textContent = formatCountdown(rem);
    return true;
  }

  if (tick()) {
    const id = setInterval(() => {
      if (!banner.isConnected) { clearInterval(id); return; }
      if (!tick()) clearInterval(id);
    }, 1000);
  }
  return banner;
}

// Grön "ingår"-box — en förmån, aldrig med i totalen.
function ingarBox() {
  return h('div', { class: 'ingar' },
    icon('check', 'ingar__ico'),
    h('div', { class: 'ingar__body' },
      h('strong', { class: 'ingar__lead' }, 'Ingår vid köp av däck + garanti:'),
      ' fri hemleverans och 30% på hela hjuluppsättningar.',
    ),
  );
}

// ============================================================
//  Boka provkörning — delad knapp + modal (kund, publik /v/:id och personal)
//  Postar till den publika POST /api/kund/boka (fungerar utan auth).
// ============================================================

// Prominent uppmaning för den visade bilen (används i offertvyer).
export function bokaCta(car) {
  return h('div', { class: 'bokacta' },
    h('div', { class: 'bokacta__text' },
      h('div', { class: 'bokacta__title' }, 'Vill du provköra?'),
      h('div', { class: 'bokacta__sub' }, 'Boka en tid — vi hör av oss och bekräftar.'),
    ),
    bokaButton(car, { block: false }),
  );
}

// Knapp som öppnar bokningsformuläret för en specifik bil.
export function bokaButton(car, opts = {}) {
  return h('button', {
    class: 'btn btn--primary boka-btn' + (opts.block ? ' btn--block' : ''),
    type: 'button', onClick: () => openBoka(car),
  }, icon('calendar'), h('span', {}, opts.label || 'Boka provkörning'));
}

function carDisplayName(car) {
  return car.carName || `${car.make || ''} ${car.model || ''}`.trim() || 'bilen';
}

// Liten laddningsindikator på submit-knappen (fristående från app/kund).
function setBtnBusy(btn, busy, labelWhenBusy) {
  if (!btn) return;
  if (busy) {
    btn._label = btn.innerHTML; btn.classList.add('btn--busy'); btn.innerHTML = '';
    btn.appendChild(h('span', { class: 'spinner' }));
    if (labelWhenBusy) btn.appendChild(h('span', { class: 'btn__label', style: { marginLeft: '8px' } }, labelWhenBusy));
    btn.disabled = true;
  } else { btn.classList.remove('btn--busy'); btn.innerHTML = btn._label || btn.innerHTML; btn.disabled = false; }
}

// En enda modalinstans återanvänds oavsett varifrån bokningen öppnas.
let bokaState = null;
function ensureBokaModal() {
  if (bokaState) return bokaState;
  const panel = h('div', { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Boka provkörning' });
  const root = h('div', { class: 'modal', hidden: true }, panel);
  root.addEventListener('click', (e) => { if (e.target === root) closeBoka(); });
  document.body.appendChild(root);
  bokaState = { root, panel, onKey: null };
  return bokaState;
}

function openBoka(car) {
  const { root, panel } = ensureBokaModal();
  clear(panel);
  panel.appendChild(h('div', { class: 'modal__head' },
    h('div', {},
      h('div', { class: 'modal__kicker' }, 'Boka provkörning'),
      h('div', { class: 'modal__car' }, carDisplayName(car), plate(car.regnr)),
    ),
    h('button', { class: 'iconbtn modal__close', type: 'button', 'aria-label': 'Stäng', onClick: closeBoka }, icon('close')),
  ));
  panel.appendChild(bokaFormBody(car));
  root.hidden = false;
  document.body.classList.add('no-scroll');
  bokaState.onKey = (e) => { if (e.key === 'Escape') closeBoka(); };
  document.addEventListener('keydown', bokaState.onKey);
  setTimeout(() => { const first = panel.querySelector && panel.querySelector('input'); if (first) first.focus(); }, 40);
}

function closeBoka() {
  if (!bokaState) return;
  bokaState.root.hidden = true;
  document.body.classList.remove('no-scroll');
  if (bokaState.onKey) document.removeEventListener('keydown', bokaState.onKey);
}

function bokaField(label, type, attrs = {}) {
  const input = h('input', Object.assign({ class: 'input', type }, attrs));
  const wrap = h('div', { class: 'field' }, h('label', { class: 'field__label' }, label), input);
  return { wrap, input };
}

function bokaFormBody(car) {
  const body = h('div', { class: 'modal__body' });
  const err = h('p', { class: 'field__error', hidden: true });
  const today = new Date().toISOString().slice(0, 10);

  const namn = bokaField('Namn', 'text', { required: true, autocomplete: 'name', placeholder: 'För- och efternamn' });
  const tel = bokaField('Telefon', 'tel', { required: true, autocomplete: 'tel', placeholder: '07X XXX XX XX' });
  const mejl = bokaField('E-post (valfritt)', 'email', { autocomplete: 'email', placeholder: 'namn@exempel.se' });
  const dag = bokaField('Önskad dag', 'date', { required: true, min: today });
  const tid = bokaField('Önskad tid', 'time', { required: true });

  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Skicka bokning');
  const form = h('form', { class: 'boka__form' },
    h('div', { class: 'boka__grid' },
      namn.wrap, tel.wrap, mejl.wrap,
      h('div', { class: 'boka__row2' }, dag.wrap, tid.wrap),
    ),
    err,
    submit,
    h('p', { class: 'boka__fine' }, 'Vi kontaktar dig för att bekräfta tiden. Ingen betalning sker här.'),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const namnV = namn.input.value.trim();
    const telV = tel.input.value.trim();
    const dagV = dag.input.value;
    const tidV = tid.input.value;
    if (!namnV || !telV || !dagV || !tidV) {
      err.textContent = 'Fyll i namn, telefon, önskad dag och önskad tid.';
      err.hidden = false;
      return;
    }
    setBtnBusy(submit, true, 'Skickar');
    let res;
    try {
      res = await apiBoka({
        regnr: car.regnr, carName: carDisplayName(car),
        namn: namnV, telefon: telV, mejl: mejl.input.value.trim(),
        datum: dagV, tid: tidV,
      });
    } catch { res = { ok: false, error: 'Nätverksfel. Kontrollera uppkopplingen och försök igen.' }; }
    setBtnBusy(submit, false);
    if (res && res.ok) renderBokaConfirm(body, car, res);
    else { err.textContent = (res && res.error) || 'Kunde inte boka just nu. Försök igen.'; err.hidden = false; }
  });

  body.appendChild(form);
  return body;
}

function absoluteAvboka(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return location.origin + (url.startsWith('/') ? url : '/' + url);
}

function renderBokaConfirm(body, car, res) {
  clear(body);
  const href = absoluteAvboka(res.avbokaUrl);
  body.appendChild(h('div', { class: 'boka__confirm' },
    h('div', { class: 'boka__confirm-ic' }, icon('check')),
    h('h3', { class: 'boka__confirm-title' }, 'Tack!'),
    h('p', { class: 'boka__confirm-text' }, `Vi hör av oss för att bekräfta din provkörning av ${carDisplayName(car)}.`),
    href ? h('a', { class: 'boka__avboka', href }, 'Ändrade dig? Avboka här') : null,
    h('button', { class: 'btn btn--ghost', type: 'button', onClick: closeBoka }, 'Stäng'),
  ));
}
