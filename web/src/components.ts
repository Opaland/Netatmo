// #310: shared components of the design system (docs/design/composants.md, demo: composants.html).
// Each one is an HTML template: it returns a string where every value is escaped, to be placed
// in a view template that goes through `html` (trusted.ts, the only HTML sink). Styles in
// style.css (« components » section), colours and sizes from styles/tokens.css only.
import { escapeHtml as esc } from './charts';
import { hour as hourLabel, signedPct } from './glossary';

type Attrs = Record<string, string | number | boolean | null | undefined>;
/** ` data-x="1" aria-label="…"` from a map (null / undefined / false left out). */
export function attrs(a: Attrs = {}): string {
  return Object.entries(a)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(String(v))}"`))
    .join('');
}
const pctW = (v: number) => `${Math.max(0, Math.min(100, Math.round(v * 10) / 10))}%`;
/** Colour for a style attribute: a token name (« --usage-heating ») or a computed colour. */
const color = (c: string) => esc(c.startsWith('--') ? `var(${c})` : c);

// ------------------------------------------------------------------ card
export interface CardOpts {
  title: string;
  /** Period and source, in grey under the title (« 12 derniers mois · compteur Linky »). */
  sub?: string;
  /** Small label on the right (« Simulation », « rédigée par l'IA »). */
  tag?: string;
  /** sim: dashed border; off: to turn on (greyed). */
  variant?: 'sim' | 'off';
  id?: string;
  /** Already-safe HTML of the content. */
  body: string;
  /** « Comment c'est calculé » (already-safe HTML). */
  how?: string;
}
export function card(o: CardOpts): string {
  const hid = o.id ? `${o.id}-title` : undefined;
  return `<section class="card${o.variant ? ` ${o.variant}` : ''}"${attrs({ id: o.id, 'aria-labelledby': hid })}>
  <div class="card-head"><h2${attrs({ id: hid })}>${esc(o.title)}</h2>${o.tag ? `<span class="tag">${esc(o.tag)}</span>` : ''}</div>
  ${o.sub ? `<p class="card-sub">${esc(o.sub)}</p>` : ''}${o.body}${o.how ? howDetails('Comment c’est calculé', o.how) : ''}
</section>`;
}
/** One of the two fold labels of the app: « Comment c'est calculé », « Voir les valeurs ». */
export const howDetails = (label: string, body: string) => `<details class="table-details"><summary>${esc(label)}</summary>${body}</details>`;

// ------------------------------------------------------------------ comparison and tile
/**
 * Change with its reference written out: « ▼ −16 % vs nov. 2025 au 8 ». `p` in %, null when
 * there is nothing to compare with. `goodWhenDown`: false for a measure where up is not bad.
 */
export function comparison(p: number | null, vs: string, opts: { none?: string; neutral?: boolean } = {}): string {
  if (p === null) return `<span class="delta neutral">${esc(opts.none ?? "pas de comparaison avec l'an dernier")}</span>`;
  const r = Math.round(p);
  const cls = opts.neutral || r === 0 ? 'neutral' : r > 0 ? 'up' : 'down';
  const arrow = r === 0 ? '=' : r > 0 ? '▲' : '▼';
  return `<span class="delta ${cls}"><span aria-hidden="true">${arrow}</span> <b>${signedPct(p)}</b> <span class="vs">${esc(vs)}</span></span>`;
}
export interface TileOpts {
  label: string;
  value: string;
  /** comparison() output or other safe HTML, under the value. */
  sub?: string;
  cls?: string;
  id?: string;
}
/** KPI tile: label, key figure, one explicit comparison. */
export function tile(o: TileOpts): string {
  return `<article class="kpi${o.cls ? ` ${o.cls}` : ''}"${attrs({ id: o.id })}>
  <h3>${esc(o.label)}</h3>
  <p class="kpi-value">${esc(o.value)}</p>
  ${o.sub ? `<p class="kpi-sub">${o.sub}</p>` : ''}
</article>`;
}

