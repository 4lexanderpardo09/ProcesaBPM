import type { FieldDocument } from '../workflow/document.js';
import type { PdfValue } from './expression.js';

/** A table cell value by column, as the document shows it. */
export type TableRows = ReadonlyArray<Readonly<Record<string, PdfValue>>>;
export type RenderValue = PdfValue | TableRows;

const optionLabels = (config: Record<string, unknown>): string[] => (Array.isArray(config.options) ? (config.options as Array<{ label?: unknown; value?: unknown }>).map((option) => String(option.label ?? option.value ?? '')) : []);

function sampleScalar(type: string, config: Record<string, unknown>, label: string): PdfValue {
  switch (type) {
    case 'NUMBER':
    case 'DAYS':
      return 1234.5;
    case 'CURRENCY':
      return '1500000.00';
    case 'DATE':
      return '2026-01-15';
    case 'DATETIME':
      return new Date('2026-01-15T14:30:00Z');
    case 'SELECT':
      return optionLabels(config)[0] ?? `${label} (ejemplo)`;
    case 'MULTI_SELECT':
      return optionLabels(config).slice(0, 2).join(', ') || `${label} (ejemplo)`;
    case 'SITE':
    case 'USER':
      return 'Nombre de ejemplo';
    case 'FILE':
      return 'documento-ejemplo.pdf';
    default:
      return `${label} (ejemplo)`;
  }
}

/** Display-ready sample data for the preview: what a ticket of this workflow could hold. */
export function sampleRenderValue(field: FieldDocument): RenderValue {
  if (field.type !== 'TABLE') return sampleScalar(field.type, field.config, field.label);
  const columns = Array.isArray(field.config.columns) ? (field.config.columns as Array<{ code?: string; label?: string; type?: string; options?: unknown }>) : [];
  return [1, 2, 3].map((row) => Object.fromEntries(columns.flatMap((column) => (typeof column.code === 'string' ? [[column.code, column.type === 'NUMBER' || column.type === 'CURRENCY' ? row * 100 : `${column.label ?? column.code} ${row}`]] : []))));
}

export function sampleRenderValues(fields: readonly FieldDocument[]): Record<string, RenderValue> {
  return Object.fromEntries(fields.map((field) => [field.code, sampleRenderValue(field)]));
}
