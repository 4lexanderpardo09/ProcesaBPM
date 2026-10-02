import {
  type EvaluationContext,
  evaluateConditions,
  evaluateExpression,
  type FieldDocument,
  formatDate,
  PAGE_SIZES,
  type ParsedExpression,
  parseExpression,
  type Path,
  PdfDesignInvalidError,
  type PdfBlock,
  type PdfDesign,
  type PdfValue,
} from '@procesabpm/shared';
import { documentsEs as es } from '../i18n/es.js';
import { fieldText, fieldValue, sumColumn } from './field-display.js';
import type { RenderFacts, SignerRecord } from './render-facts.js';
import type { ResolvedBlock, ResolvedSignatureSlot } from './resolved-document.js';
import { assignSigners, type SignatureSlot } from './signer-assignment.js';

const LOGO_KEY = 'logo';
const LOGO_RATIO = 0.4;

export interface ResolvedDesign {
  readonly page: { readonly width: number; readonly height: number; readonly margins: PdfDesign['page']['margins'] };
  readonly defaultFontSize: number;
  readonly body: readonly ResolvedBlock[];
  readonly header?: { readonly height: number; readonly resolve: (page: number, pages: number) => readonly ResolvedBlock[] } | undefined;
  readonly footer?: { readonly height: number; readonly resolve: (page: number, pages: number) => readonly ResolvedBlock[] } | undefined;
  /** Whether a logo block was drawn, so the caller knows to load the image. */
  readonly usesLogo: boolean;
}

interface TableColumnDefinition {
  readonly code?: unknown;
  readonly options?: ReadonlyArray<{ readonly value?: unknown; readonly label?: unknown }>;
}

const parse = (text: string, at: string): ParsedExpression => {
  const result = parseExpression(text);
  if (!result.ok) throw new PdfDesignInvalidError(result.errors.map((error) => ({ code: error.code, path: at, detail: error.message })));
  return result.expression;
};

/** Turns a stored design into plain, positioned-ready blocks for one ticket. Everything here is pure. */
export class DesignResolver {
  private readonly fieldsByCode: ReadonlyMap<string, FieldDocument>;
  usesLogo = false;

  constructor(private readonly facts: RenderFacts) {
    this.fieldsByCode = new Map(facts.fields.map((field) => [field.code, field]));
  }

  resolve(design: PdfDesign): ResolvedDesign {
    const size = PAGE_SIZES[design.page.size];
    const landscape = design.page.orientation === 'LANDSCAPE';
    const body = this.blocks(design.body, 'body', {});
    const band = (name: 'header' | 'footer') => {
      const definition = design[name];
      if (definition === undefined) return undefined;
      return { height: definition.height, resolve: (page: number, pages: number) => this.blocks(definition.blocks, `${name}.blocks`, { page, pages }) };
    };
    return {
      page: { width: landscape ? size.height : size.width, height: landscape ? size.width : size.height, margins: design.page.margins },
      defaultFontSize: design.defaults.fontSize,
      body,
      header: band('header'),
      footer: band('footer'),
      usesLogo: this.usesLogo || [design.header, design.footer].some((definition) => definition?.blocks.some((block) => block.type === 'image')) || design.body.some((block) => block.type === 'image'),
    };
  }

  private blocks(blocks: readonly PdfBlock[], at: string, frame: { page?: number; pages?: number }): ResolvedBlock[] {
    return blocks.flatMap((block, index) => {
      if (block.visibleWhen !== undefined && !evaluateConditions(block.visibleWhen, this.facts.values as never)) return [];
      return this.block(block, `${at}[${index}]`, frame);
    });
  }

