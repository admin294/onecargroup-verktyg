// kund.js — PUBLIK självbetjäningsvy (/kund). Ingen inloggning.
// Kunden slår upp regnr, ser bilen, växlar Offert/
// Jämförelse, väljer garanti + däck och ser livepris med 48h-kampanjnedräkning.
// Återanvänder de delade komponenterna. Sparar inga poster (ingen delbar länk).

import { MOCK, apiKundLookup } from './api.js';
import {
  defaultConfig, priceBreakdown, DACK, GARANTI_AR, GARANTI_SEK, GARANTI_KAMPANJ,
  kampanjDeadline, KONTAKT, kr, normRegnr,
} from './config.js';
import {
  h, clear, icon, carCard, offertCar, breakdownView, countdownBanner, kontaktBlock, plate,
  bokaButton, bokaCta,
} from './components.js';

const LOGO_DARK = 'https://usercontent.one/wp/www.onecargroup.se/wp-content/uploads/2026/05/cropped-One-Car-192x192.png';
const root = document.getElementById('app');

// Kampanjen räknas ned från sidladdningen (kundsidan sparar ingen post med
// createdAt) — beräknas en gång så den aldrig nollställs vid omritning.
const SESSION_DEADLINE = kampanjDeadline(Date.now());

const state = {
  mode: 'offert',
  compareRegs: ['', ''],
  compareCars: {},
  offertReg: '',
  offertCar: null,
  config: defaultConfig(),
};

function toast(msg) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts' }); document.body.appendChild(box); }
  const t = h('div', { class: 'toast' }, icon('check'), msg);
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; setTimeout(() => t.remove(), 320); }, 2600);
}
function setBusy(btn, busy, labelWhenBusy) {
  if (!btn) return;
  if (busy) {
    btn._label = btn.innerHTML; btn.classList.add('btn--busy'); btn.innerHTML = '';
    btn.appendChild(h('span', { class: 'spinner' }));
    if (labelWhenBusy) btn.appendChild(h('span', { class: 'btn__label', style: { marginLeft: '8px' } }, labelWhenBusy));
    btn.disabled = true;
  } else { btn.classList.remove('btn--busy'); btn.innerHTML = btn._label || btn.innerHTML; btn.disabled = false; }
}

// ============================================================
//  Layout
// ============================================================
renderApp();

function renderApp() {
  clear(root);
  const toolMount = h('div', { id: 'tool' });
  root.appendChild(
    h('div', { class: 'app' },
      hero(),
      h('main', { class: 'main' },
        h('div', { class: 'container' },
          h('div', { class: 'kund-top' }, kontaktBlock(KONTAKT)),
          modeBar(),
          toolMount,
        ),
      ),
      siteFooter(),
    ),
  );
  renderMode(toolMount);
}

function hero() {
  return h('header', { class: 'kundhero' },
    h('div', { class: 'container' },
      h('div', { class: 'kundhero__in' },
        h('a', { class: 'brandmark', href: 'https://www.onecargroup.se', target: '_blank', rel: 'noopener' },
          h('img', { src: LOGO_DARK, alt: 'One Car Group' })),
        h('h1', { class: 'kundhero__title' }, 'Räkna ut ditt pris'),
        h('p', { class: 'kundhero__sub' }, 'Ange registreringsnummer så visar vi bilen och ett prisförslag med garanti och vinterdäck. Kampanjpriset gäller i 48 timmar.'),
      ),
    ),
  );
}

