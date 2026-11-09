// CSV cells shared by every CSV writer of the app (toCsv, toLongCsv, toResearchCsv).
//
// #235, formula injection: a text cell starting with = + - @, a tab or a carriage return is
// read as a formula by spreadsheets (Excel, LibreOffice, Google Sheets), e.g. a room named
// « =HYPERLINK("https://…") » in the Intuis app. Such a cell is prefixed with an apostrophe,
// which spreadsheets show as text. Only TEXT columns go through `textCell`: numbers (negative
// temperatures, kWh) are written as they are and stay numbers.

const FORMULA = /^[=+\-@\t\r]/;

/** A text cell neutralised against formulas, then quoted when it holds the separator, a quote or a line break. */
export function textCell(s: string, sep: ',' | ';'): string {
  const v = FORMULA.test(s) ? `'${s}` : s;
  return v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Reverse of the apostrophe of `textCell` (round trips of our own files). */
export const untextCell = (s: string): string => (s[0] === "'" && FORMULA.test(s.slice(1)) ? s.slice(1) : s);