  private block(block: PdfBlock, at: string, frame: { page?: number; pages?: number }): ResolvedBlock[] {
    const spacing = { ...(block.spaceBefore === undefined ? {} : { spaceBefore: block.spaceBefore }), ...(block.spaceAfter === undefined ? {} : { spaceAfter: block.spaceAfter }) };
    const text = (source: string, field: string, row?: Readonly<Record<string, unknown>>, tableField?: FieldDocument) => evaluateExpression(parse(source, `${at}.${field}`), this.context(frame, row, tableField));
    switch (block.type) {
      case 'text':
        return [{ ...spacing, type: 'text', text: text(block.text, 'text'), fontSize: block.fontSize, bold: block.bold, align: block.align, color: block.color }];
      case 'heading':
        return [{ ...spacing, type: 'heading', text: text(block.text, 'text'), level: block.level }];
      case 'fields':
        return [{ ...spacing, type: 'fields', rows: block.items.map((item, index) => ({ label: item.label, value: text(item.value, `items[${index}].value`) })), columns: block.columns, labelWidthPercent: block.labelWidthPercent }];
      case 'allFields':
        return [{ ...spacing, type: 'fields', rows: this.allFields(block.exclude ?? []), columns: 1, labelWidthPercent: 35 }];
      case 'table':
        return this.table(block, at, spacing, frame);
      case 'signatures':
        return [{ ...spacing, type: 'signatures', slots: this.slots(block, at, frame), perRow: block.perRow, height: block.height }];
      case 'image':
        this.usesLogo = true;
        return [{ ...spacing, type: 'image', imageKey: LOGO_KEY, width: block.width, height: Math.round(block.width * LOGO_RATIO), align: block.align }];
      case 'line':
        return [{ ...spacing, type: 'line' }];
      case 'spacer':
        return [{ ...spacing, type: 'spacer', height: block.height }];
      case 'pageBreak':
        return [{ ...spacing, type: 'pageBreak' }];
    }
  }

  private allFields(exclude: readonly string[]): Array<{ label: string; value: string }> {
    const options = { timeZone: this.facts.timeZone, currencyCode: this.facts.currencyCode };
    return this.facts.fields
      .filter((field) => field.type !== 'TABLE' && !exclude.includes(field.code))
      .flatMap((field) => {
        const value = fieldText(field, this.facts.values[field.code], this.facts.names, options);
        return value === '' ? [] : [{ label: field.label, value }];
      });
  }

  private table(block: Extract<PdfBlock, { type: 'table' }>, at: string, spacing: object, frame: { page?: number; pages?: number }): ResolvedBlock[] {
    const field = this.fieldsByCode.get(block.fieldCode);
    const stored = this.facts.values[block.fieldCode];
    const rows = field !== undefined && Array.isArray(stored) ? (stored as Array<Record<string, unknown>>) : [];
    const expressions = block.columns.map((column, index) => parse(column.value, `${at}.columns[${index}].value`));
    const cells = rows.map((row) => expressions.map((expression) => evaluateExpression(expression, this.context(frame, row, field))));
    const totals = block.totals === undefined ? undefined : this.totals(block, expressions, rows);
    return [
      {
        ...spacing,
        type: 'table',
        headers: block.columns.map((column) => column.header),
        columns: block.columns.map((column) => ({ width: column.width, align: column.align })),
        rows: cells,
        repeatHeader: block.repeatHeader,
        totals,
      },
    ];
  }

  /** Adds up the raw values of the columns that just show a row value; a column built from text has no total. */
  private totals(block: Extract<PdfBlock, { type: 'table' }>, expressions: readonly ParsedExpression[], rows: ReadonlyArray<Record<string, unknown>>): string[] {
    const totals = block.columns.map(() => '');
    totals[0] = es.total;
    for (const { column } of block.totals ?? []) {
      const only = expressions[column]?.parts;
      const part = only?.length === 1 ? only[0] : undefined;
      if (part?.kind !== 'placeholder' || part.path.kind !== 'row' || part.formatters.length > 0) continue;
      const code = part.path.code;
      const values = rows.map((row) => row[code]);
      const decimals = Math.max(0, ...values.map((value) => String(value ?? '').split('.')[1]?.length ?? 0));
      const total = sumColumn(values, decimals);
      if (total !== null) totals[column] = new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(total as never);
    }
    return totals;
  }

  /** The text of an expression for this ticket (a template mapping or a file name pattern). */
  evaluate(source: string, at: string): string {
    return evaluateExpression(parse(source, at), this.context({}));
  }

