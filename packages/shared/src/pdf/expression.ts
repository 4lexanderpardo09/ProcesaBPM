import { FIELD_CODE_PATTERN } from '../workflow/constants.js';
import { PDF_LIMITS } from './limits.js';

/**
 * The text language of PDF templates: plain text with `{{path|formatter:argument}}` placeholders. It is parsed by hand
 * and evaluated against a whitelist of paths: there is no `eval`, no property access on arbitrary objects, no code.
 */
export type Path =
  | { readonly kind: 'field'; readonly code: string }
  | { readonly kind: 'row'; readonly code: string }
  | { readonly kind: 'ticket'; readonly name: (typeof TICKET_PROPERTIES)[number] }
  | { readonly kind: 'step'; readonly stepName: string; readonly property: 'completedBy' | 'completedAt' }
  | { readonly kind: 'now' }
  | { readonly kind: 'page' }
  | { readonly kind: 'pages' };

export const TICKET_PROPERTIES = ['number', 'title', 'status', 'createdAt', 'closedAt', 'companyName', 'creatorName', 'currentStepName'] as const;
export const FORMATTERS = ['date', 'datetime', 'upper', 'lower', 'number', 'currency', 'default', 'yesno'] as const;
export type FormatterName = (typeof FORMATTERS)[number];
export const DATE_PATTERNS = ['dd/MM/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy HH:mm', 'dd MMM yyyy', 'MMMM yyyy'] as const;

export interface Formatter {
  readonly name: FormatterName;
  readonly argument: string | undefined;
}
export type Part = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'placeholder'; readonly path: Path; readonly formatters: readonly Formatter[]; readonly source: string };
export interface ParsedExpression {
  readonly parts: readonly Part[];
}
export interface ExpressionError {
  readonly position: number;
  readonly code: 'TOO_LONG' | 'TOO_MANY_PLACEHOLDERS' | 'UNCLOSED' | 'EMPTY' | 'UNKNOWN_PATH' | 'UNKNOWN_FORMATTER' | 'BAD_ARGUMENT';
  readonly message: string;
}
export type ParseResult = { readonly ok: true; readonly expression: ParsedExpression } | { readonly ok: false; readonly errors: readonly ExpressionError[] };

const STEP_NAME = /^[^.|{}]{1,100}$/;

function parsePath(text: string): Path | undefined {
  if (text === 'now' || text === 'page' || text === 'pages') return { kind: text };
  const [head, ...rest] = text.split('.');
  if ((head === 'field' || head === 'row') && rest.length === 1 && FIELD_CODE_PATTERN.test(rest[0]!)) return { kind: head, code: rest[0]! };
  if (head === 'ticket' && rest.length === 1 && (TICKET_PROPERTIES as readonly string[]).includes(rest[0]!)) return { kind: 'ticket', name: rest[0] as (typeof TICKET_PROPERTIES)[number] };
  if (head === 'step' && rest.length >= 2) {
    const property = rest[rest.length - 1];
    const stepName = rest.slice(0, -1).join('.').trim();
    if ((property === 'completedBy' || property === 'completedAt') && STEP_NAME.test(stepName)) return { kind: 'step', stepName, property };
  }
  return undefined;
}

function parseFormatter(text: string, position: number, errors: ExpressionError[]): Formatter | undefined {
  const colon = text.indexOf(':');
  const name = (colon === -1 ? text : text.slice(0, colon)).trim();
  const rawArgument = colon === -1 ? undefined : text.slice(colon + 1).trim();
  if (!(FORMATTERS as readonly string[]).includes(name)) {
    errors.push({ position, code: 'UNKNOWN_FORMATTER', message: `Unknown formatter ${name}` });
    return undefined;
  }
  const argument = rawArgument?.replace(/^'(.*)'$/s, '$1');
  const bad = (message: string) => (errors.push({ position, code: 'BAD_ARGUMENT', message }), undefined);
  if (name === 'date' && argument !== undefined && !(DATE_PATTERNS as readonly string[]).includes(argument)) return bad(`date takes one of ${DATE_PATTERNS.join(', ')}`);
  if (name === 'number' && argument !== undefined && !/^[0-6]$/.test(argument)) return bad('number takes 0 to 6 decimals');
  if (name === 'default' && (argument === undefined || argument.length > 100)) return bad('default needs a text of up to 100 characters');
  if (!['date', 'number', 'default'].includes(name) && argument !== undefined) return bad(`${name} takes no argument`);
  return { name: name as FormatterName, argument };
}

