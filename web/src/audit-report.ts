// #532: the detailed data audit, computed by the collector (`diagnose --qualite --rapport`,
// collector/audit.py, workflow Diagnostic) and encrypted with the data key. The owner opens the file
// here (État des données): it is decrypted on this device with the key already held, checked field
// by field (a file from outside is an untrusted input: fuzz.test.ts), and kept sealed on the device.
// The checks, their explanations and the thresholds come with the report: no list of them here
// (AGENTS.md §5). Pure apart from the decryption: no DOM.
import { BadEnvelope, type Envelope, WrongPassphrase, decryptEnvelope } from './crypto';

export const AUDIT_FILE = 'audit-donnees.enc.json';
export const AUDIT_ARTIFACT = 'audit-donnees';
const KIND = 'audit-donnees';
const VERSION = 1;
const MAX_TEXT = 600;
const MAX_FINDINGS = 10_000;
const MAX_CHECKS = 100;

export type AuditLevel = 'defaut' | 'a-verifier';

export interface AuditCheck {
  code: string;
  group: string;
  title: string;
  what: string;
  app: string;
  level: AuditLevel;
  count: number;
  /** « YYYY-MM » (or « ? » for an undated case) -> cases. */
  months: Record<string, number>;
  /** Cases detailed in `findings` (the rest are counted only). */
  shown: number;
}

export interface AuditThreshold {
  name: string;
  value: number;
  unit: string;
  why: string;
  hypothesis: boolean;
}

export interface AuditFinding {
  code: string;
  doc: string;
  series: string;
  day?: string;
  at?: string;
  room?: string;
  value?: number;
  other?: number;
  text: string;
}

export interface AuditReport {
  made: string;
  last: string | null;
  timezone: string;
  checks: AuditCheck[];
  thresholds: AuditThreshold[];
  findings: AuditFinding[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s: unknown): s is string => typeof s === 'string' && DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const text = (v: unknown, max = MAX_TEXT): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

class Invalid extends Error {}
function need<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Invalid(what);
  return v;
}

function check(raw: unknown): AuditCheck {
  const o = need(obj(raw), 'contrôle');
  const level = own(o, 'level');
  const months: Record<string, number> = {};
  const m = need(obj(own(o, 'months')), 'mois');
  for (const k of Object.keys(m)) {
    const n = num(m[k]);
    if ((/^\d{4}-\d{2}$/.test(k) || k === '?') && n !== null && n >= 0) months[k] = n;
  }
  const count = need(num(own(o, 'count')), 'nombre');
  const shown = need(num(own(o, 'shown')), 'nombre');
  if (count < 0 || shown < 0) throw new Invalid('nombre');
  return {
    code: need(text(own(o, 'code'), 60), 'code'),
    group: need(text(own(o, 'group'), 60), 'groupe'),
    title: need(text(own(o, 'title')), 'titre'),
    what: need(text(own(o, 'what')), 'explication'),
    app: need(text(own(o, 'app')), 'traitement'),
    level: level === 'a-verifier' ? 'a-verifier' : 'defaut',
    count,
    months,
    shown,
  };
}

function threshold(raw: unknown): AuditThreshold {
  const o = need(obj(raw), 'seuil');
  return {
    name: need(text(own(o, 'name'), 60), 'seuil'),
    value: need(num(own(o, 'value')), 'seuil'),
    unit: need(text(own(o, 'unit'), 20), 'seuil'),
    why: need(text(own(o, 'why')), 'seuil'),
    hypothesis: own(o, 'hypothesis') === true,
  };
}

function finding(raw: unknown, codes: Set<string>): AuditFinding | null {
  const o = obj(raw);
  if (!o) return null;
  const code = text(own(o, 'code'), 60);
  const t = text(own(o, 'text'));
  if (!code || !codes.has(code) || t === null) return null;
  const f: AuditFinding = { code, doc: text(own(o, 'doc'), 60) ?? '', series: text(own(o, 'series'), 120) ?? '', text: t };
  const day = own(o, 'day');
  if (realDay(day)) f.day = day;
  const at = text(own(o, 'at'), 60);
  if (at) f.at = at;
  const room = text(own(o, 'room'), 80);
  if (room) f.room = room;
  const value = num(own(o, 'value'));
  if (value !== null) f.value = value;
  const other = num(own(o, 'other'));
  if (other !== null) f.other = other;
  return f;
}

