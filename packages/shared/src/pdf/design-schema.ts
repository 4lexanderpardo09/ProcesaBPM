import { z } from 'zod';
import { FIELD_CODE_PATTERN } from '../workflow/constants.js';
import { conditionRuleSchema } from '../workflow/transition-condition.js';
import { parseExpression } from './expression.js';
import { PDF_LIMITS } from './limits.js';

/** A text with `{{placeholders}}`, checked when the design is saved (not when the first ticket is rendered). */
export const expressionSchema = z.string().max(PDF_LIMITS.maxExpressionLength).superRefine((text, context) => {
  const result = parseExpression(text);
  if (!result.ok) for (const error of result.errors) context.addIssue({ code: 'custom', message: `${error.code}: ${error.message}`, params: { position: error.position } });
});

const fieldCode = z.string().regex(FIELD_CODE_PATTERN);
const points = (min: number, max: number) => z.number().min(min).max(max);
const align = z.enum(['LEFT', 'CENTER', 'RIGHT']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const common = {
  /** Shown only when all of these rules hold for the ticket's values (the same rules as workflow branches). */
  visibleWhen: z.array(conditionRuleSchema).min(1).max(10).optional(),
  spaceBefore: points(0, 100).optional(),
  spaceAfter: points(0, 100).optional(),
};

const textBlock = z.object({ type: z.literal('text'), text: expressionSchema, fontSize: points(6, 24).optional(), bold: z.boolean().optional(), align: align.optional(), color: color.optional(), ...common }).strict();
const headingBlock = z.object({ type: z.literal('heading'), text: expressionSchema, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), ...common }).strict();
const fieldsBlock = z
  .object({
    type: z.literal('fields'),
    items: z.array(z.object({ label: z.string().max(200), value: expressionSchema }).strict()).min(1).max(100),
    columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    labelWidthPercent: points(20, 60),
    ...common,
  })
  .strict();
const allFieldsBlock = z.object({ type: z.literal('allFields'), exclude: z.array(fieldCode).max(100).optional(), ...common }).strict();
const tableColumn = z
  .object({ header: z.string().max(200), value: expressionSchema, width: z.union([z.object({ pt: points(20, 600) }).strict(), z.object({ fr: points(0.1, 20) }).strict()]), align: align.optional() })
  .strict();
const tableBlock = z
  .object({
    type: z.literal('table'),
    fieldCode,
    columns: z.array(tableColumn).min(1).max(PDF_LIMITS.maxTableColumns),
    repeatHeader: z.boolean(),
    /** Column index (0-based) whose numbers are added up in a final row. */
    totals: z.array(z.object({ column: z.number().int().min(0).max(PDF_LIMITS.maxTableColumns - 1) }).strict()).max(PDF_LIMITS.maxTableColumns).optional(),
    ...common,
  })
  .strict();
const signaturesBlock = z
  .object({
    type: z.literal('signatures'),
    slots: z
      .array(z.object({ stepName: z.string().min(1).max(100), signerType: z.enum(['USER', 'POSITION', 'APPROVER', 'CREATOR', 'STEP_ASSIGNEE']), signerLabel: z.string().max(100).optional(), caption: expressionSchema.optional() }).strict())
      .min(1)
      .max(12),
    perRow: z.number().int().min(1).max(4),
    height: points(40, 150),
    ...common,
  })
  .strict();
const imageBlock = z.object({ type: z.literal('image'), source: z.literal('TENANT_LOGO'), width: points(20, 300), align: align.optional(), ...common }).strict();
const lineBlock = z.object({ type: z.literal('line'), ...common }).strict();
const spacerBlock = z.object({ type: z.literal('spacer'), height: points(1, 200), ...common }).strict();
const pageBreakBlock = z.object({ type: z.literal('pageBreak'), ...common }).strict();

export const blockSchema = z.discriminatedUnion('type', [textBlock, headingBlock, fieldsBlock, allFieldsBlock, tableBlock, signaturesBlock, imageBlock, lineBlock, spacerBlock, pageBreakBlock]);
export type PdfBlock = z.infer<typeof blockSchema>;

const margin = points(18, 144);
const band = z.object({ height: points(12, 120), blocks: z.array(blockSchema).max(20) }).strict();

export const pdfDesignSchema = z
  .object({
    version: z.literal(1),
    page: z.object({ size: z.enum(['A4', 'LETTER', 'LEGAL']), orientation: z.enum(['PORTRAIT', 'LANDSCAPE']), margins: z.object({ top: margin, right: margin, bottom: margin, left: margin }).strict() }).strict(),
    defaults: z.object({ fontSize: points(6, 24) }).strict(),
    header: band.optional(),
    footer: band.optional(),
    body: z.array(blockSchema),
  })
  .strict()
  .superRefine((design, context) => {
    const count = design.body.length + (design.header?.blocks.length ?? 0) + (design.footer?.blocks.length ?? 0);
    if (count > PDF_LIMITS.maxBlocks) context.addIssue({ code: 'custom', message: `At most ${PDF_LIMITS.maxBlocks} blocks`, path: ['body'] });
  });
export type PdfDesign = z.infer<typeof pdfDesignSchema>;

/** Page sizes in points (1/72 inch). */
export const PAGE_SIZES: Readonly<Record<PdfDesign['page']['size'], { readonly width: number; readonly height: number }>> = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 },
  LEGAL: { width: 612, height: 1008 },
};

export const emptyDesign = (): PdfDesign => ({
  version: 1,
  page: { size: 'A4', orientation: 'PORTRAIT', margins: { top: 54, right: 54, bottom: 54, left: 54 } },
  defaults: { fontSize: 10 },
  body: [{ type: 'heading', text: 'Ticket #{{ticket.number}}', level: 1 }, { type: 'allFields' }],
});
