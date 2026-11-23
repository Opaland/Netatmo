// #680: docs/bmad/decisions.md is the single table of the owner's decisions. Each end-of-version
// review (docs/bmad/revues/vX.Y.md) poses its decisions in its § 10 table; the single table must
// hold every one of them exactly once, linked to the review that posed it, and nothing else
// (AGENTS.md §5: two lists of the same thing are kept in agreement by a test). A review that adds
// a decision without a row here, or a row removed or invented, turns this test red.
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const root = new URL('../../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');

const ID = String.raw`D\d+(?: bis| ter)?`;
const ROW = new RegExp(String.raw`^\| (${ID}) \|`, 'gm');

/** Decision ids of the « ## 10. » section of a review, in order (duplicates kept). */
function reviewDecisions(text: string): string[] {
  const start = text.search(/^## 10\. /m);
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const end = rest.search(/^## \d+\. /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(ROW)].map((m) => m[1]);
}

interface TableRow {
  id: string;
  cells: string[];
}

/** Every decision row of the single table (all sections), in order. */
function tableRows(text: string): TableRow[] {
  const rows: TableRow[] = [];
  for (const line of text.split('\n')) {
    const m = new RegExp(String.raw`^\| (${ID}) \|`).exec(line);
    if (!m) continue;
    rows.push({ id: m[1], cells: line.split(' | ').map((c) => c.replace(/^\| |\s*\|$/g, '').trim()) });
  }
  return rows;
}

const STATES = ['ouverte', 'en place, à confirmer', 'appliquée par #', 'remplacée par D', 'sans objet', 'tranchée le '] as const;
const stateOf = (cell: string) => STATES.find((s) => cell.startsWith(s));

/** Disagreements between the reviews' § 10 tables and the single table; empty when they agree. */
function disagreements(reviews: Record<string, string>, table: string): string[] {
  const out: string[] = [];
  const posed = new Map<string, string>();
  for (const [file, text] of Object.entries(reviews)) {
    for (const id of reviewDecisions(text)) {
      if (posed.has(id)) out.push(`${id} posée deux fois (${posed.get(id)}, ${file})`);
      posed.set(id, file);
    }
  }
  const seen = new Set<string>();
  for (const row of tableRows(table)) {
    if (seen.has(row.id)) out.push(`${row.id} a deux lignes dans decisions.md`);
    seen.add(row.id);
    const file = posed.get(row.id);
    if (!file) {
      out.push(`${row.id} est dans decisions.md mais dans aucun § 10 de revue`);
      continue;
    }
    if (!row.cells.some((c) => c.includes(`](revues/${file})`))) out.push(`${row.id} ne renvoie pas à sa revue, ${file}`);
    const state = row.cells.at(-1) ?? '';
    if (!stateOf(state)) out.push(`${row.id} : état inconnu « ${state.slice(0, 40)} »`);
    const replaced = /^remplacée par (D\d+)/.exec(state);
    if (replaced && !posed.has(replaced[1])) out.push(`${row.id} remplacée par ${replaced[1]}, qui n'existe pas`);
  }
  for (const id of posed.keys()) if (!seen.has(id)) out.push(`${id} (${posed.get(id)}) n'a pas de ligne dans decisions.md`);
  return out;
}

const reviewFiles = readdirSync(new URL('docs/bmad/revues/', root)).filter((f) => /^v\d+\.\d+\.md$/.test(f));
const reviews = Object.fromEntries(reviewFiles.map((f) => [f, read(`docs/bmad/revues/${f}`)]));
const table = read('docs/bmad/decisions.md');

describe('Un seul tableau des décisions (#680)', () => {
  it('chaque décision d\'un § 10 de revue y a une ligne, une seule, liée à sa revue, et rien d\'autre', () => {
    expect(reviewFiles.length).toBeGreaterThanOrEqual(12);
    expect(disagreements(reviews, table)).toEqual([]);
  });

  it('compte les décisions dites dans son en-tête, et son bilan par état', () => {
    const ids = Object.values(reviews).flatMap(reviewDecisions);
    const numbered = ids.filter((id) => /^D\d+$/.test(id));
    const max = Math.max(...numbered.map((id) => Number(id.slice(1))));
    expect(numbered.length).toBe(max); // D1 to Dmax, none missing
    expect(table).toContain(`**${max} numéros** (D1 à D${max})`);
    const counts = new Map<string, number>();
    for (const row of tableRows(table)) {
      const s = stateOf(row.cells.at(-1) ?? '') ?? '?';
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const bilan = /\*\*Bilan au relevé\*\* \((\d+) lignes[^)]*\) : ouvertes (\d+) ; en place,\s+à confirmer (\d+) ; appliquées (\d+) ; remplacées (\d+) ; sans objet (\d+) ; tranchées par le propriétaire (\d+)/.exec(table);
    expect(bilan, 'la ligne « Bilan au relevé »').not.toBeNull();
    const [, lines, open, inPlace, applied, replaced, moot, decided] = bilan!.map(Number);
    expect({ lines, open, inPlace, applied, replaced, moot, decided }).toEqual({
      lines: ids.length,
      open: counts.get('ouverte') ?? 0,
      inPlace: counts.get('en place, à confirmer') ?? 0,
      applied: counts.get('appliquée par #') ?? 0,
      replaced: counts.get('remplacée par D') ?? 0,
      moot: counts.get('sans objet') ?? 0,
      decided: counts.get('tranchée le ') ?? 0,
    });
  });

  it('l\'index par sujet nomme chaque décision une fois', () => {
    const index = table.slice(table.search(/^## 8\. /m));
    const listed = [...index.matchAll(/^\| \d\. [^|]+\| ([^|]+) \|$/gm)].flatMap((m) => m[1].split(', ').map((s) => s.trim()));
    expect([...listed].sort()).toEqual(tableRows(table).map((r) => r.id).sort());
  });

  it('dit la collision de noms avec les D1 à D6 de l\'audit UX', () => {
    expect(read('docs/design/audit-ux.md')).toMatch(/^\| D1 \|/m);
    expect(table).toMatch(/\[`docs\/design\/audit-ux\.md`\]\(\.\.\/design\/audit-ux\.md\)/);
  });

  it('l\'index, la feuille de route et PROJET.md y renvoient', () => {
    expect(read('docs/bmad/00-index.md')).toContain('](decisions.md)');
    expect(read('docs/bmad/feuille-de-route.md')).toContain('](decisions.md)');
    expect(read('docs/PROJET.md')).toContain('](bmad/decisions.md)');
  });
});

describe('disagreements, sur des cas écrits (#680)', () => {
  const review = (ids: string[]) => `# R\n\n## 10. Décisions du propriétaire\n\n| # | D |\n|---|---|\n${ids.map((i) => `| ${i} | x |`).join('\n')}\n\n## 11. Verdict\n\n| D9 | hors du § 10 |\n`;
  const row = (id: string, file = 'v1.0.md', state = 'ouverte') => `| ${id} | q | [v1.0](revues/${file}) · PR #1 | ${state} |`;

  it('accord : aucune différence, et une ligne hors du § 10 ne compte pas', () => {
    expect(disagreements({ 'v1.0.md': review(['D1', 'D2', 'D2 bis']) }, [row('D1'), row('D2'), row('D2 bis')].join('\n'))).toEqual([]);
  });

  it('voit une ligne retirée, une décision ajoutée à une revue, une ligne inventée, un doublon', () => {
    expect(disagreements({ 'v1.0.md': review(['D1', 'D2']) }, row('D1'))).toEqual(['D2 (v1.0.md) n\'a pas de ligne dans decisions.md']);
    expect(disagreements({ 'v1.0.md': review(['D1']) }, [row('D1'), row('D3')].join('\n'))).toEqual(['D3 est dans decisions.md mais dans aucun § 10 de revue']);
    expect(disagreements({ 'v1.0.md': review(['D1']) }, [row('D1'), row('D1')].join('\n'))).toEqual(['D1 a deux lignes dans decisions.md']);
  });

  it('voit une ligne liée à la mauvaise revue, un état inconnu, un remplacement vers rien', () => {
    expect(disagreements({ 'v1.0.md': review(['D1']) }, row('D1', 'v1.1.md'))).toEqual(['D1 ne renvoie pas à sa revue, v1.0.md']);
    expect(disagreements({ 'v1.0.md': review(['D1']) }, row('D1', 'v1.0.md', 'peut-être'))).toEqual(['D1 : état inconnu « peut-être »']);
    expect(disagreements({ 'v1.0.md': review(['D1']) }, row('D1', 'v1.0.md', 'remplacée par D7'))).toEqual(['D1 remplacée par D7, qui n\'existe pas']);
  });
});
