import { z } from 'zod';
import { hexColorSchema, nameSchema } from '../common.js';
import { uuidSchema } from '../ids.js';

/** Personal tags: the owner is always the caller, so the request never carries an owner. */
export const createTagRequestSchema = z.object({ name: nameSchema, color: hexColorSchema });
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;

export const updateTagRequestSchema = z
  .object({ name: nameSchema, color: hexColorSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>;

export const tagResponseSchema = z.object({ id: uuidSchema, name: z.string(), color: z.string() });
export type TagResponse = z.infer<typeof tagResponseSchema>;

export const attachTagRequestSchema = z.object({ tagId: uuidSchema });
export type AttachTagRequest = z.infer<typeof attachTagRequestSchema>;
