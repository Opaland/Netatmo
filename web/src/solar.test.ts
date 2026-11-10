// #204 (location) and #356 (solar simulator): pure computations of solar.ts.
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/home-location.json';
import {
  type HourProfile,
  type SimDay,
  type SolarInputs,
  NO_INPUTS,
  SCENARIOS,
  azimuthWord,
  combinedProfile,
  dayProduction,
  locationJson,
  parseLocation,
  parsePvgisFile,
  parseSolarDoc,
  parseSolarInputs,
  pvgisAspect,
  runAll,
  simWindow,
  simulate,
  yearlyPerKwc,
} from './solar';

const TZ = 'Europe/Paris';
const nightSlot = Array.from({ length: 48 }, (_, i) => (i >= 44 || i < 12 ? 1 : 0)); // 22 h → 6 h
const prices = { priceHp: 0.25, priceHc: 0.2, feedIn: 0.04, costPerKwc: 2000, batteryCostPerKwh: 500, batteryEfficiency: 0.9 };

/** A typical year where every day has the same 24 UTC hours (Wh per kWc). */
function flatProfile(row: number[]): HourProfile {
  const p: HourProfile = {};
  for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2024, 0, 1); t += 86400000) p[new Date(t).toISOString().slice(5, 10)] = row.slice();
  return p;
}
const zeros = () => new Array(48).fill(0);
function day(wh: number[], prod: number[], shiftable = 0): SimDay {
  return { day: '2026-06-15', wh, prod, shiftable, rebuilt: false };
}

describe('#204 localisation : une seule règle avec le collecteur (fixture partagée)', () => {
  it.each(fixture.valid.map((c, i) => [i, c] as const))('valide n° %i : arrondie à sa précision, texte nettoyé', (_i, c) => {
    expect(parseLocation(c.in)).toEqual(c.out);
  });
  it.each(fixture.invalid.map((c, i) => [i, c] as const))('invalide n° %i : refusée', (_i, c) => {
    expect(parseLocation(c)).toBeNull();
  });
  it('relit à l’identique ce qu’elle écrit', () => {
    const l = parseLocation(fixture.valid[1].in)!;
    expect(parseLocation(JSON.parse(locationJson(l)))).toEqual(l);
  });
  it('« __proto__ » ou une propriété héritée ne remplacent pas un champ', () => {
    const base = { ...fixture.valid[0].in } as Record<string, unknown>;
    delete base.v;
    expect(parseLocation(Object.create({ v: 1 }, Object.getOwnPropertyDescriptors(base)))).toBeNull();
  });
  it('orientation : boussole → PVGIS (0 = sud, −90 = est, 90 = ouest) et en mots', () => {
    expect([180, 90, 270, 0, 135].map(pvgisAspect)).toEqual([0, -90, 90, -180, -45]);
    expect([180, 135, 90, 225, 350].map(azimuthWord)).toEqual(['sud', 'sud-est', 'est', 'sud-ouest', 'nord']);
  });
});

