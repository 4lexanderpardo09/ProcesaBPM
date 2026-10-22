import {
  type CanvasElement,
  canvasSheetSize,
  type CompiledFormula,
  compileCanvasFormulas,
  Decimal,
  type FieldDocument,
  formatDate,
  FormulaRuntimeError,
  type FormulaValue,
  evaluateFormulaExpression,
  localDateOf,
  parseExpression,
  type PdfCanvasDesign,
  type PdfValue,
} from '@procesabpm/shared';
import type { CanvasContent, ResolvedCanvasElement, ResolvedSigner } from '../../../infrastructure/pdf/canvas-document.js';
import { DesignResolver } from './design-resolver.js';
import { sumColumn } from './field-display.js';
import type { RenderFacts, SignerRecord } from './render-facts.js';

const LOGO_KEY = 'logo';
const UPLOADED_PREFIX = 'img:';

/** The image key of one of the workflow's uploaded images. */
export const uploadedImageKey = (imageId: string): string => `${UPLOADED_PREFIX}${imageId}`;

/** The uploaded images a plan draws, by id, for the caller to look up their files. */
export const uploadedImageIds = (keys: Iterable<string>): string[] => [...keys].flatMap((key) => (key.startsWith(UPLOADED_PREFIX) ? [key.slice(UPLOADED_PREFIX.length)] : []));
const SIGNED_AT_PATTERN = 'dd/MM/yyyy HH:mm';

export interface ResolvedCanvas {
  readonly content: CanvasContent;
  /** The images the printed elements show (`logo`, `img:<image id>`), so the caller loads them. */
  readonly imageKeys: ReadonlySet<string>;
  /** The evaluator of texts with the calculations of this canvas (the file name pattern uses it too). */
  readonly texts: DesignResolver;
}

/** A number with exactly `decimals` decimals, as people expect a calculation printed. */
function fixed(value: Decimal, decimals: number): string {
  const plain = value.round(decimals).toPlainString();
  if (decimals === 0) return plain;
  const [whole, fraction = ''] = plain.split('.');
  return `${whole}.${fraction.padEnd(decimals, '0')}`;
}

/**
 * Turns a stored canvas into the elements to lay out for one ticket: the calculations first (each reads the fields
 * and the calculations above it), then the conditions (an element or a sheet prints only when its condition is true;
 * one that cannot be worked out, for a missing value, does not print), then texts, rows, totals and signers. Pure.
 */
export class CanvasResolver {
  private readonly fieldsByCode: ReadonlyMap<string, FieldDocument>;

  constructor(private readonly facts: RenderFacts) {
    this.fieldsByCode = new Map(facts.fields.map((field) => [field.code, field]));
  }

  resolve(design: PdfCanvasDesign): ResolvedCanvas {
    const compiled = compileCanvasFormulas(design, this.facts.fields);
    const today = localDateOf(this.facts.now.getTime(), this.facts.timeZone);
    const values: Record<string, unknown> = { ...this.facts.values };
    const calculations = new Map<string, PdfValue>();
    for (const calculation of compiled.calculations) {
      const result = this.run(calculation.formula, values, today);
      const value = result instanceof Decimal ? fixed(result, calculation.decimals) : typeof result === 'string' ? result : null;
      calculations.set(calculation.code, value);
      values[calculation.code] = value;
    }
    const holds = (formula: CompiledFormula | undefined) => formula === undefined || this.run(formula, values, today) === true;
    const texts = new DesignResolver(this.facts, calculations);

    const imageKeys = new Set<string>();
    const elements = design.elements.flatMap((element, order): ResolvedCanvasElement[] => {
      if (!holds(compiled.elementConditions.get(element.id))) return [];
      const resolved = this.element(element, order, texts);
      if (resolved.type === 'image' && resolved.imageKey !== null) imageKeys.add(resolved.imageKey);
      return [resolved];
    });
    const size = canvasSheetSize(design.page);
    return {
      content: {
        page: { width: size.width, height: size.height, marginBottom: design.page.marginBottom },
        sheets: design.sheets.flatMap((_, index) => (holds(compiled.sheetConditions.get(index)) ? [index] : [])),
        elements,
      },
      imageKeys,
      texts,
    };
  }

  private run(formula: CompiledFormula, values: Readonly<Record<string, unknown>>, today: string): FormulaValue {
    try {
      return evaluateFormulaExpression(formula.expression, { values, today });
    } catch (error) {
      if (error instanceof FormulaRuntimeError) return null;
      throw error;
    }
  }

