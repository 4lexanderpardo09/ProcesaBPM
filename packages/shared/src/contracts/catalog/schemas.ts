import { z } from 'zod';
import { hexColorSchema, nameSchema } from '../common.js';
import { uuidSchema } from '../ids.js';

// ---- Priorities ----
export const createPriorityRequestSchema = z.object({
  name: nameSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  color: hexColorSchema.optional(),
});
export type CreatePriorityRequest = z.infer<typeof createPriorityRequestSchema>;

export const updatePriorityRequestSchema = z
  .object({ name: nameSchema, sortOrder: z.number().int().min(0).max(10_000), color: hexColorSchema.nullable() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdatePriorityRequest = z.infer<typeof updatePriorityRequestSchema>;

export const priorityResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  color: z.string().nullable(),
  isActive: z.boolean(),
});
export type PriorityResponse = z.infer<typeof priorityResponseSchema>;

// ---- Categories ----
export const categoryRequestSchema = z.object({ name: nameSchema });
export type CategoryRequest = z.infer<typeof categoryRequestSchema>;

export const categoryResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;

const idListSchema = z.array(uuidSchema).max(500).refine((ids) => new Set(ids).size === ids.length, 'Repeated ids');

/** Replaces both lists. An empty list means "visible to everyone" on that axis. */
export const replaceCategoryVisibilitySchema = z.object({ companyIds: idListSchema, departmentIds: idListSchema });
export type ReplaceCategoryVisibilityRequest = z.infer<typeof replaceCategoryVisibilitySchema>;

export const categoryVisibilityResponseSchema = z.object({ companyIds: z.array(uuidSchema), departmentIds: z.array(uuidSchema) });
export type CategoryVisibilityResponse = z.infer<typeof categoryVisibilityResponseSchema>;

// ---- Subcategories ----
export const createSubcategoryRequestSchema = z.object({
  categoryId: uuidSchema,
  name: nameSchema,
  description: z.string().trim().min(1).max(2000).optional(),
  defaultPriorityId: uuidSchema.optional(),
});
export type CreateSubcategoryRequest = z.infer<typeof createSubcategoryRequestSchema>;

/** A subcategory never changes category: its workflow and tickets hang from it. */
export const updateSubcategoryRequestSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().min(1).max(2000).nullable(),
    defaultPriorityId: uuidSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateSubcategoryRequest = z.infer<typeof updateSubcategoryRequestSchema>;

export const subcategoriesQuerySchema = z.object({ categoryId: uuidSchema.optional() });
export type SubcategoriesQuery = z.infer<typeof subcategoriesQuerySchema>;

export const subcategoryResponseSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  defaultPriorityId: uuidSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type SubcategoryResponse = z.infer<typeof subcategoryResponseSchema>;

// ---- What the user creating a ticket can pick ----
export const availableCatalogQuerySchema = z.object({ companyId: uuidSchema.optional() });
export type AvailableCatalogQuery = z.infer<typeof availableCatalogQuerySchema>;

export interface AvailableCategory {
  readonly id: string;
  readonly name: string;
  readonly subcategories: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly defaultPriorityId: string | null;
  }>;
}
export interface AvailableCatalogResponse {
  readonly categories: readonly AvailableCategory[];
}

// ---- Error types (what a reopening or an error report is filed under) ----
const refineExclusive = <T extends { isReopening?: boolean | undefined; forcesClose?: boolean | undefined }>(value: T): boolean => !(value.isReopening === true && value.forcesClose === true);
const EXCLUSIVE_MESSAGE = 'A reopening error type cannot also force the ticket to close';

export const createErrorTypeRequestSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().min(1).max(2000).optional(),
    isProcessError: z.boolean().optional(),
    forcesClose: z.boolean().optional(),
    isReopening: z.boolean().optional(),
  })
  .refine(refineExclusive, EXCLUSIVE_MESSAGE);
export type CreateErrorTypeRequest = z.infer<typeof createErrorTypeRequestSchema>;

export const updateErrorTypeRequestSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().min(1).max(2000).nullable(),
    isProcessError: z.boolean(),
    forcesClose: z.boolean(),
    isReopening: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field')
  .refine(refineExclusive, EXCLUSIVE_MESSAGE);
export type UpdateErrorTypeRequest = z.infer<typeof updateErrorTypeRequestSchema>;

export const errorTypeResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  isProcessError: z.boolean(),
  forcesClose: z.boolean(),
  isReopening: z.boolean(),
  isActive: z.boolean(),
});
export type ErrorTypeResponse = z.infer<typeof errorTypeResponseSchema>;

export const createErrorSubtypeRequestSchema = z.object({ name: nameSchema, description: z.string().trim().min(1).max(2000).optional() });
export type CreateErrorSubtypeRequest = z.infer<typeof createErrorSubtypeRequestSchema>;

export const updateErrorSubtypeRequestSchema = z
  .object({ name: nameSchema, description: z.string().trim().min(1).max(2000).nullable() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateErrorSubtypeRequest = z.infer<typeof updateErrorSubtypeRequestSchema>;

export const errorSubtypeResponseSchema = z.object({ id: uuidSchema, errorTypeId: uuidSchema, name: z.string(), description: z.string().nullable(), isActive: z.boolean() });
export type ErrorSubtypeResponse = z.infer<typeof errorSubtypeResponseSchema>;
