import { safeCellText } from '../../../infrastructure/spreadsheet/spreadsheet-text.js';

/** Excel recognizes UTF-8 only with it. */
export const CSV_BOM = '﻿';
const CSV_NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** JSON with what JSON cannot hold made explicit: big integers and decimals as strings, dates in ISO 8601 (UTC). */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** One row as one JSON line. */
export function jsonLine(row: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(row, jsonReplacer)}\n`;
}

/** A cell as text: objects as JSON, dates in ISO 8601, nothing for null. */
function cellText(value: unknown): { text: string; fromUser: boolean } {
  if (value === null || value === undefined) return { text: '', fromUser: false };
  if (value instanceof Date) return { text: value.toISOString(), fromUser: false };
  if (typeof value === 'string') return { text: value, fromUser: true };
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return { text: String(value), fromUser: false };
  return { text: JSON.stringify(value, jsonReplacer), fromUser: true };
}

/** RFC 4180 (comma, CRLF, quotes doubled); text that a spreadsheet would run as a formula is neutralized. */
export function csvField(value: unknown): string {
  const { text, fromUser } = cellText(value);
  const safe = fromUser ? safeCellText(text) : text;
  return CSV_NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

/** The row's values in the dataset's column order. */
export function csvRecord(row: Readonly<Record<string, unknown>>, columns: readonly string[]): string {
  return csvRow(columns.map((column) => row[column]));
}
