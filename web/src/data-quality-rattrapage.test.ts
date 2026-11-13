// #569: what is still recoverable, said once in État des données (« Récupérable ? »): before a
// catch-up, the safe gesture (case « rattrapage », never the full history that rewrites); after a
// catch-up that asked the days in vain, lost, with its day. Fictitious data only.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import { type QualityInput, askedInVain, catchUpOf, curveParts, fineSource, qualityReport } from './data-quality';

const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const rooms = [
  { id: 'a', name: 'Salon', category: 'heating' },
  { id: 'b', name: 'Chambre', category: 'heating' },
  { id: 'w', name: 'Chauffe-eau', category: 'water_heater' },
];
function recs(from: string, to: string, skip: Record<string, Set<string>> = {}): DayRecord[] {
  return span(from, to).flatMap((d) => rooms.filter((r) => !skip[r.id]?.has(d)).map((r) => ({ day: d, room: r.id, cat: r.category as DayRecord['cat'], kwh: 5 })));
}
const base = (records: DayRecord[], extra: Partial<QualityInput> = {}): QualityInput => ({ last: '2024-12-31', rooms, records, estimated: new Set(), ...extra });

const asked = {
  at: { heating: '2026-11-14', water: '2026-11-14', station: '2026-11-14' },
  months: { heating: { '2023-09': [140, 0], '2023-10': [65, 0] }, water: { '2024-05': [31, 0] }, station: { '2026-01': [3, 0] } },
};
const lost = new Set(span('2023-09-10', '2023-10-20'));
const heating = (catchUp: QualityInput['catchUp']) =>
  qualityReport(base(recs('2023-01-01', '2024-12-31', { a: lost, b: lost, w: lost }), { catchUp })).sources.find((s) => s.id === 'heating')!.gaps[0];

