// #202: the plan of the house (floorplan.ts), read back from what was sealed or copied by the collection.
import { describe, expect, it } from 'vitest';
import { GRID, MAX_DEVICES, MAX_NAME, MAX_ROOMS, cleanName, emptyPlan, extent, fitName, freeId, heatClasses, overlaps, parsePlan, planJson, roomAt } from './floorplan';
import { SECRET_MAX_BYTES, sealedLength } from './settings';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };

const room = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id, name: `Pièce ${id}`, x, y, w, h, ...extra });

describe('#202 plan de la maison : lecture', () => {
  it('a new plan has the ground floor and the first floor, the cellar is not created', () => {
    expect(emptyPlan().levels.map((l) => l.id)).toEqual(['rdc', 'etage']);
  });

  it('keeps a valid plan as it is, levels from the bottom up', () => {
    const p = parsePlan({
      levels: [
        { id: 'etage', rooms: [room('p2', 0, 0, 4, 3)], devices: [] },
        { id: 'cave', rooms: [], devices: [{ id: 'a1', kind: 'station', ref: '03:00:00:00:00:02', x: 1, y: 1 }] },
        { id: 'rdc', rooms: [room('p1', 2, 2, 10, 8, { room: 'r-salon', module: '03:00:00:00:00:01' })], devices: [{ id: 'a2', kind: 'radiateur', ref: 'r-salon', x: 3, y: 2 }] },
      ],
    });
    expect(p!.levels.map((l) => l.id)).toEqual(['cave', 'rdc', 'etage']);
    expect(p!.levels[1].rooms[0]).toEqual({ id: 'p1', name: 'Pièce p1', x: 2, y: 2, w: 10, h: 8, room: 'r-salon', module: '03:00:00:00:00:01' });
    expect(p!.levels[1].devices[0]).toEqual({ id: 'a2', kind: 'radiateur', ref: 'r-salon', x: 3, y: 2 });
  });

  it('nothing to read is no plan (null), never an empty one taken for the household’s', () => {
    for (const v of [null, undefined, 'x', [], {}, { levels: 'x' }, { levels: [] }, { levels: [{ id: 'grenier' }] }]) expect(parsePlan(v)).toBeNull();
  });

  it('drops what does not fit the grid, an unknown kind, an id seen twice, a level given twice', () => {
    const p = parsePlan({
      levels: [
        {
          id: 'rdc',
          rooms: [room('p1', 0, 0, 2, 2), room('p1', 4, 4, 2, 2), room('p3', GRID - 1, 0, 2, 1), room('p4', 0, 0, 0, 1), room('p5', 1.5, 0, 1, 1), room('P6', 0, 0, 1, 1), room('p7', -1, 0, 1, 1)],
          devices: [
            { id: 'a1', kind: 'four', ref: '', x: 0, y: 0 },
            { id: 'p1', kind: 'prise', ref: '', x: 0, y: 0 },
            { id: 'a3', kind: 'prise', ref: 'javascript:alert(1)', x: 0, y: 0 },
            { id: 'a4', kind: 'volet', ref: 'x', x: GRID, y: 0 },
          ],
        },
        { id: 'rdc', rooms: [room('p9', 0, 0, 1, 1)], devices: [] },
      ],
    });
    expect(p!.levels).toHaveLength(1);
    expect(p!.levels[0].rooms.map((r) => r.id)).toEqual(['p1']);
    // the bad ref is dropped, the device kept (it is placed, only not said what it is)
    expect(p!.levels[0].devices).toEqual([{ id: 'a3', kind: 'prise', ref: '', x: 0, y: 0 }]);
  });

  it('a key of the prototype is never read as a field (Object.hasOwn, A9)', () => {
    const inherited = Object.create({ id: 'p1', x: 0, y: 0, w: 1, h: 1 }) as object;
    expect(parsePlan({ levels: [{ id: 'rdc', rooms: [inherited], devices: [] }] })!.levels[0].rooms).toEqual([]);
    const level = JSON.parse('{"id":"rdc","rooms":[{"__proto__":{"id":"p1","x":0,"y":0,"w":1,"h":1}}],"devices":[]}');
    expect(parsePlan({ levels: [level] })!.levels[0].rooms).toEqual([]);
    const proto = JSON.parse('{"__proto__":{"levels":[{"id":"rdc"}]}}');
    expect(parsePlan(proto)).toBeNull();
  });

  it('a name is cleaned and cut, never an address in disguise of markup', () => {
    expect(cleanName('  Salon\n\tbas ')).toBe('Salon bas');
    expect(cleanName('x'.repeat(100))).toHaveLength(MAX_NAME);
    expect(cleanName('a\ud83d')).toBe('a');
    expect(cleanName('😀'.repeat(40))).toBe('😀'.repeat(MAX_NAME));
    expect(cleanName(42)).toBe('');
  });

  it('at most MAX_ROOMS rooms by level', () => {
    const rooms = Array.from({ length: MAX_ROOMS + 5 }, (_, i) => room(`p${i}`, 0, 0, 1, 1));
    expect(parsePlan({ levels: [{ id: 'rdc', rooms, devices: [] }] })!.levels[0].rooms).toHaveLength(MAX_ROOMS);
  });

  it('planJson is canonical: the same plan in another order of keys gives the same text, and it reads back to itself', () => {
    const a = { levels: [{ devices: [], rooms: [{ h: 2, w: 3, y: 1, x: 0, name: 'Salon', id: 'p1', room: 'r-salon' }], id: 'rdc' }] };
    const b = { levels: [{ id: 'rdc', rooms: [{ id: 'p1', name: 'Salon', x: 0, y: 1, w: 3, h: 2, room: 'r-salon' }], devices: [] }] };
    expect(planJson(a as never)).toBe(planJson(b as never));
    expect(planJson(parsePlan(JSON.parse(planJson(b as never)))!)).toBe(planJson(b as never));
  });
});