// ------------------------------------------------------------------ gauge and share bar
export interface GaugeOpts {
  /** Accessible sentence (role=img). */
  label: string;
  value: number;
  max: number;
  /** Marker: what was expected at this date. */
  expected?: number | null;
  /** Hatched projection up to the end of the period. */
  projected?: number | null;
  /** Token or colour of the fill (default: --series-measure, #409: the accent is for actions). */
  color?: string;
  /** Texts under the track, left to right. */
  scale?: string[];
}
export function gauge(o: GaugeOpts): string {
  const w = (v: number) => pctW(o.max > 0 ? (v / o.max) * 100 : 0);
  return `<div class="gauge" role="img"${attrs({ 'aria-label': o.label })}${o.color ? ` style="--gauge-color:${color(o.color)}"` : ''}>
  <div class="track">${o.projected ? `<span class="proj" style="width:${w(o.projected)}"></span>` : ''}<span class="fill" style="width:${w(o.value)}"></span>${
    o.expected ? `<span class="mark" style="left:${w(o.expected)}"></span>` : ''
  }</div>
  ${o.scale?.length ? `<div class="scale" aria-hidden="true">${o.scale.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
</div>`;
}
/** Thin bar: share of one line in the total (decorative: the value is written next to it). */
export const shareBar = (pct: number, c: string) => `<span class="share-bar" aria-hidden="true"><i style="width:${pctW(pct)};background:${color(c)}"></i></span>`;

// ------------------------------------------------------------------ list
export interface RowOpts {
  title: string;
  sub?: string;
  value?: string;
  /** Colour key on the left. */
  color?: string;
  /** Share of the total under the subtitle (0-100). */
  share?: number;
  href?: string;
  /** Attributes of a button row (data-*); without href nor attrs, a plain row. */
  attrs?: Attrs;
}
export function listRow(o: RowOpts): string {
  const tag = o.href ? 'a' : o.attrs ? 'button' : 'div';
  const a = o.href ? attrs({ href: o.href }) : o.attrs ? ` type="button"${attrs(o.attrs)}` : '';
  return `<li><${tag} class="row"${a}>${o.color ? `<span class="swatch" style="background:${color(o.color)}" aria-hidden="true"></span>` : '<span></span>'}<span><span class="t">${esc(o.title)}</span>${
    o.sub ? `<span class="s">${esc(o.sub)}</span>` : ''
  }${o.share !== undefined ? shareBar(o.share, o.color ?? '--series-measure') : ''}</span><span class="v">${esc(o.value ?? '')}</span>${
    tag === 'div' ? '<span></span>' : '<span class="chev" aria-hidden="true">›</span>'
  }</${tag}></li>`;
}
export const list = (rows: RowOpts[], label?: string) => `<ul class="list"${attrs({ 'aria-label': label })}>${rows.map(listRow).join('')}</ul>`;

// ------------------------------------------------------------------ controls
/** Segmented control (2-4 options, role=radiogroup); wraps instead of overflowing (#319). */
export function seg<T extends string>(name: string, value: T, options: [T, string][], label: string): string {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options
    .map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === value}" data-set="${esc(name)}" data-value="${esc(v)}">${esc(l)}</button>`)
    .join('')}</div>`;
}
/** One period selector per screen, with its scope line (« Novembre 2026, du 1er au 8 · … »). */
export const periodBar = (segHtml: string, scope: string) => `<div class="periodbar">${segHtml}<p class="scope" aria-live="polite">${esc(scope)}</p></div>`;
/** Toggle chip (multiple choice, aria-pressed). */
export function chip(label: string, pressed: boolean, a: Attrs = {}, swatch?: string): string {
  return `<button type="button" class="chip" aria-pressed="${pressed}"${attrs(a)}>${swatch ? `<span class="swatch" style="background:${color(swatch)}" aria-hidden="true"></span>` : ''}${esc(label)}</button>`;
}
/**
 * Switch: a checkbox with role="switch" (same change event as a checkbox). The only on / off
 * control of the app (#317: replaces the old `.toggle` and `.check` boxes). `sub`: grey detail
 * after the label; `swatch`: colour key before it (a room).
 */
export function switchField(label: string, checked: boolean, a: Attrs = {}, extra: { sub?: string; swatch?: string } = {}): string {
  const key = extra.swatch ? `<span class="swatch" style="background:${color(extra.swatch)}" aria-hidden="true"></span>` : '';
  const sub = extra.sub ? ` <small class="muted">${esc(extra.sub)}</small>` : '';
  return `<label class="switch"><span>${key}${esc(label)}${sub}</span><input type="checkbox" role="switch"${attrs(a)}${checked ? ' checked' : ''}></label>`;
}
/** One answer of a short list where only one applies (native radio: same change event). */
export function radioField(label: string, checked: boolean, a: Attrs = {}): string {
  return `<label class="radio"><input type="radio"${attrs(a)}${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
}
/** Message of a form, next to its button: empty until an action fills it (live region). */
export const formMsg = (text: string, a: Attrs = {}) => `<p class="form-msg"${attrs({ role: 'alert', ...a })}>${esc(text)}</p>`;

