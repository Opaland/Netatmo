import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from './qr';

/** Rasterise the matrix (4 px per module, quiet zone) and decode it with jsQR. */
function decode(m: boolean[][]): string | null {
  const scale = 4;
  const q = 4;
  const n = (m.length + 2 * q) * scale;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++)
      if (m[y][x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + q) * scale + dy) * n + (x + q) * scale + dx) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
  return jsQR(data, n, n, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

describe('QR code (S-12.3)', () => {
  const cases = [
    'a',
    'https://opaland.github.io/Netatmo/#installer',
    'https://exemple.github.io/un-depot-au-nom-assez-long/#installer',
    'é'.repeat(40),
    'x'.repeat(120), // version 7+: version information blocks
    'y'.repeat(200), // version 10: 16-bit length
  ];
  for (const text of cases) {
    it(`encodes ${text.length} characters so that a reader decodes them`, () => {
      expect(decode(qrMatrix(text))).toBe(text);
    });
  }
  it('picks the smallest version', () => {
    expect(qrMatrix('a').length).toBe(21);
    expect(qrMatrix('https://opaland.github.io/Netatmo/#installer').length).toBe(33); // 44 bytes: version 4
  });
  it('refuses a text longer than version 10', () => {
    expect(() => qrMatrix('z'.repeat(214))).toThrow();
  });
  it('draws an SVG, dark on white, with an escaped label', () => {
    const svg = qrSvg('a', 'QR "x" <y>');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('aria-label="QR &#34;x&#34; &#60;y&#62;"');
    expect(svg).not.toContain('<y>');
  });
});