describe('#202 plan de la maison : géométrie', () => {
  const level = { id: 'rdc' as const, rooms: [room('p1', 0, 0, 4, 4), room('p2', 3, 3, 4, 4), room('p3', 10, 0, 2, 2)].map((r) => parsePlan({ levels: [{ id: 'rdc', rooms: [r] }] })!.levels[0].rooms[0]), devices: [] };

  it('roomAt: the room drawn last wins where two overlap; outside every room, none', () => {
    expect(roomAt(level, 0, 0)?.id).toBe('p1');
    expect(roomAt(level, 3, 3)?.id).toBe('p2');
    expect(roomAt(level, 4, 0)).toBeUndefined();
    expect(roomAt(level, 11, 1)?.id).toBe('p3');
    expect(roomAt(level, 12, 1)).toBeUndefined();
  });

  it('overlaps: the pairs that overlap, not those that only touch', () => {
    expect(overlaps(level).map(([a, b]) => `${a.id}/${b.id}`)).toEqual(['p1/p2']);
    const touching = { ...level, rooms: [level.rooms[0], { ...level.rooms[0], id: 'p9', x: 4 }] };
    expect(overlaps(touching)).toEqual([]);
  });

  it('extent: the box of what is drawn', () => {
    expect(extent(level)).toEqual({ w: 12, h: 7 });
    expect(extent({ id: 'rdc', rooms: [], devices: [] })).toEqual({ w: 0, h: 0 });
  });

  it('freeId: a number not used, rooms and devices alike', () => {
    const p = parsePlan({ levels: [{ id: 'rdc', rooms: [room('p1', 0, 0, 1, 1), room('p2', 0, 0, 1, 1)], devices: [{ id: 'a1', kind: 'prise', ref: '', x: 0, y: 0 }] }] })!;
    expect(freeId(p, 'p')).toBe('p3');
    expect(freeId(p, 'a')).toBe('a2');
  });
});

