// app.js — internt säljverktyg: inloggning, lägesväxling, jämförelse, offert.

import { MOCK, apiMe, apiLogin, apiLogout, apiLookup, apiCreateRecord } from './api.js';
import { defaultConfig, priceBreakdown, DACK, GARANTI_AR, GARANTI_SEK, GARANTI_KAMPANJ, kampanjDeadline, kr, normRegnr } from './config.js';
import { h, clear, icon, carCard, offertCar, breakdownView, countdownBanner, bokaButton, bokaCta, plate, mockRibbon } from './components.js';

const LOGO_DARK = 'https://webfiles24.blob.core.windows.net/webfiles/new-design/assets/logo/logo-dark.png';
const root = document.getElementById('app');

// Live-byggaren har ingen sparad post ännu → kampanjen räknas ned från
// sidladdningen (en gång, inte per omritning så den aldrig nollställs).
const SESSION_DEADLINE = kampanjDeadline(Date.now());

// ---- Delad state ----
const state = {
  mode: 'jamforelse',
  compareRegs: ['', ''],
  compareCars: {},          // regnr -> car
  offertReg: '',
  offertCar: null,
  config: defaultConfig(),
};

// ---- Verktyg ----
function toast(msg) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts' }); document.body.appendChild(box); }
  const t = h('div', { class: 'toast' }, icon('check'), msg);
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; setTimeout(() => t.remove(), 320); }, 2600);
}
function shareUrl(id) { return `${location.origin}/v/${id}${MOCK ? '?mock=1' : ''}`; }

function setBusy(btn, busy, labelWhenBusy) {
  if (!btn) return;
  if (busy) {
    btn._label = btn.innerHTML;
    btn.classList.add('btn--busy');
    btn.innerHTML = '';
    btn.appendChild(h('span', { class: 'spinner' }));
    if (labelWhenBusy) btn.appendChild(h('span', { class: 'btn__label', style: { marginLeft: '8px' } }, labelWhenBusy));
    btn.disabled = true;
  } else {
    btn.classList.remove('btn--busy');
    btn.innerHTML = btn._label || btn.innerHTML;
    btn.disabled = false;
  }
}

// ============================================================
//  Boot
// ============================================================
(async function boot() {
  const { authed } = await apiMe();
  if (authed) renderApp();
  else renderLogin();
})();

// ============================================================
//  Inloggning
// ============================================================
function renderLogin() {
  clear(root);
  const err = h('p', { class: 'field__error', hidden: true });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Lösenord', autocomplete: 'current-password', name: 'password' });

  const form = h('form', { class: 'login__form' },
    h('div', { class: 'field' },
      h('label', { class: 'field__label', for: 'pw' }, 'Lösenord'),
      pw, err,
    ),
    h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Logga in'),
  );
  pw.id = 'pw';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button');
    setBusy(btn, true, 'Loggar in');
    const { ok } = await apiLogin(pw.value);
    setBusy(btn, false);
    if (ok) renderApp();
    else { err.textContent = 'Fel lösenord. Försök igen.'; err.hidden = false; pw.select(); }
  });

  root.appendChild(
    h('div', { class: 'login' },
      h('div', { class: 'login__aura' }),
      h('div', { class: 'login__card' },
        h('img', { class: 'login__logo', src: LOGO_DARK, alt: 'Riddermark Bil' }),
        h('h1', { class: 'login__title' }, 'Bilverktyg'),
        h('p', { class: 'login__sub' }, 'Bygg jämförelser och offerter från ett registreringsnummer. Inloggning krävs.'),
        form,
        MOCK ? h('p', { class: 'field__hint', style: { marginTop: '16px' } }, 'Demoläge aktivt — valfritt lösenord släpper in dig.') : null,
      ),
      poweredFooterFixed(),
    ),
  );
  setTimeout(() => pw.focus(), 60);
}