describe('#356 fichier PVGIS importé', () => {
  const rows = (peak: number) => {
    const lines: string[] = [];
    for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2024, 0, 1); t += 3600000) {
      const d = new Date(t);
      const stamp = `${d.toISOString().slice(0, 10).replaceAll('-', '')}:${String(d.getUTCHours()).padStart(2, '0')}10`;
      const w = d.getUTCHours() === 11 ? 800 * peak : 0;
      lines.push(`${stamp},${w},0.0,0.0,12.36,5.66,0.0`);
    }
    return lines;
  };
  const csv = (peak: number) =>
    [
      'Latitude (decimal degrees):\t45.760',
      'Longitude (decimal degrees):\t4.840',
      'Radiation database:\tPVGIS-SARAH3',
      `Nominal power of the PV system (c-Si) (kWp):\t${peak}`,
      'time,P,G(i),H_sun,T2m,WS10m,Int',
      ...rows(peak),
      '',
      'P: PV system power (W)',
    ].join('\r\n');

  it('CSV : production par kWc, heure UTC, sans garder les coordonnées', () => {
    const r = parsePvgisFile(csv(2));
    if ('error' in r) throw new Error(r.error);
    expect(r.year).toBe(2023);
    expect(r.database).toBe('PVGIS-SARAH3');
    expect(r.roof.kwc).toBe(1);
    expect(r.roof.hours['06-21'][11]).toBe(800); // 1 600 W for 2 kWc → 800 Wh per kWc in that hour
    expect(r.roof.hours['06-21'][10]).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/45\.76|4\.84/);
  });
  it('JSON : même lecture', () => {
    const hourly = rows(1).map((l) => ({ time: l.split(',')[0], P: Number(l.split(',')[1]) }));
    const r = parsePvgisFile(JSON.stringify({ inputs: { location: { latitude: 45.76 }, pv_module: { peak_power: 1 }, meteo_data: { radiation_db: 'X' } }, outputs: { hourly } }));
    if ('error' in r) throw new Error(r.error);
    expect(r.roof.hours['01-01'][11]).toBe(800);
    expect(JSON.stringify(r)).not.toContain('45.76');
  });
  it('dit pourquoi un fichier n’en est pas un', () => {
    expect(parsePvgisFile('')).toEqual({ error: 'Fichier vide.' });
    expect('error' in parsePvgisFile('{')).toBe(true);
    expect(parsePvgisFile(csv(2).replace(/^Nominal.*$/m, ''))).toEqual({ error: 'Puissance crête (kWc) introuvable dans le fichier.' });
    expect('error' in parsePvgisFile(csv(1).split('\r\n').slice(0, 200).join('\n'))).toBe(true); // a few days only
  });
});

describe('#356 profil et heures', () => {
  it('toits pondérés par leur puissance', () => {
    const a = flatProfile(Array.from({ length: 24 }, (_, h) => (h === 12 ? 600 : 0)));
    const b = flatProfile(Array.from({ length: 24 }, (_, h) => (h === 12 ? 300 : 0)));
    const p = combinedProfile([
      { name: 'A', kwc: 3, hours: a },
      { name: 'B', kwc: 1, hours: b },
    ]);
    expect(p['03-01'][12]).toBeCloseTo(525); // (3 × 600 + 1 × 300) / 4
    expect(yearlyPerKwc(p)).toBeCloseTo(0.525 * 365);
  });
  it('heure UTC du profil → demi-heures locales (été : UTC+2, hiver : UTC+1)', () => {
    const p = flatProfile(Array.from({ length: 24 }, (_, h) => (h === 10 ? 400 : 0)));
    const summer = dayProduction(p, TZ, '2026-06-15');
    expect(summer[24]).toBe(200); // 12:00 local = 10:00 UTC
    expect(summer[25]).toBe(200);
    expect(summer[22]).toBe(0);
    const winter = dayProduction(p, TZ, '2026-01-15');
    expect(winter[22]).toBe(200); // 11:00 local = 10:00 UTC
    expect(winter[24]).toBe(0);
    expect(dayProduction(p, TZ, '2028-02-29')[22]).toBe(200); // leap day: 28 February
  });
});