describe('#202 carte de chaleur : classes', () => {
  it('five equal steps from the lowest to the highest value; no value stays without class', () => {
    const { classes, bounds } = heatClasses([0, 10, 50, 100, null, 99.9, 20]);
    expect(classes).toEqual([1, 1, 3, 5, null, 5, 2]);
    expect(bounds.map((b) => b.cls)).toEqual([1, 2, 3, 4, 5]);
    expect(bounds[0].lo).toBe(0);
    expect(bounds[4].hi).toBe(100);
    expect(bounds[1]).toEqual({ cls: 2, lo: 20, hi: 40 });
  });

  it('the same value everywhere is one class, the middle one; nothing at all is no class', () => {
    expect(heatClasses([7, 7, null])).toEqual({ classes: [3, 3, null], bounds: [{ cls: 3, lo: 7, hi: 7 }] });
    expect(heatClasses([null, Number.NaN])).toEqual({ classes: [null, null], bounds: [] });
  });

  it('negative values (a temperature below zero) are placed too', () => {
    expect(heatClasses([-5, 5]).classes).toEqual([1, 5]);
  });
});

describe('#541 un nom coupé pour tenir dans sa pièce', () => {
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  it('a name that fits is kept whole; a cut one ends with « … »; a room too narrow writes nothing', () => {
    expect(fitName('Salon', 6, 0.9)).toBe('Salon');
    expect(fitName('Chambre parentale', 6, 0.9)).toBe('Chambre p…');
    expect(fitName('Salon', 1, 0.9)).toBe('');
  });

  it('never cuts inside an emoji, a pair of surrogates nor a sequence joined by ZWJ', () => {
    for (let w = 2; w <= 12; w++) {
      const one = fitName('🏠'.repeat(20), w, 0.9);
      expect(one).not.toMatch(lone);
      expect(one.replace('…', '')).toMatch(/^(🏠)*$/u);
      const cook = fitName('👩‍🍳'.repeat(10), w, 0.9);
      expect(cook.replace('…', '')).toMatch(/^(👩‍🍳)*$/u);
    }
  });

  it('an emoji counts as two characters (it is drawn wider than a letter)', () => {
    expect(fitName('🏠'.repeat(5), 6, 0.9)).toBe('🏠'.repeat(5));
    expect(fitName('🏠'.repeat(6), 6, 0.9)).toBe('🏠🏠🏠🏠…');
    expect(fitName('aaaaaaaaaaaa', 6, 0.9)).toBe('aaaaaaaaa…');
  });
});

describe('#541 taille d’un plan à ses bornes', () => {
  /** 3 levels × MAX_ROOMS rooms × MAX_DEVICES devices, ids and refs at their longest, names of MAX_NAME emojis. */
  const biggest = () => {
    const ref = (c: string) => c.repeat(40);
    const id = (p: string, i: number) => `${p}${String(i).padStart(11, '0')}`;
    let n = 0;
    return {
      levels: (['cave', 'rdc', 'etage'] as const).map((lv) => ({
        id: lv,
        rooms: Array.from({ length: MAX_ROOMS }, () => ({ id: id('p', n++), name: '🏠'.repeat(MAX_NAME), x: 10, y: 10, w: 38, h: 38, room: ref('r'), module: ref('m') })),
        devices: Array.from({ length: MAX_DEVICES }, () => ({ id: id('a', n++), kind: 'chauffe-eau', ref: ref('d'), x: 47, y: 47 })),
      })),
    };
  };
  it('is the figure written in collector/floorplan.py, and too big for a secret once sealed', () => {
    const json = planJson(parsePlan(biggest())!);
    const bytes = new TextEncoder().encode(json).length;
    const py = readFileSync(new URL('../../collector/floorplan.py', import.meta.url), 'utf8');
    expect(py).toContain(`${bytes.toLocaleString('fr-FR').replace(/\s/g, ' ')} octets`);
    expect(bytes).toBeLessThan(48 * 1024);
    expect(sealedLength(json)).toBeGreaterThan(SECRET_MAX_BYTES);
  });
});