  private element(element: CanvasElement, order: number, texts: DesignResolver): ResolvedCanvasElement {
    const at = `elements[${order}]`;
    const base = { id: element.id, order, x: element.x, y: element.y, width: element.width, height: element.height, repeat: element.repeat, sheet: element.sheet, style: element.style };
    switch (element.type) {
      case 'text':
        return { ...base, type: 'text', grow: element.grow, text: (frame) => texts.text(element.content, `${at}.content`, frame ?? {}) };
      case 'table': {
        const field = this.fieldsByCode.get(element.fieldCode);
        const stored = this.facts.values[element.fieldCode];
        const rows = field?.type === 'TABLE' && Array.isArray(stored) ? (stored as Array<Record<string, unknown>>) : [];
        const cells = rows.map((row) => element.columns.map((column, index) => texts.text(column.value, `${at}.columns[${index}].value`, {}, row, field)));
        const totals = element.showTotals && element.columns.some((column) => column.sum) ? element.columns.map((column, index) => (column.sum ? this.total(column.value, `${at}.columns[${index}].value`, rows, texts) : null)) : null;
        return {
          ...base,
          type: 'table',
          showHeader: element.showHeader,
          headers: element.columns.map((column) => column.header),
          headerStyle: element.headerStyle,
          columns: element.columns.map((column) => ({ align: column.align, weight: column.weight })),
          rows: cells,
          totals,
          totalLabel: element.totalLabel,
          zebra: element.zebra,
          minRows: element.minRows,
          emptyMessage: element.emptyMessage,
        };
      }
      case 'image':
        return { ...base, type: 'image', imageKey: element.source === 'UPLOADED' && element.imageId !== undefined ? uploadedImageKey(element.imageId) : LOGO_KEY, fit: element.fit };
      case 'line':
        return { ...base, type: 'line', orientation: element.orientation, thickness: element.thickness, color: element.color, dash: element.dash };
      case 'rectangle':
        return { ...base, type: 'rectangle' };
      case 'signature':
        return { ...base, type: 'signature', signers: this.signers(element), label: element.label, showName: element.showName, showDate: element.showDate, showLine: element.showLine };
    }
  }

  /**
   * The total of a column whose value is one `{{row.CODE}}` (text around it and formatters allowed): the raw values
   * added up exactly, then shown through the same expression. A column built from several values has no total.
   */
  private total(source: string, at: string, rows: ReadonlyArray<Record<string, unknown>>, texts: DesignResolver): string {
    const parsed = parseExpression(source);
    if (!parsed.ok) return '';
    const placeholders = parsed.expression.parts.flatMap((part) => (part.kind === 'placeholder' ? [part] : []));
    const only = placeholders.length === 1 ? placeholders[0] : undefined;
    if (only === undefined || only.path.kind !== 'row') return '';
    const code = only.path.code;
    const raw = rows.map((row) => row[code]);
    const decimals = Math.max(0, ...raw.map((value) => String(value ?? '').split('.')[1]?.length ?? 0));
    const sum = sumColumn(raw, decimals);
    return sum === null ? '' : texts.text(source, at, {}, { [code]: sum });
  }

  private signers(element: Extract<CanvasElement, { type: 'signature' }>): Array<ResolvedSigner | null> {
    const signer = (record: SignerRecord): ResolvedSigner => ({ name: record.name, date: formatDate(record.signedAt, SIGNED_AT_PATTERN, this.facts.timeZone), imageKey: record.imageKey });
    switch (element.source) {
      case 'BLANK':
        return [null];
      case 'REQUESTER': {
        // The requester's own signature image, when they signed a step of this ticket.
        const signed = [...this.facts.signers.values()].flat().find((record) => record.userId === this.facts.ticket.creatorId);
        return [{ name: this.facts.ticket.creatorName, date: null, imageKey: signed?.imageKey ?? null }];
      }
      case 'STEP': {
        const all = this.facts.signers.get(element.stepName ?? '') ?? [];
        const kept = element.positionIds ?? [];
        // A box of one area keeps only the signatures of people in it, whatever the order they signed in.
        const records = kept.length === 0 ? all : all.filter((record) => record.anyPosition === true || (record.positionId !== null && kept.includes(record.positionId)));
        if (element.signers === 'ALL') return records.length === 0 ? [null] : records.map(signer);
        const chosen = element.signers === 'POSITION' ? records[element.position - 1] : records[records.length - 1];
        return [chosen === undefined ? null : signer(chosen)];
      }
    }
  }
}