// ============================================================
//  Applayout
// ============================================================
function renderApp() {
  clear(root);
  const toolMount = h('div', { id: 'tool' });

  root.appendChild(
    h('div', { class: 'app' },
      topbar(),
      h('main', { class: 'main' },
        h('div', { class: 'container' },
          modeBar(),
          toolMount,
        ),
      ),
      siteFooter(),
    ),
  );
  renderMode(toolMount);
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'container' },
      h('div', { class: 'topbar__in' },
        h('a', { class: 'brandmark', href: '/' },
          h('img', { src: LOGO_DARK, alt: 'Riddermark Bil' }),
          h('span', { class: 'brandmark__tool' }, 'Bilverktyg'),
        ),
        h('div', { class: 'topbar__spacer' }),
        h('div', { class: 'topbar__user' },
          MOCK ? h('span', { class: 'brandmark__tool', style: { border: 'none', color: 'var(--warn)' } }, 'Demoläge') : null,
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: doLogout }, 'Logga ut'),
        ),
      ),
    ),
  );
}

async function doLogout() {
  await apiLogout();
  state.compareCars = {}; state.offertCar = null;
  renderLogin();
}

function modeBar() {
  const modes = [{ k: 'jamforelse', label: 'Jämförelse' }, { k: 'offert', label: 'Offert' }];
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
  if (state.mode === 'jamforelse') mount.appendChild(renderCompare());
  else mount.appendChild(renderOffert());
}

// ============================================================
//  Jämförelse
// ============================================================
function renderCompare() {
  const wrap = h('div', { class: 'tool' });
  const grid = h('div', { class: 'compare' });
  const shareMount = h('div', {});
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
      const status = h('div', { class: 'regrow__status' });
      const remove = state.compareRegs.length > 2
        ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Ta bort rad', onClick: () => { state.compareRegs.splice(i, 1); drawList(); } }, icon('close'))
        : h('div', { class: 'regrow__status' });
      listMount.appendChild(h('div', { class: 'regrow' }, input, status, remove));
    });
    const addBtn = document.getElementById('addReg');
    if (addBtn) addBtn.style.display = state.compareRegs.length >= 4 ? 'none' : '';
  }
  drawList();

  async function runCompare(btn) {
    const regs = state.compareRegs.map(normRegnr).filter(Boolean);
    if (regs.length < 2) { toast('Ange minst två registreringsnummer'); return; }
    setBusy(btn, true, 'Hämtar');
    clear(grid);
    grid.className = 'compare compare--' + Math.min(regs.length, 4);
    regs.forEach(() => grid.appendChild(skeletonCard()));
    clear(shareMount);
    clear(bannerMount);

    const results = await Promise.all(regs.map((r) => apiLookup(r)));
    clear(grid);
    state.compareCars = {};
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

    if (okCount >= 1) {
      bannerMount.appendChild(countdownBanner(SESSION_DEADLINE));
      shareMount.appendChild(shareBar('jamforelse', () => Object.values(state.compareCars), () => Object.keys(state.compareCars), null));
    }
  }

  wrap.appendChild(lookupCard);
  wrap.appendChild(bannerMount);
  wrap.appendChild(grid);
  wrap.appendChild(shareMount);
  wrap.appendChild(emptyCompareHint(grid));
  return wrap;
}

function emptyCompareHint(grid) {
  if (grid.children.length) return h('div', {});
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__ic' }, icon('image')),
    h('h3', {}, 'Ingen jämförelse än'),
    h('p', {}, 'Ange två till fyra registreringsnummer och hämta bilarna för att se dem sida vid sida med batterihälsa, pris och utrustning.'),
  );
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
    h('div', { class: 'lookup__title' }, 'Registreringsnummer för offert'),
    h('div', { class: 'regrow' }, regInput,
      h('button', { class: 'btn btn--primary', type: 'button', id: 'runOffert', onClick: (e) => runOffert(e.currentTarget) }, 'Hämta bil'),
      status,
    ),
  );

  const body = h('div', {});

  async function runOffert(btn) {
    const reg = normRegnr(state.offertReg);
    if (!reg) { toast('Ange ett registreringsnummer'); return; }
    setBusy(btn, true, 'Hämtar');
    clear(body); clear(status);
    body.appendChild(skeletonOffert());
    const res = await apiLookup(reg);
    setBusy(btn, false);
    clear(body);
    if (res.ok && res.car) {
      state.offertCar = res.car;
      state.config = defaultConfig();
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
    h('h3', {}, 'Bygg en offert'),
    h('p', {}, 'Ange ett registreringsnummer, välj garanti och däck och se totalpriset räknas fram live. Skapa sedan en delbar länk till kunden.'),
  );
}

