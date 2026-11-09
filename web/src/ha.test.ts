import { describe, expect, it } from 'vitest';
import { type HaDoc, agreement, guessRoom, lastHaDay, summarize } from './ha';
import type { RoomState } from './windows';

const doc: HaDoc = {
  sensors: {
    h1: { entity: 'sensor.prise_frigo_energy', name: 'Prise frigo', kind: 'energy', unit: 'kWh' },
    h0: { entity: 'binary_sensor.fenetre_bureau', name: 'Fenêtre bureau', kind: 'opening', unit: '' },
    h2: { entity: 'sensor.sonde_chambre', name: '', kind: 'temperature', unit: '°C' },
  },
  daily: {
    h0: { '2026-11-01': { on_h: 2, n: 1 }, '2026-11-02': { on_h: 0, n: 0 }, '2026-11-03': { on_h: 0.2, n: 3 } },
    h1: { '2026-11-01': { kwh: 1.2 }, '2026-11-02': { kwh: 1.1 }, '2026-10-01': { kwh: 9 } },
    h2: { '2026-11-01': { min: 17, max: 21, mean: 19 }, '2026-11-02': { min: 18, max: 22, mean: 20 } },
  },
};

describe('Home Assistant import in the app (S-1.18)', () => {
  it('summarises each sensor over a period, in import order', () => {
    const s = summarize(doc, '2026-11-01', '2026-11-30');
    expect(s.map((x) => x.key)).toEqual(['h0', 'h1', 'h2']);
    expect(s[0]).toMatchObject({ name: 'Fenêtre bureau', days: 3, onHours: 2.2, openings: 4, first: '2026-11-01', last: '2026-11-03' });
    expect(s[1].kwh).toBeCloseTo(2.3);
    expect(s[1].first).toBe('2026-10-01');
    expect(s[2]).toMatchObject({ name: 'sensor.sonde_chambre', mean: 19.5, min: 17, max: 22 });
    expect(lastHaDay(doc)).toBe('2026-11-03');
  });

  it('guesses the room from the sensor name or entity, longest name first', () => {
    const rooms = [
      { id: 'b', name: 'Bureau' },
      { id: 'c', name: 'Chambre' },
      { id: 'ce', name: 'Chambre enfant' },
    ];
    expect(guessRoom({ name: 'Fenêtre bureau' }, rooms)).toBe('b');
    expect(guessRoom({ entity: 'binary_sensor.fenetre_chambre_enfant' }, rooms)).toBe('ce');
    expect(guessRoom({ name: 'Porte garage' }, rooms)).toBeNull();
  });

  it('measures the daily agreement with open_window, on the days both sources cover', () => {
    const rs: RoomState = {
      rooms: {
        b: {
          '2026-11-01': { n: 24, open_window_h: 1.5 }, // both open
          '2026-11-02': { n: 24, open_window_h: 1 }, // radiator only
          '2026-11-03': { n: 24, open_window_h: 0 }, // both closed (sensor 0.2 h < 0.5 h)
          '2026-11-04': { n: 24, open_window_h: 0 }, // no HA that day: ignored
        },
      },
    };
    const a = agreement(doc.daily!.h0, rs, ['b']);
    expect(a).toMatchObject({ days: 3, bothOpen: 1, intuisOnly: 1, sensorOnly: 0, bothClosed: 1, sensorHours: 2.2, intuisHours: 2.5 });
    expect(a.rate).toBeCloseTo(2 / 3);
    expect(agreement(doc.daily!.h0, rs, ['autre']).rate).toBeNull();
  });
});
