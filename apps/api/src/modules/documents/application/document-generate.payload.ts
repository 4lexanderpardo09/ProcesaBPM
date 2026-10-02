import { uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';

export const DOCUMENT_GENERATE_EVENT = 'document.generate';

/** Ids only: the handler reads the current ticket, format and mapping when it draws the document. */
export const documentGeneratePayloadSchema = z
  .object({
    ticketId: uuidSchema,
    /** The ticket event that caused it: the new version points at it, and the file id is derived from the outbox event. */
    ticketEventId: uuidSchema,
    workflowDocumentId: uuidSchema,
    role: z.enum(['MAIN_DOCUMENT', 'STEP_DOCUMENT']),
    stepId: uuidSchema.nullable(),
    trigger: z.enum(['BLOCK', 'CREATION', 'EACH_STEP', 'CLOSING']),
  })
  .strict()
  .refine((payload) => (payload.role === 'STEP_DOCUMENT') === (payload.stepId !== null), 'A step document names its step; the main document does not');
export type DocumentGeneratePayload = z.infer<typeof documentGeneratePayloadSchema>;
