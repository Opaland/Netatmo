// #550, #597: the one measure of « no device mark is painted over a word of a room », shared by
// the plan as it is read (plan.mjs, the drawing laid down) and the editor while a mark or a room is
// held under the finger (plan-edition.mjs). What is painted at the centre of each letter of a
// name or a value is the word, never a mark. Runs in the page: `locator.evaluate(coveredLetters, scroll)`.
// `scroll`: bring each line to the middle of the screen first (never while a gesture is held: the
// finger would move on the drawing).
export function coveredLetters(svg, scroll = true) {
  const out = [];
  // the words take no pointer (.plan-overlay): elementFromPoint would see through them, not the eye
  const probe = Object.assign(document.createElement('style'), { textContent: '.plan-svg .plan-overlay, .plan-svg .plan-device { pointer-events: auto !important; }' });
  document.head.append(probe);
  for (const t of svg.querySelectorAll('g.plan-text text')) {
    if (!t.textContent.trim() || getComputedStyle(t).visibility === 'hidden') continue;
    if (scroll) t.scrollIntoView({ block: 'center' });
    const m = t.getScreenCTM();
    for (let i = 0; i < t.getNumberOfChars(); i++) {
      const e = t.getExtentOfChar(i);
      const p = new DOMPoint(e.x + e.width / 2, e.y + e.height / 2).matrixTransform(m);
      if (document.elementFromPoint(p.x, p.y)?.closest('g.plan-device')) {
        out.push(`« ${t.textContent} » (lettre ${i + 1})`);
        break;
      }
    }
  }
  probe.remove();
  return out;
}