function modeBar() {
  const modes = [{ k: 'offert', label: 'Räkna ut pris' }, { k: 'jamforelse', label: 'Jämför bilar' }];
  const thumb = h('span', { class: 'segmented__thumb' });
  const seg = h('div', { class: 'segmented', role: 'tablist' },
    thumb,
    modes.map((m) => h('button', {
      class: 'segmented__btn', role: 'tab', type: 'button', dataset: { mode: m.k },
      'aria-selected': state.mode === m.k ? 'true' : 'false',
      onClick: () => switchMode(m.k),
    }, m.label)),
  );
  requestAnimationFrame(() => positionThumb(seg));
  return h('div', { class: 'modebar' }, seg);
}
function positionThumb(seg) {
  const active = seg.querySelector('[aria-selected="true"]');
  const thumb = seg.querySelector('.segmented__thumb');
  if (active && thumb) { thumb.style.width = active.offsetWidth + 'px'; thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`; }
}
function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  const bar = document.querySelector('.modebar');
  if (bar) {
    bar.querySelectorAll('.segmented__btn').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false'));
    positionThumb(bar.querySelector('.segmented'));
  }
  renderMode(document.getElementById('tool'));
}
function renderMode(mount) {
  clear(mount);
  mount.appendChild(state.mode === 'offert' ? renderOffert() : renderCompare());
}

// ============================================================
//  Offert
// ============================================================
function renderOffert() {
  const wrap = h('div', { class: 'tool' });
  const regInput = h('input', {
    class: 'input input--regnr', type: 'text', placeholder: 'Regnr', value: state.offertReg, maxLength: 8,
    onInput: (e) => { state.offertReg = normRegnr(e.target.value); },
    onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('runOffert').click(); } },
  });
  const status = h('div', { class: 'regrow__status' });
  const lookupCard = h('section', { class: 'lookup' },
    h('div', { class: 'lookup__title' }, 'Ditt registreringsnummer'),
    h('div', { class: 'regrow' }, regInput,
      h('button', { class: 'btn btn--primary', type: 'button', id: 'runOffert', onClick: (e) => runOffert(e.currentTarget) }, 'Räkna ut pris'),
      status,
    ),
  );
  const body = h('div', {});

  async function runOffert(btn) {
    const reg = normRegnr(state.offertReg);
    if (!reg) { toast('Ange ett registreringsnummer'); return; }
    setBusy(btn, true, 'Hämtar'); clear(body); clear(status);
    body.appendChild(skeletonOffert());
    const res = await apiKundLookup(reg);
    setBusy(btn, false); clear(body);
    if (res.ok && res.car) {
      state.offertCar = res.car; state.config = defaultConfig();
      status.className = 'regrow__status regrow__status--ok'; status.appendChild(icon('check'));
      body.appendChild(buildOffert(res.car));
    } else {
      status.className = 'regrow__status regrow__status--err'; status.appendChild(icon('close'));
      body.appendChild(lookupErrorNotice(reg, res));
    }
  }

  wrap.appendChild(lookupCard);
  if (state.offertCar) { status.className = 'regrow__status regrow__status--ok'; status.appendChild(icon('check')); body.appendChild(buildOffert(state.offertCar)); }
  else body.appendChild(offertEmpty());
  wrap.appendChild(body);
  return wrap;
}

function offertEmpty() {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__ic' }, icon('pdf')),
    h('h3', {}, 'Se ditt pris direkt'),
    h('p', {}, 'Skriv in bilens registreringsnummer, välj garanti och vinterdäck och se totalpriset räknas fram med aktuellt kampanjpris.'),
  );
}

function buildOffert(car) {
  const grid = h('div', { class: 'offert' });
  const breakdownMount = h('div', {});
  function refreshBreakdown() { clear(breakdownMount); breakdownMount.appendChild(breakdownView(priceBreakdown(car, state.config))); }

  const garantiOpts = h('div', { class: 'garanti' },
    GARANTI_AR.map((yr) => {
      const kampanj = GARANTI_KAMPANJ[yr];
      return h('label', { class: 'opt' + (kampanj ? ' opt--kampanj' : '') },
        h('input', { type: 'radio', name: 'garanti', value: String(yr), checked: state.config.warrantyYears === yr,
          onChange: () => { state.config.warrantyYears = yr; refreshBreakdown(); } }),
        h('span', { class: 'opt__box' },
          kampanj ? h('span', { class: 'opt__badge' }, kampanj.etikett) : null,
          h('span', { class: 'opt__yr' }, yr === 0 ? 'Ingen' : `${yr} år`),
          kampanj
            ? h('span', { class: 'opt__price mono' }, h('s', { class: 'opt__ord' }, kr(kampanj.ordinariePris)), ' ', h('span', { class: 'opt__now' }, '+' + kr(GARANTI_SEK[yr])))
            : h('span', { class: 'opt__price mono' }, yr === 0 ? '0 kr' : '+' + kr(GARANTI_SEK[yr])),
        ),
      );
    }),
  );
  const dackSelect = h('select', { class: 'select', onChange: (e) => { state.config.tireOptionKey = e.target.value; refreshBreakdown(); } },
    DACK.map((d) => h('option', { value: d.key, selected: state.config.tireOptionKey === d.key }, `${d.label} — ${d.price ? '+' + kr(d.price) : '0 kr'}`)),
  );

  const panel = h('div', { class: 'offert__panel' },
    h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('div', { class: 'panel__title' }, 'Anpassa ditt erbjudande')),
      h('div', { class: 'panel__body' },
        h('div', { class: 'optgroup' }, h('div', { class: 'optgroup__label' }, 'Garanti (Garanti365-EV)'), garantiOpts),
        h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Vinterdäck'), dackSelect),
      ),
    ),
    breakdownMount,
    kontaktBlock(KONTAKT, { compact: true }),
  );

  refreshBreakdown();
  grid.appendChild(h('div', { class: 'offert__car' }, bokaCta(car), offertCar(car)));
  grid.appendChild(panel);
  return h('div', { class: 'offert-view' }, countdownBanner(SESSION_DEADLINE), grid);
}

// ============================================================
//  Jämförelse
// ============================================================
function renderCompare() {
  const wrap = h('div', { class: 'tool' });
  const grid = h('div', { class: 'compare' });
  const bannerMount = h('div', {});
  const listMount = h('div', { class: 'reglist' });

  const lookupCard = h('section', { class: 'lookup' },
    h('div', { class: 'lookup__title' }, 'Registreringsnummer att jämföra (2–4)'),
    listMount,
    h('div', { class: 'reglist__actions' },
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'addReg', onClick: () => { if (state.compareRegs.length < 4) { state.compareRegs.push(''); drawList(); } } }, '+ Lägg till bil'),
      h('button', { class: 'btn btn--primary', type: 'button', id: 'runCompare', onClick: (e) => runCompare(e.currentTarget) }, 'Hämta & jämför'),
    ),
  );

  function drawList() {
    clear(listMount);
    state.compareRegs.forEach((val, i) => {
      const input = h('input', {
        class: 'input input--regnr', type: 'text', placeholder: `Regnr ${i + 1}`, value: val, maxLength: 8,
        onInput: (e) => { state.compareRegs[i] = normRegnr(e.target.value); },
        onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('runCompare').click(); } },
      });
      const remove = state.compareRegs.length > 2
        ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Ta bort rad', onClick: () => { state.compareRegs.splice(i, 1); drawList(); } }, icon('close'))
        : h('div', { class: 'regrow__status' });
      listMount.appendChild(h('div', { class: 'regrow' }, input, h('div', { class: 'regrow__status' }), remove));
    });
    const addBtn = document.getElementById('addReg');
    if (addBtn) addBtn.style.display = state.compareRegs.length >= 4 ? 'none' : '';
  }
  drawList();

  async function runCompare(btn) {
    const regs = state.compareRegs.map(normRegnr).filter(Boolean);
    if (regs.length < 2) { toast('Ange minst två registreringsnummer'); return; }
    setBusy(btn, true, 'Hämtar');
    clear(grid); clear(bannerMount);
    grid.className = 'compare compare--' + Math.min(regs.length, 4);
    regs.forEach(() => grid.appendChild(skeletonCard()));

    const results = await Promise.all(regs.map((r) => apiKundLookup(r)));
    clear(grid); state.compareCars = {};
    const rows = Array.from(listMount.querySelectorAll('.regrow'));
    let okCount = 0;
    results.forEach((res, i) => {
      const status = rows[i]?.querySelector('.regrow__status');
      if (res.ok && res.car) {
        state.compareCars[res.car.regnr] = res.car;
        grid.appendChild(h('div', { class: 'kund-carwrap' }, carCard(res.car, {}), bokaButton(res.car, { block: true })));
        if (status) { status.className = 'regrow__status regrow__status--ok'; status.appendChild(icon('check')); }
        okCount++;
      } else {
        grid.appendChild(lookupErrorCard(regs[i], res));
        if (status) { clear(status); status.className = 'regrow__status regrow__status--err'; status.appendChild(icon('close')); }
      }
    });
    setBusy(btn, false);
    if (okCount >= 1) bannerMount.appendChild(countdownBanner(SESSION_DEADLINE));
  }

  wrap.appendChild(lookupCard);
  wrap.appendChild(bannerMount);
  wrap.appendChild(grid);
  wrap.appendChild(compareEmptyHint(grid));
  return wrap;
}
function compareEmptyHint(grid) {
  if (grid.children.length) return h('div', {});
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__ic' }, icon('image')),
    h('h3', {}, 'Jämför två till fyra bilar'),
    h('p', {}, 'Skriv in registreringsnummer för de bilar du vill jämföra så visas de sida vid sida med pris och utrustning.'),
  );
}

// ============================================================
//  Fel + skelett
// ============================================================
const ERR_TEXT = {
  not_in_stock: 'Bilen finns inte i One Car Groups lager.',
  fetch_error: 'Kunde inte hämta bilens uppgifter. Försök igen om en stund.',
  bad_regnr: 'Ogiltigt registreringsnummer.',
  rate_limited: 'För många förfrågningar just nu. Vänta en stund och försök igen.',
};
function errText(res) { return (res && (ERR_TEXT[res.code] || res.error)) || 'Något gick fel.'; }
function lookupErrorCard(reg, res) {
  return h('article', { class: 'carcard' }, h('div', { class: 'carcard__body' },
    h('div', { class: 'carhead' }, h('div', { class: 'carhead__main' }, h('h3', { class: 'carhead__name' }, reg)), plate(reg)),
    h('div', { class: 'notice notice--error' }, icon('close'), errText(res)),
  ));
}
function lookupErrorNotice(reg, res) {
  return h('div', { class: 'notice notice--error' }, icon('close'), h('span', {}, h('strong', {}, reg + ': '), errText(res)));
}
function skeletonCard() {
  return h('div', { class: 'sk-card' },
    h('div', { class: 'skeleton sk-cover' }),
    h('div', { class: 'sk-lines' },
      h('div', { class: 'skeleton sk-line w-80' }), h('div', { class: 'skeleton sk-line w-40' }),
      h('div', { class: 'skeleton sk-line' }), h('div', { class: 'skeleton sk-line w-60' }),
    ),
  );
}
function skeletonOffert() {
  return h('div', { class: 'offert' },
    skeletonCard(),
    h('div', { class: 'sk-card' }, h('div', { class: 'sk-lines' },
      h('div', { class: 'skeleton sk-line w-40' }), h('div', { class: 'skeleton sk-line' }),
      h('div', { class: 'skeleton sk-line w-80' }), h('div', { class: 'skeleton sk-line w-60' }),
    )),
  );
}

// ============================================================
//  Footer
// ============================================================
function siteFooter() {
  return h('footer', { class: 'sitefooter' },
    h('div', { class: 'container' },
      h('div', { class: 'kund-footer' }, kontaktBlock(KONTAKT)),
      h('div', { class: 'sitefooter__in' },
        h('span', { class: 'sitefooter__copy' }, `© ${new Date().getFullYear()} One Car Group`),
        h('a', { class: 'gate-powered', href: 'https://gate1.dev', target: '_blank', rel: 'noopener', dataset: { gatePowered: '' } },
          h('span', { class: 'gate-powered__dot' }), 'Powered by GATE'),
      ),
    ),
  );
}