  /** The value of a field as people read it. */
  displayField(code: string): string {
    const field = this.fieldsByCode.get(code);
    return field === undefined ? '' : fieldText(field, this.facts.values[code], this.facts.names, { timeZone: this.facts.timeZone, currencyCode: this.facts.currencyCode });
  }

  private slots(block: Extract<PdfBlock, { type: 'signatures' }>, at: string, frame: { page?: number; pages?: number }): ResolvedSignatureSlot[] {
    return this.signaturesFor(block.slots.map((slot, index) => ({ ...slot, caption: slot.caption === undefined ? undefined : evaluateExpression(parse(slot.caption, `${at}.slots[${index}].caption`), this.context(frame)) })));
  }

  /** Who fills each slot of a document, step by step, with the caption to print under it. */
  signaturesFor(slots: ReadonlyArray<SignatureSlot & { readonly caption?: string | undefined }>): ResolvedSignatureSlot[] {
    const byStep = new Map<string, number[]>();
    slots.forEach((slot, index) => byStep.set(slot.stepName, [...(byStep.get(slot.stepName) ?? []), index]));
    const chosen: Array<SignerRecord | undefined> = slots.map(() => undefined);
    for (const [stepName, indexes] of byStep) {
      const assigned = assignSigners(indexes.map((index) => slots[index]!), this.facts.signers.get(stepName) ?? [], this.facts.ticket.creatorId);
      indexes.forEach((slotIndex, position) => (chosen[slotIndex] = assigned[position]));
    }
    return slots.map((slot, index): ResolvedSignatureSlot => {
      const signer = chosen[index];
      if (signer === undefined) return { caption: slot.caption ?? es.pendingSignature(slot.signerLabel ?? slot.stepName), imageKey: null };
      return { caption: slot.caption ?? es.signedBy(signer.name, formatDate(signer.signedAt, 'dd/MM/yyyy', this.facts.timeZone)), imageKey: signer.imageKey };
    });
  }

  private context(frame: { page?: number; pages?: number }, row?: Readonly<Record<string, unknown>>, tableField?: FieldDocument): EvaluationContext {
    return { resolve: (path) => this.pathValue(path, frame, row, tableField), timeZone: this.facts.timeZone, currencyCode: this.facts.currencyCode, now: this.facts.now };
  }

  private pathValue(path: Path, frame: { page?: number; pages?: number }, row?: Readonly<Record<string, unknown>>, tableField?: FieldDocument): PdfValue | undefined {
    switch (path.kind) {
      case 'field': {
        const field = this.fieldsByCode.get(path.code);
        return field === undefined ? null : fieldValue(field, this.facts.values[path.code], this.facts.names);
      }
      case 'row': {
        if (row === undefined) return undefined;
        const definition = (Array.isArray(tableField?.config.columns) ? (tableField.config.columns as TableColumnDefinition[]) : []).find((column) => column.code === path.code);
        const raw = row[path.code];
        const label = definition?.options?.find((option) => option.value === raw)?.label;
        const value = label ?? raw;
        return value === undefined || value === null ? null : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
      }
      case 'ticket':
        return this.ticketValue(path.name);
      case 'step': {
        const signers = this.facts.signers.get(path.stepName) ?? [];
        if (signers.length === 0) return null;
        return path.property === 'completedBy' ? signers.map((signer) => signer.name).join(', ') : signers[signers.length - 1]!.signedAt;
      }
      case 'page':
        return frame.page ?? undefined;
      case 'pages':
        return frame.pages ?? undefined;
      case 'now':
        return this.facts.now;
    }
  }

  private ticketValue(name: 'number' | 'title' | 'status' | 'createdAt' | 'closedAt' | 'companyName' | 'creatorName' | 'currentStepName'): PdfValue {
    const { ticket } = this.facts;
    return name === 'status' ? es.ticketStatus[ticket.status] : ticket[name];
  }
}

export const LOGO_IMAGE_KEY = LOGO_KEY;
