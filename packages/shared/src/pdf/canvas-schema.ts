import { z } from 'zod';
import { FORMULA_LIMITS } from '../engine/formulas/types.js';
import { FIELD_CODE_PATTERN } from '../workflow/constants.js';
import { expressionSchema, type PdfDesign, pdfDesignSchema } from './design-schema.js';
import { MAX_APPROVAL_LEVEL } from '../contracts/approvals/types.js';
import { uuidSchema } from '../contracts/ids.js';
import { PDF_LIMITS } from './limits.js';

/**
 * A designer format drawn on a free canvas (version 2): every element sits where the person put it, at the size they
 * gave it, with its own style. Measures are millimetres from the top left corner of the sheet. Only what depends on
 * the data moves: a table with more rows than its box (or a text that grows) pushes down what is below it and, when
 * the page is full, continues on the next one; elements marked `repeat` (headers, footers, logos) are drawn on every
 * page. Texts use the placeholders of version 1 (`{{field.CODE}}`, `{{row.CODE}}`, `{{calc.CODE}}`, `{{page}}`…);
 * calculations and conditions are formulas, the language of FORMULA fields.
 */

export const CANVAS_LIMITS = {
  maxElements: 300,
  maxSheets: 10,
  maxCalculations: 50,
  maxNameLength: 100,
  /** The largest sheet (legal, landscape) is 356 × 216 mm; elements may hang a little off it while being placed. */
  maxCoordinate: 400,
} as const;

/** Sheet sizes in millimetres, portrait. */
export const CANVAS_PAGE_SIZES: Readonly<Record<'A4' | 'LETTER' | 'LEGAL', { readonly width: number; readonly height: number }>> = {
  A4: { width: 210, height: 297 },
  LETTER: { width: 215.9, height: 279.4 },
  LEGAL: { width: 215.9, height: 355.6 },
};

const millimetres = (min: number, max: number) => z.number().finite().min(min).max(max);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const code = z.string().regex(FIELD_CODE_PATTERN);
const name = z.string().trim().max(CANVAS_LIMITS.maxNameLength);
/** A formula that must give true for the element (or sheet) to be printed; empty means always. */
const condition = z.string().max(FORMULA_LIMITS.sourceLength);

export const CANVAS_FONTS = ['HELVETICA', 'TIMES', 'COURIER'] as const;
export const CANVAS_ALIGNS = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'] as const;
export const CANVAS_VERTICAL_ALIGNS = ['TOP', 'MIDDLE', 'BOTTOM'] as const;

export const canvasStyleSchema = z
  .object({
    font: z.enum(CANVAS_FONTS),
    /** Points. */
    size: z.number().min(5).max(72),
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean(),
    color,
    align: z.enum(CANVAS_ALIGNS),
    verticalAlign: z.enum(CANVAS_VERTICAL_ALIGNS),
    /** `null` is transparent. */
    background: color.nullable(),
    /** Border width in points; 0 draws none. */
    border: z.number().min(0).max(10),
    borderColor: color,
    /** Corner radius, mm. */
    radius: millimetres(0, 50),
    /** Inner space, mm. */
    padding: millimetres(0, 30),
    /** Line spacing as a multiple of the font size (1 single, 2 double: printed forms often leave room to correct by hand). */
    lineHeight: z.number().min(1).max(3),
  })
  .strict();
export type CanvasStyle = z.infer<typeof canvasStyleSchema>;

const base = {
  id: z.string().min(1).max(50),
  /** What the person sees in the list of layers. */
  name,
  x: millimetres(-CANVAS_LIMITS.maxCoordinate, CANVAS_LIMITS.maxCoordinate),
  y: millimetres(-CANVAS_LIMITS.maxCoordinate, CANVAS_LIMITS.maxCoordinate),
  width: millimetres(1, CANVAS_LIMITS.maxCoordinate),
  height: millimetres(0.5, CANVAS_LIMITS.maxCoordinate),
  /** Drawn the same on every page (headers, footers, logos), whatever its sheet. */
  repeat: z.boolean(),
  /** Locked in the editor, so it is not moved by accident. */
  locked: z.boolean(),
  style: canvasStyleSchema,
  /** Index in `sheets` of the sheet the element is on. */
  sheet: z.number().int().min(0).max(CANVAS_LIMITS.maxSheets - 1),
  condition,
};