function buildOffert(car) {
  const grid = h('div', { class: 'offert' });
  const breakdownMount = h('div', {});
  const shareMount = h('div', {});

  function refreshBreakdown() {
    clear(breakdownMount);
    breakdownMount.appendChild(breakdownView(priceBreakdown(car, state.config)));
  }

  // Garantival (0–5 år). 5 år är en kampanj: KAMPANJ-badge + överstruket
  // ordinariepris bredvid kampanjpriset så det läser som bästa affären.
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
            ? h('span', { class: 'opt__price mono' },
                h('s', { class: 'opt__ord' }, kr(kampanj.ordinariePris)), ' ',
                h('span', { class: 'opt__now' }, '+' + kr(GARANTI_SEK[yr])))
            : h('span', { class: 'opt__price mono' }, yr === 0 ? '0 kr' : '+' + kr(GARANTI_SEK[yr])),
        ),
      );
    }),
  );

  // Däckval
  const dackSelect = h('select', { class: 'select',
    onChange: (e) => { state.config.tireOptionKey = e.target.value; refreshBreakdown(); } },
    DACK.map((d) => h('option', { value: d.key, selected: state.config.tireOptionKey === d.key },
      `${d.label} — ${d.price ? '+' + kr(d.price) : '0 kr'}`)),
  );

  // Kundfält
  const cust = state.config.customer;
  const custFields = h('div', { class: 'customer' },
    field('Kundnamn', 'text', cust.name, (v) => cust.name = v, 'field--full', 'Namn eller företag'),
    field('Org./pers.nr', 'text', cust.org, (v) => cust.org = v),
    field('Telefon', 'tel', cust.phone, (v) => cust.phone = v),
    field('E-post', 'email', cust.email, (v) => cust.email = v, 'field--full'),
  );
  const notes = h('textarea', { class: 'textarea', placeholder: 'Fri text som visas i offerten (valfritt)', value: state.config.notes,
    onInput: (e) => { state.config.notes = e.target.value; } });

  const panel = h('div', { class: 'offert__panel' },
    h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('div', { class: 'panel__title' }, 'Konfigurera erbjudande')),
      h('div', { class: 'panel__body' },
        h('div', { class: 'optgroup' }, h('div', { class: 'optgroup__label' }, 'Garanti (Garanti365-EV)'), garantiOpts),
        h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Vinterdäck'), dackSelect),
        h('div', { class: 'optgroup' }, h('div', { class: 'optgroup__label' }, 'Kunduppgifter'), custFields),
        h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Anteckning'), notes),
      ),
    ),
    breakdownMount,
    shareMount,
  );

  refreshBreakdown();
  shareMount.appendChild(shareBar('offert', () => [car], () => [car.regnr], () => state.config));

  grid.appendChild(h('div', { class: 'offert__car' }, bokaCta(car), offertCar(car)));
  grid.appendChild(panel);
  return h('div', { class: 'offert-view' }, countdownBanner(SESSION_DEADLINE), grid);
}

function field(label, type, value, onChange, extraClass, placeholder) {
  const input = h('input', { class: 'input', type: type || 'text', value: value || '', placeholder: placeholder || '',
    onInput: (e) => onChange(e.target.value) });
  return h('div', { class: 'field ' + (extraClass || '') },
    h('label', { class: 'field__label' }, label), input);
}

// ============================================================
//  Delningsfält (skapa /v/:id)
// ============================================================
function shareBar(mode, getCars, getRegnrs, getConfig) {
  const mount = h('div', {});
  const btn = h('button', { class: 'btn btn--primary', type: 'button' },
    icon('external'), mode === 'offert' ? 'Skapa offert-länk' : 'Skapa delbar länk');

  btn.addEventListener('click', async () => {
    const cars = getCars();
    if (!cars.length) { toast('Inga bilar att spara'); return; }
    setBusy(btn, true, 'Skapar länk');
    const payload = { mode, regnrs: getRegnrs(), cars, config: getConfig ? getConfig() : null };
    const res = await apiCreateRecord(payload);
    setBusy(btn, false);
    if (res.ok && res.id) renderShareResult(mount, res.id);
    else toast(res.error || 'Kunde inte skapa länk');
  });

  mount.appendChild(h('div', { style: { marginTop: '4px' } }, btn));
  return mount;
}