describe('#356 simulation d’un jour', () => {
  const a = { ...prices };
  const base = { kwc: 1, pilotKw: 0, offPeak: nightSlot, a };

  it('autoconsommation et surplus à la demi-heure', () => {
    const wh = new Array(48).fill(500);
    const prod = zeros();
    prod[24] = 3000;
    const r = simulate({ days: [day(wh, prod)] }, { ...base, scenario: { pilot: false, battery: 0 } });
    expect(r.production).toBeCloseTo(3);
    expect(r.selfConsumed).toBeCloseTo(0.5);
    expect(r.surplus).toBeCloseTo(2.5);
    expect(r.boughtBefore).toBeCloseTo(24);
    expect(r.bought).toBeCloseTo(23.5);
    // 0.5 kWh not bought at the peak price + 2.5 kWh sold
    expect(r.saving).toBeCloseTo(0.5 * 0.25 + 2.5 * 0.04);
    expect(r.cost).toBe(2000);
  });

  it('pilotage : le chauffe-eau quitte la nuit pour le soleil, dans la limite de sa puissance', () => {
    const wh = new Array(48).fill(100);
    for (let i = 0; i < 6; i++) wh[i] = 600; // 00:00–03:00: the water heater, 3 kWh at night
    const prod = zeros();
    prod[24] = prod[25] = 2000;
    const r = simulate({ days: [day(wh, prod, 3000)] }, { ...base, pilotKw: 2, scenario: { pilot: true, battery: 0 } });
    // 2 kW → 1 kWh per half hour at most, on the two sunny half hours
    expect(r.moved).toBeCloseTo(2);
    expect(r.surplus).toBeCloseTo(4 - 0.2 - 2);
    expect(r.bought).toBeCloseTo(r.boughtBefore - 0.2 - 2);
    // the moved kWh were bought off-peak: they are saved at the off-peak price
    const without = simulate({ days: [day(wh, prod, 3000)] }, { ...base, pilotKw: 2, scenario: { pilot: false, battery: 0 } });
    expect(r.saving - without.saving).toBeCloseTo(2 * 0.2 - 2 * 0.04);
  });

  it('pilotage : jamais plus que ce que la nuit a vraiment tiré', () => {
    const wh = new Array(48).fill(0);
    wh[2] = 300;
    const prod = zeros();
    prod[24] = 5000;
    const r = simulate({ days: [day(wh, prod, 3000)] }, { ...base, pilotKw: 10, scenario: { pilot: true, battery: 0 } });
    expect(r.moved).toBeCloseTo(0.3);
    expect(r.bought).toBeCloseTo(0);
  });

  it('batterie : le surplus de midi rendu le soir, rendement appliqué', () => {
    const wh = zeros();
    wh[40] = 3000; // 20:00
    const prod = zeros();
    prod[24] = 2000;
    const r = simulate({ days: [day(wh, prod)] }, { ...base, scenario: { pilot: false, battery: 5 } });
    expect(r.fromBattery).toBeCloseTo(1.8); // 2 kWh stored at 90 %
    expect(r.surplus).toBeCloseTo(0);
    expect(r.bought).toBeCloseTo(1.2);
    expect(r.cost).toBe(2000 + 5 * 500);
    const small = simulate({ days: [day(wh, prod)] }, { ...base, scenario: { pilot: false, battery: 1 } });
    expect(small.fromBattery).toBeCloseTo(1); // full at 1 kWh
    expect(small.surplus).toBeCloseTo(2 - 1 / 0.9);
  });

  it('la batterie garde sa charge d’un jour au suivant', () => {
    const d1 = day(zeros(), zeros());
    d1.prod[24] = 1000;
    const d2 = day(zeros(), zeros());
    d2.wh[2] = 2000;
    const r = simulate({ days: [d1, d2] }, { ...base, a: { ...a, batteryEfficiency: 1 }, scenario: { pilot: false, battery: 5 } });
    expect(r.fromBattery).toBeCloseTo(1);
  });
});

describe('#356 fenêtre de simulation', () => {
  const p = flatProfile(Array.from({ length: 24 }, (_, h) => (h === 11 ? 500 : 0)));
  it('365 jours au plus ; courbe quand elle est entière, total Linky réparti sinon', () => {
    const curve = new Map<string, number>();
    for (let i = 0; i < 48; i++) curve.set(`2026-11-09T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, i === 40 ? 1000 : 100);
    curve.set('2026-11-08T00:00', 50); // incomplete day: ignored as curve
    // a whole curve day older than the window: left out
    for (let i = 0; i < 48; i++) curve.set(`2025-11-01T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, 999);
    const daily = new Map([
      ['2026-11-08', 10],
      ['2025-11-10', 5], // 364 days before the last: the first day of the 365
      ['2025-11-09', 5], // 365 days before: outside
    ]);
    const w = simWindow(curve, daily, TZ, p, (d) => (d === '2026-11-09' ? 1234 : 0))!;
    expect(w.from).toBe('2025-11-10');
    expect(w.to).toBe('2026-11-09');
    expect(w.days.map((d) => d.day)).toEqual(['2025-11-10', '2026-11-08', '2026-11-09']);
    expect(w.curveDays).toBe(1);
    expect(w.rebuiltDays).toBe(2);
    const rebuilt = w.days[1];
    expect(rebuilt.rebuilt).toBe(true);
    expect(rebuilt.wh.reduce((s, x) => s + x, 0)).toBeCloseTo(10000);
    expect(rebuilt.wh[40] / rebuilt.wh[0]).toBeCloseTo(10); // the shape of the curve day
    expect(w.days[2].shiftable).toBe(1234);
    expect(w.days[2].prod[24]).toBe(250); // 12:00 local in winter = 11:00 UTC
  });
  it('sans aucune journée de courbe entière : rien à simuler', () => {
    expect(simWindow(new Map(), new Map([['2026-01-01', 10]]), TZ, p, () => 0)).toBeNull();
  });
});