/** The decrypted report, checked; throws an Error with a French message when it is not one. */
export function parseAuditReport(raw: unknown): AuditReport {
  const o = obj(raw);
  if (!o || own(o, 'kind') !== KIND) throw new Error('Ce fichier n’est pas un rapport d’audit des données.');
  if (own(o, 'v') !== VERSION) throw new Error(`Rapport d’audit de version inconnue (${String(own(o, 'v'))}) : mettez l’application à jour.`);
  try {
    const checks = own(o, 'checks');
    const thresholds = own(o, 'thresholds');
    const findings = own(o, 'findings');
    if (!Array.isArray(checks) || checks.length > MAX_CHECKS || !Array.isArray(thresholds) || thresholds.length > MAX_CHECKS || !Array.isArray(findings))
      throw new Invalid('listes');
    const made = own(o, 'made');
    const last = own(o, 'last');
    const parsed = checks.map(check);
    const codes = new Set(parsed.map((c) => c.code));
    return {
      made: need(realDay(made) ? made : null, 'date'),
      last: realDay(last) ? last : null,
      timezone: text(own(o, 'timezone'), 60) ?? 'Europe/Paris',
      checks: parsed,
      thresholds: thresholds.map(threshold),
      findings: findings.slice(0, MAX_FINDINGS).flatMap((f) => finding(f, codes) ?? []),
    };
  } catch (err) {
    if (err instanceof Invalid) throw new Error(`Rapport d’audit illisible (${err.message}).`);
    throw err;
  }
}

/** A file picked by the owner -> the report, or a French message saying what to do. */
export async function openAuditFile(content: string, key: CryptoKey): Promise<{ report: AuditReport } | { error: string }> {
  if (content.startsWith('PK')) return { error: `C’est l’archive .zip téléchargée depuis GitHub : décompressez-la, puis ouvrez le fichier ${AUDIT_FILE} qu’elle contient.` };
  let env: unknown;
  try {
    env = JSON.parse(content);
  } catch {
    return { error: `Ce fichier n’est pas un rapport d’audit chiffré (${AUDIT_FILE}).` };
  }
  if (!obj(env) || typeof (env as Envelope).ct !== 'string' || typeof (env as Envelope).iv !== 'string')
    return { error: `Ce fichier n’est pas un rapport d’audit chiffré (${AUDIT_FILE}).` };
  let plain: unknown;
  try {
    plain = await decryptEnvelope<unknown>(env as Envelope, key);
  } catch (err) {
    if (err instanceof WrongPassphrase) return { error: 'Ce rapport ne s’ouvre pas avec la clé de ces données : il vient d’un autre dépôt, ou d’avant un changement de phrase de passe.' };
    if (err instanceof BadEnvelope) return { error: err.message };
    throw err;
  }
  try {
    return { report: parseAuditReport(plain) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface AuditSummary {
  defects: number;
  toCheck: number;
  /** Checks with nothing found. */
  clean: AuditCheck[];
  /** Checks with cases, defects first, then by number of cases. */
  found: AuditCheck[];
  hypotheses: number;
}

export function auditSummary(r: AuditReport): AuditSummary {
  const found = r.checks.filter((c) => c.count > 0).sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'defaut' ? -1 : 1));
  return {
    defects: found.filter((c) => c.level === 'defaut').reduce((a, c) => a + c.count, 0),
    toCheck: found.filter((c) => c.level === 'a-verifier').reduce((a, c) => a + c.count, 0),
    clean: r.checks.filter((c) => c.count === 0),
    found,
    hypotheses: r.thresholds.filter((t) => t.hypothesis).length,
  };
}

/** The cases of one check, by day. */
export const findingsOf = (r: AuditReport, code: string): AuditFinding[] =>
  r.findings.filter((f) => f.code === code).sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '') || (a.at ?? '').localeCompare(b.at ?? ''));