// ------------------------------------------------------------------ messages and states
const ICON = { info: 'i', warn: '!', bad: '!', good: '✓' } as const;
/** Alert (info, warn, bad, good): icon, short title, text, optional action (safe HTML). */
export function alert(kind: keyof typeof ICON, title: string, text = '', action = ''): string {
  const role = kind === 'bad' ? 'alert' : 'note';
  return `<div class="alert${kind === 'info' ? '' : ` ${kind}`}" role="${role}"><span class="ico" aria-hidden="true">${ICON[kind]}</span><div><p><b>${esc(title)}</b></p>${
    text ? `<p>${esc(text)}</p>` : ''
  }${action}</div></div>`;
}
/**
 * Alert whose content is already-safe HTML (a sentence with <strong>, a link, several
 * paragraphs): same look and roles as alert(); `a` adds an id or replaces the role (a message
 * that is a status, not an error). #317: replaces the old `.notice` and `.stale` blocks.
 */
export function alertHtml(kind: keyof typeof ICON, body: string, a: Attrs = {}): string {
  const content = /^\s*<(p|ul|ol|div|details)\b/.test(body) ? body : `<p>${body}</p>`;
  return `<div class="alert${kind === 'info' ? '' : ` ${kind}`}"${attrs({ role: kind === 'bad' ? 'alert' : 'note', ...a })}><span class="ico" aria-hidden="true">${ICON[kind]}</span><div>${content}</div></div>`;
}
const STATE_ICON = { empty: '○', loading: '…', error: '!', offline: '⌁' } as const;
/** Empty, loading, error or offline state of a card (same classes as the lazy cards, lazy.ts). */
export function stateBlock(kind: keyof typeof STATE_ICON, text: string, action = ''): string {
  return `<div class="state state-${kind}" role="${kind === 'error' ? 'alert' : 'status'}"${kind === 'loading' ? ' aria-busy="true"' : ''}><span class="ico" aria-hidden="true">${STATE_ICON[kind]}</span><p>${esc(text)}</p>${action}</div>`;
}

// ------------------------------------------------------------------ room
export interface NowOpts {
  /** Measured temperature, °C. */
  temp: number | null;
  /** Lines under it: [label, value] (« Consigne », « 19,0 °C »). */
  facts: [string, string][];
}
export function nowPanel(o: NowOpts): string {
  const t = o.temp === null ? '—' : o.temp.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `<div class="now"><p class="temp">${t}<small> °C</small></p><dl>${o.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
}
export interface Slot {
  from: number;
  to: number;
  kind: 'comfort' | 'eco';
}
/**
 * Schedule of the day on 24 h: comfort / eco slots over the hatched off-peak hours, a line at
 * the current hour. Hours as decimals (6.5 = 6 h 30). The text alternative lists the slots.
 */
export function scheduleBand(o: { slots: Slot[]; offPeak?: [number, number][]; now?: number; label: string }): string {
  const x = (h: number) => pctW((h / 24) * 100);
  const span = (a: number, b: number) => `left:${x(a)};width:${pctW(((b - a) / 24) * 100)}`;
  const parts = (ranges: [number, number][]) => ranges.flatMap(([a, b]) => (b > a ? [[a, b]] : [[a, 24], [0, b]]));
  return `<div class="sched" role="img"${attrs({ 'aria-label': o.label })}><div class="lane">${parts(o.offPeak ?? [])
    .map(([a, b]) => `<i class="hc" style="${span(a, b)}"></i>`)
    .join('')}${o.slots.map((s) => `<i class="${s.kind}" style="${span(s.from, s.to)}"></i>`).join('')}${
    o.now !== undefined ? `<i class="now-line" style="left:${x(o.now)}"></i>` : ''
  }</div><div class="hours" aria-hidden="true">${[0, 6, 12, 18, 24].map((h) => `<span>${hourLabel(h === 24 ? 0 : h)}</span>`).join('')}</div></div>`;
}

// ------------------------------------------------------------------ legend
export interface LegendItem {
  label: string;
  color: string;
  /** swatch (default), hatch: partial period, line: dashed reference. */
  kind?: 'swatch' | 'hatch' | 'line';
}
export function legend(items: LegendItem[]): string {
  return `<p class="legend">${items
    .map((i) => {
      const k = i.kind ?? 'swatch';
      const style = k === 'swatch' ? `background:${color(i.color)}` : `color:${color(i.color)}`;
      return `<span><i${k === 'swatch' ? '' : ` class="${k}"`} style="${style}" aria-hidden="true"></i>${esc(i.label)}</span>`;
    })
    .join('')}</p>`;
}
