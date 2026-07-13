// fixture.js — mockdata för utveckling utan backend.
// RDM55F är den riktiga fixturen från API-kontraktet. Övriga bilar är
// MARKERADE demo-bilar (isMock) enbart för att kunna testa jämförelsevyn
// offline — de finns inte i något riktigt lager och används aldrig i prod.

export const RDM55F = {
  regnr: 'RDM55F',
  sourceUrl: 'https://www.onecargroup.se/kopa-bil/bmw/rdm55f/',
  make: 'BMW',
  model: 'iX3',
  modelDescription: '286hk Charged Panorama Adapt-fart Elstol Läder MOMS',
  carName: 'BMW iX3 286hk, 2021',
  modelYear: 2021,
  price: 364800,
  initialPrice: 364800,
  mileageMil: 8623,
  color: 'Svart',
  fuelType: 'El',
  gearbox: 'Automatisk',
  vin: 'WBY7X4101MS156671',
  isSold: false,
  location: 'Örebro',
  ownerCount: 3,
  coverImage: 'https://picsum.photos/seed/rdm55f-cover/1200/800',
  images: [
    'https://picsum.photos/seed/rdm55f-1/1200/800',
    'https://picsum.photos/seed/rdm55f-2/1200/800',
    'https://picsum.photos/seed/rdm55f-3/1200/800',
    'https://picsum.photos/seed/rdm55f-4/1200/800',
    'https://picsum.photos/seed/rdm55f-5/1200/800',
    'https://picsum.photos/seed/rdm55f-6/1200/800',
  ],
  equipment: ['Leasbar/MOMS', 'Charged', 'Panorama', 'Adaptiv farthållare', 'Elstol', 'Läder'],
  inspection: { date: '2025-04-08', mileageMil: 6715 },
  service: { date: '2025-10-10', mileageMil: 4929 },
};

// MOCK-ONLY demo-bilar (isMock: true). Realistiska svenska lagerbilar för
// att jämförelsevyn ska se levande ut under utveckling.
const TSL44K = {
  regnr: 'TSL44K',
  sourceUrl: 'https://www.onecargroup.se/kopa-bil/tesla/tsl44k/',
  make: 'Tesla', model: 'Model 3',
  modelDescription: 'Long Range AWD Pano Autopilot Vinterhjul MOMS',
  carName: 'Tesla Model 3 Long Range AWD, 2022',
  modelYear: 2022, price: 312500, initialPrice: 329900,
  mileageMil: 5410, color: 'Midnattsgrå', fuelType: 'El', gearbox: 'Automatisk',
  vin: '5YJ3E7EBXNF000273', isSold: false, location: 'Segeltorp', ownerCount: 2,
  coverImage: 'https://picsum.photos/seed/tsl44k-cover/1200/800',
  images: [
    'https://picsum.photos/seed/tsl44k-1/1200/800',
    'https://picsum.photos/seed/tsl44k-2/1200/800',
    'https://picsum.photos/seed/tsl44k-3/1200/800',
    'https://picsum.photos/seed/tsl44k-4/1200/800',
  ],
  equipment: ['MOMS', 'Autopilot', 'Panorama', 'Vinterhjul', 'Navigation', 'Värmepump'],
  inspection: { date: '2025-06-19', mileageMil: 4980 },
  service: { date: '2025-09-02', mileageMil: 5120 },
  isMock: true,
};

const POL09X = {
  regnr: 'POL09X',
  sourceUrl: 'https://www.onecargroup.se/kopa-bil/polestar/pol09x/',
  make: 'Polestar', model: '2',
  modelDescription: 'Long Range Dual Motor Plus Pilot Läder',
  carName: 'Polestar 2 Long Range Dual Motor, 2021',
  modelYear: 2021, price: 268900, initialPrice: 268900,
  mileageMil: 11240, color: 'Thunder', fuelType: 'El', gearbox: 'Automatisk',
  vin: 'LPSED3KA9ML000914', isSold: false, location: 'Örebro', ownerCount: 4,
  coverImage: 'https://picsum.photos/seed/pol09x-cover/1200/800',
  images: [
    'https://picsum.photos/seed/pol09x-1/1200/800',
    'https://picsum.photos/seed/pol09x-2/1200/800',
    'https://picsum.photos/seed/pol09x-3/1200/800',
  ],
  equipment: ['Plus-paket', 'Pilot-paket', 'Läder', 'Harman Kardon', 'Panorama'],
  inspection: { date: '2025-02-11', mileageMil: 9870 },
  service: { date: '2025-08-15', mileageMil: 10430 },
  isMock: true,
};

const VOL71C = {
  regnr: 'VOL71C',
  sourceUrl: 'https://www.onecargroup.se/kopa-bil/volvo/vol71c/',
  make: 'Volvo', model: 'XC40',
  modelDescription: 'Recharge Single Motor Core',
  carName: 'Volvo XC40 Recharge, 2023',
  modelYear: 2023, price: 329000, initialPrice: 329000,
  mileageMil: 3120, color: 'Vit', fuelType: 'El', gearbox: 'Automatisk',
  vin: 'YV1XZK9V1P2000551', isSold: false, location: 'Malmö',
  coverImage: 'https://picsum.photos/seed/vol71c-cover/1200/800',
  images: [
    'https://picsum.photos/seed/vol71c-1/1200/800',
    'https://picsum.photos/seed/vol71c-2/1200/800',
  ],
  equipment: ['Core-paket', 'Adaptiv farthållare', 'Navigation'],
  inspection: null,
  service: { date: '2025-11-01', mileageMil: 2900 },
  isMock: true,
};

export const MOCK_CARS = {
  RDM55F,
  TSL44K,
  POL09X,
  VOL71C,
};

// Regnr som medvetet ger "finns ej i lager" i mock-läge, för att testa felvyn.
export const MOCK_NOT_IN_STOCK = new Set(['XXX000', 'ABC123']);
