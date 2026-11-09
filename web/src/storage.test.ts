// S-7.9: a remembered key erased by the browser (Safari iOS) is explained, data intact.
import { describe, expect, it } from 'vitest';
import { askPersistence, isIos, keyLoss, lossMessage } from './storage';

const DAY = 86_400_000;
const now = Date.parse('2026-11-09T10:00:00Z');

describe('keyLoss', () => {
  it('reports an erased key while the 30 days run', () => {
    expect(keyLoss({ source: 'data', at: now - 3 * DAY }, false, now, 30)).toBe('evicted');
  });
  it('reports an expiry after 30 days', () => {
    expect(keyLoss({ source: 'data', at: now - 31 * DAY }, false, now, 30)).toBe('expired');
  });
  it('says nothing when the key is there or was never remembered', () => {
    expect(keyLoss({ source: 'data', at: now }, true, now, 30)).toBeNull();
    expect(keyLoss(null, false, now, 30)).toBeNull();
  });
});

describe('messages', () => {
  it('names iOS on an iPhone or an iPad, the browser elsewhere', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(isIos(iphone)).toBe(true);
    expect(isIos(ipad, 5)).toBe(true);
    expect(isIos(ipad, 0)).toBe(false);
    expect(lossMessage('evicted', true)).toMatch(/^iOS a effacé la clé, vos données sont intactes/);
    expect(lossMessage('evicted', false)).toMatch(/^Le navigateur a effacé la clé, vos données sont intactes/);
    expect(lossMessage('expired', true)).toMatch(/expiré/);
    expect(lossMessage(null, true)).toBe('');
  });
});

describe('askPersistence', () => {
  it('asks once, and copes with a missing API', async () => {
    let asked = 0;
    const nav = { storage: { persisted: async () => false, persist: async () => (asked++, true) } };
    expect(await askPersistence(nav)).toBe(true);
    expect(asked).toBe(1);
    expect(await askPersistence({ storage: { persisted: async () => true, persist: async () => (asked++, false) } })).toBe(true);
    expect(asked).toBe(1);
    expect(await askPersistence({})).toBeNull();
    expect(await askPersistence({ storage: { persist: async () => Promise.reject(new Error('x')) } })).toBeNull();
  });
});