/** Free text with placeholders; with `grow`, a text that does not fit makes its box taller and pushes what is below. */
const textElement = z.object({ ...base, type: z.literal('text'), content: expressionSchema, grow: z.boolean() }).strict();

const tableColumn = z
  .object({
    header: z.string().max(200),
    /** What the cell shows, usually `{{row.CODE}}` with a formatter. */
    value: expressionSchema,
    align: z.enum(['LEFT', 'CENTER', 'RIGHT']),
    /** Relative width (1 to 20). */
    weight: z.number().min(1).max(20),
    /** Adds up the column in the total row: the raw values of its single `{{row.CODE}}`, with the same formatters. */
    sum: z.boolean(),
  })
  .strict();

const tableElement = z
  .object({
    ...base,
    type: z.literal('table'),
    /** Code of the TABLE field whose rows are listed. */
    fieldCode: code,
    columns: z.array(tableColumn).min(1).max(PDF_LIMITS.maxTableColumns),
    showHeader: z.boolean(),
    /** The header row's style; the body uses `style`. */
    headerStyle: canvasStyleSchema,
    /** Background of every other row; `null` for none. */
    zebra: color.nullable(),
    showTotals: z.boolean(),
    totalLabel: z.string().max(100),
    /** Fills with empty rows up to this many, so it looks like a paper form. */
    minRows: z.number().int().min(0).max(100),
    emptyMessage: z.string().max(200),
  })
  .strict();

/**
 * `TENANT_LOGO`: the organization's logo, whatever it is when the document is drawn; `UPLOADED`: one of the images of the
 * workflow (`imageId`), uploaded for its formats.
 */
const imageElement = z
  .object({ ...base, type: z.literal('image'), source: z.enum(['TENANT_LOGO', 'UPLOADED']), imageId: uuidSchema.optional(), fit: z.enum(['CONTAIN', 'COVER', 'STRETCH']) })
  .strict()
  .refine((element) => element.source !== 'UPLOADED' || element.imageId !== undefined, { message: 'Say which image', path: ['imageId'] });

const lineElement = z
  .object({ ...base, type: z.literal('line'), orientation: z.enum(['HORIZONTAL', 'VERTICAL']), thickness: z.number().min(0.1).max(10), color, dash: z.enum(['SOLID', 'DASHED', 'DOTTED']) })
  .strict();

const rectangleElement = z.object({ ...base, type: z.literal('rectangle') }).strict();

/**
 * A signature box. `STEP`: who signed that step, the last one, all of them side by side, or the n-th (1 is the first);
 * `REQUESTER`: the requester's name; `BLANK`: an empty box to sign on paper. `positionIds` keeps, of the step's
 * signatures, those of people with one of these positions (none: anybody's): in a step many sign, it puts each area in
 * its own box ("Cartera", "Sistemas"), whatever the order they signed in. `approverOf` keeps only the signature of the
 * requester's approver of that type and level (the help desk's "jefe inmediato"), or of their delegate. `signers` then
 * picks among those.
 */
const signatureElement = z
  .object({
    ...base,
    type: z.literal('signature'),
    source: z.enum(['STEP', 'REQUESTER', 'BLANK']),
    stepName: z.string().trim().max(100).nullable(),
    signers: z.enum(['LAST', 'ALL', 'POSITION']),
    position: z.number().int().min(1).max(50),
    positionIds: z.array(uuidSchema).max(20).optional(),
    approverOf: z.object({ typeId: uuidSchema, level: z.number().int().min(1).max(MAX_APPROVAL_LEVEL) }).strict().optional(),
    label: z.string().max(100),
    showName: z.boolean(),
    showDate: z.boolean(),
    showLine: z.boolean(),
  })
  .strict()
  .refine((element) => element.source !== 'STEP' || (element.stepName !== null && element.stepName !== ''), { message: 'Say which step signs', path: ['stepName'] });

export const canvasElementSchema = z.union([textElement, tableElement, imageElement, lineElement, rectangleElement, signatureElement]);
export type CanvasElement = z.infer<typeof canvasElementSchema>;
export type CanvasElementType = CanvasElement['type'];
export type CanvasTextElement = z.infer<typeof textElement>;
export type CanvasTableElement = z.infer<typeof tableElement>;
export type CanvasImageElement = z.infer<typeof imageElement>;
export type CanvasLineElement = z.infer<typeof lineElement>;
export type CanvasSignatureElement = z.infer<typeof signatureElement>;