describe('#569 rattrapage : la raison dite une fois', () => {
  it('before a catch-up: probably lost at Intuis, and the safe gesture to be sure', () => {
    const g = heating(null);
    expect(g.recover).toMatch(/^Non chez Intuis d’après la récupération de l’historique.*pour en être sûr, cocher « rattrapage »/);
    expect(g.recover).not.toMatch(/Récupérer tout l’historique/); // that gesture rewrites present days
  });
  it('after a catch-up that asked these months in vain: lost, said with its day', () => {
    expect(heating(catchUpOf(asked)).recover).toMatch(/^Non : redemandé le 14 nov\. 2026 \(rattrapage\), Intuis n’a rien rendu : Intuis ne garde pas ces jours\./);
    // a month of the gap not asked, or a catch-up older than the gap: not said lost
    expect(heating(catchUpOf({ ...asked, months: { heating: { '2023-09': [140, 0] } } })).recover).toMatch(/^Non chez Intuis d’après/);
    expect(askedInVain(catchUpOf({ ...asked, at: { heating: '2023-10-01' } }), 'heating', '2023-09-10', '2023-10-20')).toBeNull();
    expect(askedInVain(catchUpOf({ ...asked, months: { heating: { '2023-09': [140, 0], '2023-10': [0, 0] } } }), 'heating', '2023-09-10', '2023-10-20')).toBeNull();
  });
  it('C2: a collection gap (« collecte arrêtée ») asked again in vain is said lost, not « Oui »', () => {
    // the station and Linky are silent too: the collection did not run those days
    const days = span('2023-01-01', '2024-12-31');
    const linky = new Map(days.filter((d) => !lost.has(d)).map((d): [string, number] => [d, 30]));
    const g = (catchUp: QualityInput['catchUp']) =>
      qualityReport(base(recs('2023-01-01', '2024-12-31', { a: lost, b: lost, w: lost }), { linky, catchUp })).sources.find((s) => s.id === 'heating')!.gaps[0];
    expect(g(null).cause).toMatch(/^collecte arrêtée/);
    expect(g(null).recover).toMatch(/^Oui : Intuis garde l’historique ; cocher « rattrapage »/);
    expect(g(catchUpOf(asked)).recover).toMatch(/^Non : redemandé le 14 nov\. 2026 \(rattrapage\), Intuis n’a rien rendu/);
  });
  it('the water heater missing alone, asked in vain: it did not send its readings', () => {
    const gone = new Set(span('2024-05-01', '2024-05-31'));
    const r = qualityReport(base(recs('2023-01-01', '2024-12-31', { w: gone }), { catchUp: catchUpOf(asked) }));
    expect(r.sources.find((s) => s.id === 'water')!.gaps[0].recover).toMatch(/Intuis n’a rien rendu : le chauffe-eau ne remontait pas ses relevés/);
  });
  it('the station: kept by Netatmo, until a catch-up asked in vain', () => {
    const days = span('2026-01-01', '2026-01-31');
    const row = [1, 2, 3, 50, 400];
    const daily = {
      m0: Object.fromEntries(days.map((d) => [d, row])),
      m2: Object.fromEntries(days.filter((d) => d < '2026-01-10' || d > '2026-01-12').map((d) => [d, row])),
    };
    const station = { modules: { m0: { name: 'Salon' }, m2: { name: 'Chambre' } }, daily };
    const gap = (catchUp: QualityInput['catchUp']) => qualityReport(base([], { last: '2026-01-31', station, catchUp })).sources.find((s) => s.id === 'station')!.gaps[0];
    expect(gap(null).recover).toMatch(/^Oui : Netatmo garde l’historique de la station ; cocher « rattrapage »/);
    expect(gap(catchUpOf(asked)).recover).toMatch(/^Non : redemandé le 14 nov\. 2026 \(rattrapage\), Netatmo n’a rien rendu : le module n’a rien envoyé/);
  });
  it('the Linky curve: 24 months at Enedis, said once in a note', () => {
    const curve = new Map<string, number>();
    for (const d of span('2025-11-09', '2026-11-12')) for (let i = 0; i < 48; i++) curve.set(`${d}T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, 100);
    const note = (c: QualityInput['catchUp'], m = curve) => fineSource('linky30', curveParts(m), null, [], undefined, c)!.notes.filter((n) => n.startsWith("Demi-heures depuis"));
    expect(note(null)).toEqual([
      'Demi-heures depuis le 9 nov. 2025. Les jours depuis le 13 nov. 2024 se rattrapent sans doute (cocher « rattrapage » en lançant Collecte quotidienne, Actions) ; avant, Enedis ne garde vraisemblablement plus la courbe de charge (24 mois d’après sa documentation, à confirmer).',
    ]);
    const months: Record<string, [number, number]> = {};
    for (const d of span('2024-11-13', '2025-11-08')) months[d.slice(0, 7)] = [30, 0];
    expect(note(catchUpOf({ at: { linky30: '2026-11-14' }, months: { linky30: months } }))[0]).toMatch(
      /^Demi-heures depuis le 9 nov\. 2025 : redemandées le 14 nov\. 2026 \(rattrapage\) depuis le 13 nov\. 2024, Enedis n’a rien rendu/,
    );
    // a curve that already goes back 24 months: nothing to say
    const full = new Map([...curve, ...span('2024-11-13', '2025-11-08').map((d): [string, number] => [`${d}T00:00`, 1])]);
    expect(note(null, full)).toEqual([]);
  });
  it('a gap of the curve older than 24 months is lost at Enedis', () => {
    const curve = new Map<string, number>();
    for (const d of span('2024-01-01', '2026-11-12')) if (d < '2024-02-01' || d > '2024-02-20') curve.set(`${d}T12:00`, 100);
    const g = fineSource('linky30', curveParts(curve), null)!.gaps.find((x) => x.from === '2024-02-01')!;
    expect(g.recover).toBe('Probablement non : Enedis ne garde vraisemblablement plus la courbe de charge (24 mois d’après sa documentation, à confirmer).');
  });
  it('reads meta.catch_up defensively', () => {
    expect(catchUpOf(null)).toBeNull();
    expect(catchUpOf({ at: { heating: 'x' }, months: { heating: {} } })).toBeNull();
    const proto = JSON.parse('{"at": {"__proto__": "2026-11-14", "heating": "2026-11-14"}, "months": {"heating": {"2023-09": [1, -1], "2023-10": [2, 0], "bad": [1, 1]}}}');
    expect(catchUpOf(proto)).toEqual({ at: { heating: '2026-11-14' }, months: { heating: { '2023-10': [2, 0] } } });
  });
});