/** Parses an expression; every problem is reported with its position so the designer can point at it. */
export function parseExpression(text: string): ParseResult {
  const errors: ExpressionError[] = [];
  if (text.length > PDF_LIMITS.maxExpressionLength) return { ok: false, errors: [{ position: PDF_LIMITS.maxExpressionLength, code: 'TOO_LONG', message: 'The text is too long' }] };
  const parts: Part[] = [];
  let cursor = 0;
  let placeholders = 0;
  while (cursor < text.length) {
    const open = text.indexOf('{{', cursor);
    if (open === -1) {
      parts.push({ kind: 'text', text: text.slice(cursor) });
      break;
    }
    if (open > cursor) parts.push({ kind: 'text', text: text.slice(cursor, open) });
    const close = text.indexOf('}}', open + 2);
    if (close === -1) {
      errors.push({ position: open, code: 'UNCLOSED', message: 'A placeholder is not closed' });
      break;
    }
    const source = text.slice(open + 2, close);
    placeholders += 1;
    if (placeholders > PDF_LIMITS.maxPlaceholders) {
      errors.push({ position: open, code: 'TOO_MANY_PLACEHOLDERS', message: 'Too many placeholders' });
      break;
    }
    const [pathText = '', ...formatterTexts] = splitOutsideQuotes(source);
    if (pathText.trim() === '') errors.push({ position: open, code: 'EMPTY', message: 'Empty placeholder' });
    const path = parsePath(pathText.trim());
    if (path === undefined && pathText.trim() !== '') errors.push({ position: open, code: 'UNKNOWN_PATH', message: `Unknown path ${pathText.trim()}` });
    const formatters = formatterTexts.flatMap((formatterText) => parseFormatter(formatterText, open, errors) ?? []);
    if (path !== undefined) parts.push({ kind: 'placeholder', path, formatters, source: source.trim() });
    cursor = close + 2;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, expression: { parts } };
}

/** `a|b:'x|y'|c` → `a`, `b:'x|y'`, `c`: a pipe inside quotes belongs to the argument. */
function splitOutsideQuotes(source: string): string[] {
  const pieces: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of source) {
    if (character === "'") quoted = !quoted;
    if (character === '|' && !quoted) {
      pieces.push(current);
      current = '';
    } else current += character;
  }
  pieces.push(current);
  return pieces;
}

/** The paths an expression reads, to validate them against a workflow version. */
export function pathsOf(expression: ParsedExpression): Path[] {
  return expression.parts.flatMap((part) => (part.kind === 'placeholder' ? [part.path] : []));
}

/** What a path evaluates to before formatting. Dates are `Date`, decimals stay strings (exact), `null` means "no value". */
export type PdfValue = string | number | boolean | Date | null;

export interface EvaluationContext {
  /** `undefined` when the path cannot be resolved here (e.g. `row` outside a table). */
  readonly resolve: (path: Path) => PdfValue | undefined;
  readonly timeZone: string;
  readonly currencyCode: string;
  readonly now: Date;
}

export interface FormatOptions {
  readonly timeZone: string;
  readonly currencyCode: string;
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** A date in the company's time zone, in one of the allowed patterns. */
export function formatDate(date: Date, pattern: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const month = Number(parts.month);
  return pattern
    .replace('yyyy', parts.year!)
    .replace('MMMM', MONTHS_LONG[month - 1]!)
    .replace('MMM', MONTHS_SHORT[month - 1]!)
    .replace('MM', parts.month!)
    .replace('dd', parts.day!)
    .replace('HH', parts.hour!)
    .replace('mm', parts.minute!);
}

const asDate = (value: PdfValue): Date | undefined => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

function applyFormatter(value: PdfValue, formatter: Formatter, options: FormatOptions): PdfValue {
  switch (formatter.name) {
    case 'date':
    case 'datetime': {
      const date = asDate(value);
      if (date === undefined) return value === null ? null : String(value);
      const dateOnly = typeof value === 'string' && value.length === 10;
      const pattern = formatter.argument ?? (formatter.name === 'datetime' && !dateOnly ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy');
      // A calendar date (no time) is printed as written: shifting it by a time zone would change the day.
      return formatDate(date, pattern, dateOnly ? 'UTC' : options.timeZone);
    }
    case 'upper':
      return value === null ? null : String(value instanceof Date ? formatDate(value, 'dd/MM/yyyy', options.timeZone) : value).toLocaleUpperCase('es-CO');
    case 'lower':
      return value === null ? null : String(value instanceof Date ? formatDate(value, 'dd/MM/yyyy', options.timeZone) : value).toLocaleLowerCase('es-CO');
    case 'number': {
      const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
      if (Number.isNaN(number)) return value === null ? null : String(value);
      const decimals = formatter.argument === undefined ? undefined : Number(formatter.argument);
      return new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 6 }).format(number);
    }
    case 'currency': {
      const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
      if (Number.isNaN(number)) return value === null ? null : String(value);
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: options.currencyCode }).format(number);
    }
    case 'default':
      return value === null || value === '' ? (formatter.argument ?? '') : value;
    case 'yesno':
      return value === true || value === 'true' || value === 1 ? 'Sí' : value === false || value === 'false' || value === 0 ? 'No' : value === null ? null : String(value);
  }
}

const DEFAULT_TEXT = (value: PdfValue, options: FormatOptions): string => {
  if (value === null) return '';
  if (value instanceof Date) return formatDate(value, 'dd/MM/yyyy HH:mm', options.timeZone);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Text safe to draw: composed (NFC), without control characters (a newline stays) and with tabs turned into spaces. */
export function normalizePdfText(text: string): string {
  return text.normalize('NFC').replace(/\t/g, ' ').replace(CONTROL_CHARACTERS, '');
}

export function evaluateExpression(expression: ParsedExpression, context: EvaluationContext): string {
  const options: FormatOptions = { timeZone: context.timeZone, currencyCode: context.currencyCode };
  const output = expression.parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      let value: PdfValue = part.path.kind === 'now' ? context.now : (context.resolve(part.path) ?? null);
      for (const formatter of part.formatters) value = applyFormatter(value, formatter, options);
      return DEFAULT_TEXT(value, options);
    })
    .join('');
  return normalizePdfText(output);
}
