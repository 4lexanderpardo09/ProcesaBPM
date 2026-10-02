import type { FilledField, FilledSignature } from '../../../infrastructure/pdf/pdf-renderer.js';
import type { DesignResolver } from './design-resolver.js';

/** A row of `pdf_template_fields`, as the data layer reads it. */
export interface MappedFieldRow {
  readonly mode: 'COORDINATES' | 'ACROFORM';
  readonly fieldCode: string | null;
  readonly expression: string | null;
  readonly acroformName: string | null;
  readonly page: number | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly fontSize: number | null;
  readonly maxWidth: number | null;
  readonly align: string | null;
}

export interface MappedSignatureRow {
  readonly mode: 'COORDINATES' | 'ACROFORM';
  readonly stepName: string;
  readonly signerType: 'USER' | 'POSITION' | 'APPROVER' | 'CREATOR' | 'STEP_ASSIGNEE';
  readonly signerLabel: string | null;
  readonly acroformName: string | null;
  readonly page: number | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

const DEFAULT_FONT_SIZE = 10;
const ALIGNS = ['LEFT', 'CENTER', 'RIGHT'] as const;

/** Evaluates what goes into each place of an uploaded PDF. */
export function resolveTemplateFields(rows: readonly MappedFieldRow[], resolver: DesignResolver): FilledField[] {
  return rows.map((row, index): FilledField => {
    const value = row.fieldCode !== null ? resolver.displayField(row.fieldCode) : resolver.evaluate(row.expression ?? '', `fields[${index}].expression`);
    if (row.mode === 'ACROFORM') return { mode: 'ACROFORM', name: row.acroformName!, value };
    return {
      mode: 'COORDINATES',
      page: row.page!,
      x: row.x!,
      y: row.y!,
      value,
      fontSize: row.fontSize ?? DEFAULT_FONT_SIZE,
      maxWidth: row.maxWidth,
      align: ALIGNS.find((align) => align === row.align) ?? 'LEFT',
    };
  });
}

export function resolveTemplateSignatures(rows: readonly MappedSignatureRow[], resolver: DesignResolver): FilledSignature[] {
  const slots = resolver.signaturesFor(rows.map((row) => ({ stepName: row.stepName, signerType: row.signerType, signerLabel: row.signerLabel ?? undefined })));
  return rows.map((row, index): FilledSignature => ({
    target: row.mode === 'ACROFORM' ? { mode: 'ACROFORM', name: row.acroformName! } : { mode: 'COORDINATES', page: row.page!, x: row.x!, y: row.y!, width: row.width!, height: row.height! },
    caption: slots[index]!.caption,
    imageKey: slots[index]!.imageKey,
  }));
}