describe('#356 tableau complet et hypothèses', () => {
  const w = {
    days: [day(new Array(48).fill(200), Object.assign(zeros(), { 24: 1000, 25: 1000 }), 0)],
    from: '2026-06-15',
    to: '2026-06-15',
    curveDays: 1,
    rebuiltDays: 0,
  };
  it('les hypothèses non saisies laissent les scénarios qui en dépendent vides, et le dit', () => {
    const rows = runAll(w, { ...NO_INPUTS }, nightSlot);
    expect(rows.map((r) => r.kwc)).toEqual([3, 4.5, 6]);
    const [sans, pilote, b5] = rows[0].rows;
    expect(sans.year!.production).toBeCloseTo(6 * 365); // 2 kWh × 3 kWc, scaled to a year
    expect(sans.saving).toBeNull();
    expect(pilote.year).toBeNull();
    expect(pilote.missing).toContain('un usage à piloter (chauffe-eau ou recharge)');
    expect(b5.missing).toContain('rendement de la batterie');
  });
  it('avec toutes les hypothèses : économie annuelle et retour', () => {
    const i: SolarInputs = { ...NO_INPUTS, priceHp: 0.25, priceHc: 0.2, feedIn: 0.04, costPerKwc: 2000, batteryCostPerKwh: 500, batteryEfficiency: 90, heaterKw: 2, evKwhWeek: 7, evKw: 3 };
    const rows = runAll(w, i, nightSlot);
    for (const s of rows) {
      expect(s.rows).toHaveLength(SCENARIOS.length);
      for (const r of s.rows) expect(r.year).not.toBeNull();
      expect(s.rows[0].payback).toBeCloseTo((s.kwc * 2000) / s.rows[0].saving!);
    }
    // the car (1 kWh a day, in the curve at night) is moved to the sun with piloting
    expect(rows[0].rows[1].year!.moved).toBeGreaterThan(0);
    expect(rows[0].rows[0].year!.moved).toBe(0);
  });
  it('relecture : bornes et clés inconnues', () => {
    expect(parseSolarInputs({ priceHp: 0.2, priceHc: -1, feedIn: '0.1', batteryEfficiency: 101, toString: 3 })).toEqual({ ...NO_INPUTS, priceHp: 0.2 });
    expect(parseSolarInputs(null)).toEqual(NO_INPUTS);
  });
});

describe('#356 document solaire déchiffré', () => {
  const hours = flatProfile(new Array(24).fill(0));
  it('accepte le document de la collecte, refuse un toit sans profil', () => {
    const doc = parseSolarDoc({ source: 'pvgis', year: 2023, database: 'PVGIS-SARAH3', fetched: '2026-11-10', location: fixture.valid[0].in, roofs: [{ name: 'A', kwc: 3, hours }] });
    expect(doc?.roofs[0].kwc).toBe(3);
    expect(doc?.location?.lat).toBe(45.12);
    expect(parseSolarDoc({ source: 'pvgis', roofs: [{ name: 'A', kwc: 3, hours: {} }] })).toBeNull();
    expect(parseSolarDoc({ source: 'autre', roofs: [{ name: 'A', kwc: 3, hours }] })).toBeNull();
  });
});
