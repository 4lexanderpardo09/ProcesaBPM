import { z } from 'zod';
import { nameSchema } from '../common.js';
import { uuidSchema } from '../ids.js';

/** Personal text templates (snippets) that a member can insert into a comment; the owner may share them read-only. */
const bodySchema = z.string().trim().min(1).max(20_000);

export const createTextTemplateRequestSchema = z.object({ title: nameSchema, bodyHtml: bodySchema });
export type CreateTextTemplateRequest = z.infer<typeof createTextTemplateRequestSchema>;

export const updateTextTemplateRequestSchema = z
  .object({ title: nameSchema, bodyHtml: bodySchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateTextTemplateRequest = z.infer<typeof updateTextTemplateRequestSchema>;

export const textTemplateResponseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  bodyHtml: z.string(),
  isOwner: z.boolean(),
  ownerId: uuidSchema,
  ownerName: z.string(),
  updatedAt: z.string(),
});
export type TextTemplateResponse = z.infer<typeof textTemplateResponseSchema>;

export const setTextTemplateSharesRequestSchema = z.object({
  userIds: z
    .array(uuidSchema)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Repeated users'),
});
export type SetTextTemplateSharesRequest = z.infer<typeof setTextTemplateSharesRequestSchema>;