function renderShareResult(mount, id) {
  const url = shareUrl(id);
  const urlInput = h('input', { class: 'input', type: 'text', value: url, readonly: true, onFocus: (e) => e.target.select() });
  const box = h('div', { class: 'sharebox' },
    h('div', { class: 'sharebox__title' }, icon('check'), 'Länk skapad'),
    h('div', { class: 'shareurl' },
      urlInput,
      h('button', { class: 'btn', type: 'button', onClick: async () => {
        try { await navigator.clipboard.writeText(url); toast('Länk kopierad'); }
        catch { urlInput.select(); document.execCommand && document.execCommand('copy'); toast('Länk kopierad'); }
      } }, 'Kopiera'),
      h('a', { class: 'btn btn--ghost', href: url, target: '_blank', rel: 'noopener' }, 'Öppna'),
    ),
    h('div', { class: 'sharebox__expiry' }, 'Länken är publik och slutar gälla automatiskt efter 7 dagar.'),
  );
  clear(mount);
  mount.appendChild(h('div', { style: { marginTop: '4px' } }, box));
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
//  Fel- och laddningstillstånd
// ============================================================
const ERR_TEXT = {
  not_in_stock: 'Bilen finns inte i lager.',
  fetch_error: 'Kunde inte hämta bilens uppgifter. Försök igen.',
  bad_regnr: 'Ogiltigt registreringsnummer.',
  unauthorized: 'Din session har gått ut. Logga in igen.',
};
function errText(res) { return (res && (ERR_TEXT[res.code] || res.error)) || 'Något gick fel.'; }

function lookupErrorCard(reg, res) {
  return h('article', { class: 'carcard' }, h('div', { class: 'carcard__body' },
    h('div', { class: 'carhead' }, h('div', { class: 'carhead__main' }, h('h3', { class: 'carhead__name' }, reg)), plate(reg)),
    h('div', { class: 'notice notice--error' }, icon('close'), errText(res)),
  ));
}
function lookupErrorNotice(reg, res) {
  if (res.code === 'unauthorized') setTimeout(() => renderLogin(), 900);
  return h('div', { class: 'notice notice--error' }, icon('close'), h('span', {}, h('strong', {}, reg + ': '), errText(res)));
}

function skeletonCard() {
  return h('div', { class: 'sk-card' },
    h('div', { class: 'skeleton sk-cover' }),
    h('div', { class: 'sk-lines' },
      h('div', { class: 'skeleton sk-line w-80' }),
      h('div', { class: 'skeleton sk-line w-40' }),
      h('div', { class: 'skeleton sk-line' }),
      h('div', { class: 'skeleton sk-line w-60' }),
    ),
  );
}
function skeletonOffert() {
  return h('div', { class: 'offert' },
    skeletonCard(),
    h('div', { class: 'sk-card' }, h('div', { class: 'sk-lines' },
      h('div', { class: 'skeleton sk-line w-40' }),
      h('div', { class: 'skeleton sk-line' }),
      h('div', { class: 'skeleton sk-line w-80' }),
      h('div', { class: 'skeleton sk-line w-60' }),
    )),
  );
}

// ============================================================
//  Footer
// ============================================================
function siteFooter() {
  return h('footer', { class: 'sitefooter' },
    h('div', { class: 'container' },
      h('div', { class: 'sitefooter__in' },
        h('span', { class: 'sitefooter__copy' }, `© ${new Date().getFullYear()} Riddermark Bil · Internt verktyg`),
        gatePowered(),
      ),
    ),
  );
}
function poweredFooterFixed() {
  return h('div', { class: 'container', style: { position: 'relative', zIndex: '1', paddingBottom: '24px', textAlign: 'center' } }, gatePowered());
}

// Powered by GATE — verbatim med data-gate-powered-markören.
function gatePowered() {
  return h('a', {
    class: 'gate-powered', href: 'https://gate1.dev', target: '_blank', rel: 'noopener',
    dataset: { gatePowered: '' },
  }, h('span', { class: 'gate-powered__dot' }), 'Powered by GATE');
}

export { toast };
