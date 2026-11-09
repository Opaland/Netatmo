// Tiny, safe Markdown renderer for the AI analysis: headings, lists, bold, italics,
// paragraphs. Everything is escaped first; no links, images or raw HTML.

import { escapeHtml } from './charts';

const inline = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');

export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`), (para = []);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`), (list = []);
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) flush(), out.push(`<h${Math.min(4, h[1].length + 2)}>${inline(h[2])}</h${Math.min(4, h[1].length + 2)}>`);
    else if (li) {
      if (para.length) flush();
      list.push(li[1]);
    } else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join('');
}
