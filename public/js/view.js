// view.js — publik, skrivskyddad vy för en sparad post (/v/:id). Ingen inloggning.

import { apiGetRecord, MOCK } from './api.js';
import { priceBreakdown, datum, kampanjDeadline } from './config.js';
import { h, clear, icon, carCard, offertCar, breakdownView, countdownBanner, bokaButton, bokaCta, plate, mockRibbon, financeCalculator } from './components.js';

const LOGO_DARK = 'https://usercontent.one/wp/www.onecargroup.se/wp-content/uploads/2026/05/cropped-One-Car-192x192.png';
const root = document.getElementById('app');

// id från /v/:id (eller ?id= som reserv för statisk servering).
function recordId() {
  const q = new URLSearchParams(location.search).get('id');
  if (q) return q;
  const m = location.pathname.match(/\/v\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

(async function boot() {
  const id = recordId();
  clear(root);
  root.appendChild(shell(loadingBlock()));
  if (!id) return renderMissing('Ingen post angiven.');

  const res = await apiGetRecord(id);
  if (!res.ok || !res.record) return renderMissing();
  renderRecord(res.record);
})();

function shell(content, heroData) {
  return h('div', { class: 'app' },
    h('header', { class: 'pubhero' },
      h('div', { class: 'container' },
        h('div', { class: 'pubhero__in' },
          h('img', { class: 'pubhero__logo', src: LOGO_DARK, alt: 'One Car Group' }),
          heroData ? [
            h('span', { class: 'pubhero__kicker' }, heroData.kicker),
            h('h1', { class: 'pubhero__title' }, heroData.title),
            heroData.meta ? h('p', { class: 'pubhero__meta' }, heroData.meta) : null,
          ] : null,
        ),
      ),
    ),
    h('main', { class: 'main' }, h('div', { class: 'container', id: 'pubmount' }, content)),
    siteFooter(),
  );
}

function renderRecord(record) {
  const { mode, cars = [], config, createdAt } = record;
  const isOffert = mode === 'offert';
  const heroData = {
    kicker: isOffert ? 'Personlig offert' : 'Bil-jämförelse',
    title: isOffert
      ? (config?.customer?.name ? `Erbjudande till ${config.customer.name}` : 'Ditt erbjudande')
      : `${cars.length} bilar sida vid sida`,
    meta: `Från One Car Group${createdAt ? ' · ' + datum(createdAt) : ''}`,
  };

  const blocks = [];
  if (MOCK) blocks.push(mockRibbon());

  // Kampanjnedräkning ankrad till postens createdAt + 48 h — visar den
  // VERKLIGA återstående tiden, nollställs aldrig vid omladdning av länken.
  const startMs = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isNaN(startMs)) blocks.push(countdownBanner(kampanjDeadline(startMs)));

  if (isOffert && cars[0]) {
    blocks.push(renderPublicOffert(cars[0], config));
  } else {
    blocks.push(renderPublicCompare(cars));
  }
  blocks.push(publicNote());

  clear(root);
  root.appendChild(shell(h('div', { class: 'tool' }, blocks), heroData));
}

function renderPublicCompare(cars) {
  if (!cars.length) return h('div', { class: 'notice notice--info' }, icon('close'), 'Inga bilar i denna jämförelse.');
  const grid = h('div', { class: 'compare compare--' + Math.min(cars.length, 4) });
  cars.forEach((car) => grid.appendChild(h('div', { class: 'kund-carwrap' }, carCard(car, {}), bokaButton(car, { block: true }))));
  return grid;
}

function renderPublicOffert(car, config) {
  const grid = h('div', { class: 'offert' });
  const breakdown = priceBreakdown(car, config);
  const side = h('div', { class: 'offert__panel' }, breakdownView(breakdown));
  side.appendChild(financeCalculator(car));
  if (config?.notes) {
    side.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('div', { class: 'panel__title' }, 'Anteckning')),
      h('div', { class: 'panel__body' }, h('p', { style: { color: 'var(--ink-2)', whiteSpace: 'pre-wrap' } }, config.notes)),
    ));
  }
  grid.appendChild(h('div', { class: 'offert__car' }, bokaCta(car), offertCar(car)));
  grid.appendChild(side);
  return grid;
}

function publicNote() {
  return h('div', { class: 'pubnote' }, icon('external'),
    'Uppgifterna sparades när länken skapades och kan ha ändrats. Länken slutar gälla 7 dagar efter att den skapades. Kontakta din säljare för aktuellt pris och lagerstatus.');
}

function loadingBlock() {
  return h('div', { class: 'tool' },
    h('div', { class: 'compare compare--2' },
      skeletonCard(), skeletonCard(),
    ),
  );
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

function renderMissing(msg) {
  clear(root);
  root.appendChild(shell(
    h('div', { class: 'empty' },
      h('div', { class: 'empty__ic' }, icon('external')),
      h('h3', {}, 'Länken finns inte'),
      h('p', {}, msg || 'Den här delade länken har antingen gått ut (länkar gäller i 7 dagar) eller så är adressen felaktig.'),
      h('a', { class: 'btn btn--ghost', href: 'https://www.onecargroup.se', target: '_blank', rel: 'noopener', style: { marginTop: '18px' } }, 'Till onecargroup.se'),
    ),
  ));
}

function siteFooter() {
  return h('footer', { class: 'sitefooter' },
    h('div', { class: 'container' },
      h('div', { class: 'sitefooter__in' },
        h('span', { class: 'sitefooter__copy' }, `© ${new Date().getFullYear()} One Car Group`),
        h('a', { class: 'gate-powered', href: 'https://gate1.dev', target: '_blank', rel: 'noopener', dataset: { gatePowered: '' } },
          h('span', { class: 'gate-powered__dot' }), 'Powered by GATE'),
      ),
    ),
  );
}
