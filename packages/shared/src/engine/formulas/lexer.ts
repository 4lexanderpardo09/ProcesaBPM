import { Decimal, DecimalError } from '../money/fixed-decimal.js';
import { FORMULA_LIMITS, type FormulaIssue } from './types.js';

export type Token =
  | { readonly kind: 'number'; readonly value: Decimal; readonly position: number }
  | { readonly kind: 'text'; readonly value: string; readonly position: number }
  | { readonly kind: 'name'; readonly value: string; readonly position: number }
  | { readonly kind: 'symbol'; readonly value: string; readonly position: number }
  | { readonly kind: 'end'; readonly position: number };

const SYMBOLS = ['<=', '>=', '!=', '<>', '&&', '||', '+', '-', '*', '/', '%', '=', '<', '>', '(', ')', ',', '.', '!'];
const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;
const DIGIT = /\d/;

export type LexResult = { readonly ok: true; readonly tokens: readonly Token[] } | { readonly ok: false; readonly issue: FormulaIssue };

function readText(source: string, start: number): { value: string; next: number } | undefined {
  const quote = source[start]!;
  let value = '';
  for (let at = start + 1; at < source.length; at += 1) {
    const char = source[at]!;
    if (char === '\\' && at + 1 < source.length) {
      at += 1;
      value += source[at];
    } else if (char === quote) return { value, next: at + 1 };
    else value += char;
  }
  return undefined;
}

export function tokenize(source: string): LexResult {
  if (source.length > FORMULA_LIMITS.sourceLength) return { ok: false, issue: { code: 'TOO_LONG', position: FORMULA_LIMITS.sourceLength } };
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at]!;
    if (/\s/.test(char)) {
      at += 1;
    } else if (DIGIT.test(char)) {
      let end = at;
      while (end < source.length && DIGIT.test(source[end]!)) end += 1;
      if (source[end] === '.' && DIGIT.test(source[end + 1] ?? '')) {
        end += 1;
        while (end < source.length && DIGIT.test(source[end]!)) end += 1;
      }
      try {
        tokens.push({ kind: 'number', value: Decimal.parse(source.slice(at, end)), position: at });
      } catch (error) {
        if (error instanceof DecimalError) return { ok: false, issue: { code: 'SYNTAX', position: at, detail: error.reason } };
        throw error;
      }
      at = end;
    } else if (char === '"' || char === "'") {
      const text = readText(source, at);
      if (text === undefined) return { ok: false, issue: { code: 'SYNTAX', position: at, detail: 'UNCLOSED_TEXT' } };
      tokens.push({ kind: 'text', value: text.value, position: at });
      at = text.next;
    } else if (NAME_START.test(char)) {
      let end = at + 1;
      while (end < source.length && NAME_PART.test(source[end]!)) end += 1;
      tokens.push({ kind: 'name', value: source.slice(at, end), position: at });
      at = end;
    } else {
      const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, at));
      if (symbol === undefined) return { ok: false, issue: { code: 'SYNTAX', position: at, detail: `UNEXPECTED_CHARACTER` } };
      tokens.push({ kind: 'symbol', value: symbol === '<>' ? '!=' : symbol, position: at });
      at += symbol.length;
    }
  }
  tokens.push({ kind: 'end', position: source.length });
  return { ok: true, tokens };
}
