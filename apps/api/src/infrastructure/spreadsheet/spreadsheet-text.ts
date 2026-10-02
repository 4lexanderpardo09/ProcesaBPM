const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '＝', '＋', '－', '＠']);
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
/** The longest text a cell can hold. */
export const MAX_CELL_CHARACTERS = 32_767;
export const MAX_SHEET_NAME = 31;

/**
 * Text that is safe to put in a cell: a spreadsheet program evaluates what starts with `=`, `+`, `-` or `@` as a formula
 * (and may run it when the file is opened), so such text gets a leading apostrophe; characters XML cannot hold are removed.
 */
export function safeCellText(text: string): string {
  const cleaned = text.replace(XML_INVALID, '').slice(0, MAX_CELL_CHARACTERS);
  return cleaned !== '' && FORMULA_TRIGGERS.has(cleaned[0]!) ? `'${cleaned}` : cleaned;
}

/** Sheet names: at most 31 characters and none of `\ / ? * [ ] :`; a name is unique within the workbook. */
export function safeSheetName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = (name.replace(/[\\/?*[\]:]/g, ' ').replace(XML_INVALID, '').trim().replace(/^'+|'+$/g, '') || 'Sheet').slice(0, MAX_SHEET_NAME);
  let candidate = base;
  for (let counter = 2; taken.has(candidate.toLowerCase()); counter += 1) candidate = `${base.slice(0, MAX_SHEET_NAME - String(counter).length - 1)} ${counter}`;
  return candidate;
}