/** A named calculation: `{{calc.CODE}}` in texts, `CODE` in other formulas (it reads like a number field). */
export const canvasCalculationSchema = z.object({ code, name, formula: z.string().min(1).max(FORMULA_LIMITS.sourceLength), decimals: z.number().int().min(0).max(6) }).strict();
export type CanvasCalculation = z.infer<typeof canvasCalculationSchema>;

/** A sheet of the design: the first always exists; the others (annexes, backs) start on a new page. */
export const canvasSheetSchema = z.object({ name, condition }).strict();

export const pdfCanvasDesignSchema = z
  .object({
    version: z.literal(2),
    page: z
      .object({
        size: z.enum(['A4', 'LETTER', 'LEGAL']),
        orientation: z.enum(['PORTRAIT', 'LANDSCAPE']),
        /** What grows jumps to the next page before reaching this distance from the bottom, mm. */
        marginBottom: millimetres(0, 100),
      })
      .strict(),
    sheets: z.array(canvasSheetSchema).min(1).max(CANVAS_LIMITS.maxSheets),
    calculations: z.array(canvasCalculationSchema).max(CANVAS_LIMITS.maxCalculations),
    /** In layer order: the last one is drawn on top. */
    elements: z.array(canvasElementSchema).max(CANVAS_LIMITS.maxElements),
  })
  .strict()
  .superRefine((design, context) => {
    const ids = new Set<string>();
    design.elements.forEach((element, index) => {
      if (ids.has(element.id)) context.addIssue({ code: 'custom', message: `Repeated element id ${element.id}`, path: ['elements', index, 'id'] });
      ids.add(element.id);
      if (element.sheet >= design.sheets.length) context.addIssue({ code: 'custom', message: 'The element is on a sheet that does not exist', path: ['elements', index, 'sheet'] });
    });
    const codes = new Set<string>();
    design.calculations.forEach((calculation, index) => {
      if (codes.has(calculation.code)) context.addIssue({ code: 'custom', message: `Repeated calculation ${calculation.code}`, path: ['calculations', index, 'code'] });
      codes.add(calculation.code);
    });
  });
export type PdfCanvasDesign = z.infer<typeof pdfCanvasDesignSchema>;

/** Sheet size in millimetres, turned for landscape. */
export function canvasSheetSize(page: PdfCanvasDesign['page']): { readonly width: number; readonly height: number } {
  const size = CANVAS_PAGE_SIZES[page.size];
  return page.orientation === 'LANDSCAPE' ? { width: size.height, height: size.width } : size;
}

export const defaultCanvasStyle = (): CanvasStyle => ({
  font: 'HELVETICA',
  size: 10,
  bold: false,
  italic: false,
  underline: false,
  color: '#111827',
  align: 'LEFT',
  verticalAlign: 'TOP',
  background: null,
  border: 0,
  borderColor: '#111827',
  radius: 0,
  padding: 1,
  lineHeight: 1,
});

/** A new canvas: a title and the ticket number, ready to be moved around. */
export const emptyCanvasDesign = (): PdfCanvasDesign => ({
  version: 2,
  page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 },
  sheets: [{ name: '', condition: '' }],
  calculations: [],
  elements: [
    {
      id: 'title',
      name: 'Título',
      type: 'text',
      content: '{{ticket.title}}',
      grow: false,
      x: 15,
      y: 15,
      width: 185.9,
      height: 10,
      repeat: false,
      locked: false,
      sheet: 0,
      condition: '',
      style: { ...defaultCanvasStyle(), size: 16, bold: true },
    },
    {
      id: 'number',
      name: 'Número',
      type: 'text',
      content: 'Ticket #{{ticket.number}}',
      grow: false,
      x: 15,
      y: 27,
      width: 90,
      height: 6,
      repeat: false,
      locked: false,
      sheet: 0,
      condition: '',
      style: defaultCanvasStyle(),
    },
  ],
});

/** Either version of a designer format: the block document (1) or the canvas (2). */
export const anyPdfDesignSchema = z.union([pdfDesignSchema, pdfCanvasDesignSchema]);
export type AnyPdfDesign = PdfDesign | PdfCanvasDesign;
