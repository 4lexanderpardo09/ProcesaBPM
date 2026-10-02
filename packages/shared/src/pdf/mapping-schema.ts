import { z } from 'zod';
import { FIELD_CODE_PATTERN } from '../workflow/constants.js';
import { expressionSchema } from './design-schema.js';
import { PDF_LIMITS } from './limits.js';

const mode = z.enum(['COORDINATES', 'ACROFORM']);
const page = z.number().int().min(1).max(PDF_LIMITS.maxTemplatePages);
const coordinate = z.number().min(0).max(100_000);

/** One value placed in an uploaded PDF: by coordinates (origin bottom-left of the displayed page) or into an AcroForm field. */
export const mappedFieldSchema = z
  .object({
    mode,
    fieldCode: z.string().regex(FIELD_CODE_PATTERN).optional(),
    expression: expressionSchema.optional(),
    acroformName: z.string().min(1).max(200).optional(),
    page: page.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    fontSize: z.number().min(4).max(72).optional(),
    maxWidth: z.number().gt(0).max(100_000).optional(),
    align: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    const fail = (message: string, path: string) => context.addIssue({ code: 'custom', message, path: [path] });
    if ((field.fieldCode === undefined) === (field.expression === undefined)) fail('Give a field code or an expression, not both', 'fieldCode');
    if (field.mode === 'COORDINATES' && (field.page === undefined || field.x === undefined || field.y === undefined)) fail('Coordinates need page, x and y', 'page');
    if (field.mode === 'ACROFORM' && field.acroformName === undefined) fail('An AcroForm field needs its name', 'acroformName');
  });

export const mappedSignatureSchema = z
  .object({
    mode,
    stepName: z.string().min(1).max(100),
    signerType: z.enum(['USER', 'POSITION', 'APPROVER', 'CREATOR', 'STEP_ASSIGNEE']),
    signerLabel: z.string().max(100).optional(),
    acroformName: z.string().min(1).max(200).optional(),
    page: page.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: z.number().gt(0).max(2000).optional(),
    height: z.number().gt(0).max(2000).optional(),
  })
  .strict()
  .superRefine((slot, context) => {
    const fail = (message: string, path: string) => context.addIssue({ code: 'custom', message, path: [path] });
    if (slot.mode === 'COORDINATES' && (slot.page === undefined || slot.x === undefined || slot.y === undefined || slot.width === undefined || slot.height === undefined)) fail('A signature box needs page, x, y, width and height', 'page');
    if (slot.mode === 'ACROFORM' && slot.acroformName === undefined) fail('An AcroForm signature needs its field name', 'acroformName');
  });

export const templateMappingSchema = z
  .object({ fields: z.array(mappedFieldSchema).max(PDF_LIMITS.maxMappedFields), signatures: z.array(mappedSignatureSchema).max(PDF_LIMITS.maxMappedSignatures) })
  .strict();
export type TemplateMapping = z.infer<typeof templateMappingSchema>;
export type MappedField = z.infer<typeof mappedFieldSchema>;
export type MappedSignature = z.infer<typeof mappedSignatureSchema>;

/** What the inspector finds in an uploaded PDF. */
export interface PageBox {
  readonly mediaBox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 0, 90, 180 or 270: pages are shown rotated, and coordinates are given in the displayed orientation. */
  readonly rotation: 0 | 90 | 180 | 270;
}
export const ACROFORM_TYPES = ['TEXT', 'CHECKBOX', 'RADIO', 'DROPDOWN', 'SIGNATURE', 'BUTTON'] as const;
export interface AcroFieldInfo {
  readonly name: string;
  readonly type: (typeof ACROFORM_TYPES)[number];
  /** 1-based, `null` when the widget cannot be located. */
  readonly page: number | null;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
}

/** Width and height of a page as people see it. */
export const displayedSize = (box: PageBox): { width: number; height: number } =>
  box.rotation === 90 || box.rotation === 270 ? { width: box.mediaBox.h, height: box.mediaBox.w } : { width: box.mediaBox.w, height: box.mediaBox.h };
