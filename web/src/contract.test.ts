import { describe, expect, it } from 'vitest';
import { contractJson, resolveContract, sameContract, validContract } from './contract';

const shared = [
  { from: '2022-01-01', offer: 'edf-trv-hphc', kva: 12 },
  { from: '2025-10-14', offer: 'edf-trv-hphc', kva: 9 },
];
const local = [{ from: '2022-01-01', offer: 'edf-trv-hphc', kva: 9 }];

describe('shared contract (S-12.1)', () => {
  it('applies the shared contract on a device without one', () => {
    const r = resolveContract(shared, [], false, '2022-01-01', 9);
    expect(r).toMatchObject({ source: 'shared', differs: false, shared: true });
    expect(r.periods).toEqual(shared);
  });

  it('wins over a different local contract, and says so', () => {
    const r = resolveContract(shared, local, false, '2022-01-01', 9);
    expect(r.source).toBe('shared');
    expect(r.periods[0].kva).toBe(12);
    expect(r.differs).toBe(true);
  });

  it('a local edit made on purpose stays on this device, flagged as not shared', () => {
    const r = resolveContract(shared, local, true, '2022-01-01', 9);
    expect(r).toMatchObject({ source: 'local', differs: true, shared: true });
    expect(r.periods).toBe(local);
  });

  it('falls back to the local contract, then to a default', () => {
    expect(resolveContract(undefined, local, false, '2022-01-01', 9)).toMatchObject({ source: 'local', shared: false, differs: false });
    const d = resolveContract(null, [], false, '2021-03-01', 6);
    expect(d.source).toBe('default');
    expect(d.periods).toEqual([{ from: '2021-03-01', offer: 'edf-trv-hphc', kva: 6 }]);
  });

  it('ignores a malformed shared contract', () => {
    expect(validContract([{ from: '2022-01-01', offer: 'inconnue', kva: 9 }])).toBeNull();
    expect(validContract([{ from: '2022-01-01', offer: 'edf-trv-base', kva: 10 }])).toBeNull();
    expect(validContract({})).toBeNull();
    expect(resolveContract([{ from: 'x' }], local, false, '2022-01-01', 9).source).toBe('local');
  });

  it('writes sorted periods with only the three fields', () => {
    const messy = [{ ...shared[1], extra: 1 }, shared[0]] as typeof shared;
    expect(JSON.parse(contractJson(messy))).toEqual(shared);
    expect(sameContract(messy, shared)).toBe(true);
    expect(sameContract(local, shared)).toBe(false);
  });
});
