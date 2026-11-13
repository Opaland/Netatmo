import { describe, expect, it } from 'vitest';
import { AUDIT_FILE, auditSummary, findingValues, findingsOf, openAuditFile, parseAuditReport } from './audit-report';
// written by tests/test_audit.py (collector/audit.py on a synthetic archive): one contract
import report from './__fixtures__/audit-report.json';

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function sealed(value: unknown, raw = new Uint8Array(32).fill(7)) {
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  return { key, text: JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: 600_000, salt: b64(new Uint8Array(16)), iv: b64(iv), ct: b64(ct) }) };
}

describe('#532 rapport d’audit écrit par le collecteur', () => {
  it('se lit tel que collector/audit.py l’écrit', () => {
    const r = parseAuditReport(report);
    expect(r.made).toBe('2024-05-01');
    expect(r.checks.map((c) => c.code)).toContain('deux-fichiers');
    const two = r.checks.find((c) => c.code === 'deux-fichiers')!;
    expect([two.count, two.months]).toEqual([1, { '2024-03': 1 }]);
    expect(findingsOf(r, 'deux-fichiers').map((f) => [f.day, f.room, f.value])).toEqual([['2024-03-05', '1234500100', 1234]]);
    expect(r.thresholds.some((t) => t.hypothesis)).toBe(true);
    expect(r.errors).toEqual([]);
    expect(parseAuditReport({ ...report, errors: ['clés : TypeError', 5] }).errors).toEqual(['clés : TypeError']);
  });

  it('#550 : dit chaque valeur avec son unité', () => {
    const two = findingsOf(parseAuditReport(report), 'deux-fichiers')[0];
    expect(findingValues(two)).toBe('Valeur lue : 1\u202f234 Wh ; comparée à : 4\u202f238,5 Wh.');
    expect(findingValues({ code: 'x', doc: '', series: '', text: '', value: 17.9, unit: '°C', other: 5, otherUnit: 'jours' })).toBe('Valeur lue : 17,9 °C ; 5 jours.');
    expect(findingValues({ code: 'x', doc: '', series: '', text: '', value: 0.92, other: 0.41 })).toBe('Valeur lue : 0,92 ; comparée à : 0,41.');
    expect(parseAuditReport({ ...report, findings: [{ code: 'deux-fichiers', text: 't', value: 1, unit: 'x'.repeat(40) }] }).findings[0].unit).toBeUndefined();
  });

  it('résume : impossibles d’abord, puis à vérifier, et ce qui n’a rien trouvé', () => {
    const s = auditSummary(parseAuditReport(report));
    expect(s.found.map((c) => c.level)).toEqual([...s.found.map((c) => c.level)].sort((a, b) => (a === b ? 0 : a === 'defaut' ? -1 : 1)));
    expect(s.found.map((c) => c.code).sort()).toEqual(['deux-fichiers', 'deux-sources', 'doublon-horodatage', 'heure-inexistante', 'mauvais-fichier']);
    expect(s.defects).toBe(4);
    expect(s.toCheck).toBe(1);
    expect(s.clean.length).toBe(s.found.length ? report.checks.length - s.found.length : report.checks.length);
  });

  it('refuse ce qui n’est pas un rapport, en disant pourquoi', () => {
    expect(() => parseAuditReport({ kind: 'autre' })).toThrow(/pas un rapport/);
    expect(() => parseAuditReport({ ...report, v: 2 })).toThrow(/version inconnue/);
    expect(() => parseAuditReport({ ...report, checks: 'x' })).toThrow(/illisible/);
    expect(() => parseAuditReport({ ...report, made: '2024-02-30' })).toThrow(/illisible/);
    // a finding of an unknown check, or without text, is dropped; an impossible day is not kept
    const r = parseAuditReport({ ...report, findings: [{ code: 'inconnu', text: 'x' }, { code: 'deux-fichiers' }, { code: 'deux-fichiers', text: 't', day: '2024-02-30' }] });
    expect(r.findings).toEqual([{ code: 'deux-fichiers', doc: '', series: '', text: 't' }]);
  });
});

describe('#532 ouvrir le fichier téléchargé', () => {
  it('déchiffre avec la clé des données et lit le rapport', async () => {
    const { key, text } = await sealed(report);
    const out = await openAuditFile(text, key);
    expect('report' in out && out.report.made).toBe('2024-05-01');
  });

  it('dit quoi faire : le zip, un autre fichier, une autre clé', async () => {
    const { key, text } = await sealed(report);
    expect(await openAuditFile('PK\u0003\u0004…', key)).toEqual({ error: expect.stringMatching(/décompressez-la/) });
    expect(await openAuditFile('{"a":1}', key)).toEqual({ error: expect.stringContaining(AUDIT_FILE) });
    expect(await openAuditFile('pas du json', key)).toEqual({ error: expect.stringContaining(AUDIT_FILE) });
    const other = await sealed(report, new Uint8Array(32).fill(9));
    expect(await openAuditFile(other.text, key)).toEqual({ error: expect.stringMatching(/ne s’ouvre pas avec la clé/) });
    const notAudit = await sealed({ daily: {} }, new Uint8Array(32).fill(7));
    expect(await openAuditFile(notAudit.text, key)).toEqual({ error: expect.stringMatching(/pas un rapport d’audit/) });
    const weak = JSON.parse(text);
    weak.iter = 1000;
    expect(await openAuditFile(JSON.stringify(weak), key)).toEqual({ error: expect.stringMatching(/trop faible/) });
  });
});
