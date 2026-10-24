import { z } from 'zod';
import { RICH_TEXT_MAX } from '../common.js';
import { FIELD_TYPES } from '../../workflow/constants.js';
import { BATCH_GROUP_BY } from '../../workflow/block-config.js';
import { uuidSchema } from '../ids.js';
import { ticketMutationResponseSchema } from './mutation-responses.js';

/** The most tickets one batch request moves, whatever the step allows (each one is a full transition). */
export const MAX_BATCH_TICKETS = 100;

/**
 * `GET /ticket-batches`: the open tickets the caller holds on steps that can be answered in a batch, one group per
 * step of a workflow version (the decisions differ between versions). `maxTickets` is the step's own limit.
 */
export const ticketBatchGroupSchema = z.object({
  workflowVersionId: uuidSchema,
  stepId: uuidSchema,
  stepName: z.string(),
  workflowName: z.string(),
  maxTickets: z.number().int().min(1),
  /** The step's own title for its tray (`config.batch.title`), or `null` for the step's name. */
  title: z.string().nullable(),
  /** The data of each ticket the tray shows beside it, in order: code, label, type and how the field reads its value. */
  shownFields: z.array(z.object({ code: z.string(), label: z.string(), type: z.enum(FIELD_TYPES), config: z.record(z.string(), z.unknown()) })),
  /** How the tray splits its tickets; `null` keeps them in one list. */
  groupBy: z.enum(BATCH_GROUP_BY).nullable(),
  decisions: z.array(z.object({ transitionId: uuidSchema, label: z.string() })),
  tickets: z.array(
    z.object({
      id: uuidSchema,
      number: z.string(),
      title: z.string(),
      visitId: uuidSchema,
      requester: z.object({ id: uuidSchema, name: z.string() }),
      companyName: z.string(),
      createdAt: z.string(),
      dueAt: z.string().nullable(),
      /** The values of `shownFields`, by code (absent when the ticket has none). */
      values: z.record(z.string(), z.unknown()),
      /** Its part of the tray under `groupBy`; `null` without grouping. `key` is `''` for "none" (no site, not in a file). */
      subgroup: z.object({ key: z.string(), name: z.string() }).nullable(),
    }),
  ),
});

/** `GET /ticket-batches?cutoffId=`: only the tickets that went out in that export file ("procesar sus tickets"). */
export const ticketBatchesQuerySchema = z.object({ cutoffId: uuidSchema.optional() });
export type TicketBatchesQuery = z.infer<typeof ticketBatchesQuerySchema>;
export type TicketBatchGroup = z.infer<typeof ticketBatchGroupSchema>;
export const ticketBatchGroupsResponseSchema = z.array(ticketBatchGroupSchema);

/**
 * `POST /ticket-batches/transition`: the same decision, step values and comment for every ticket, each one moved in
 * its own transaction. `visitId` is the visit the caller saw, as for a single transition.
 */
export const batchTransitionRequestSchema = z.object({
  transitionId: uuidSchema,
  items: z
    .array(z.object({ ticketId: uuidSchema, visitId: uuidSchema }))
    .min(1)
    .max(MAX_BATCH_TICKETS)
    .refine((items) => new Set(items.map((item) => item.ticketId)).size === items.length, 'A ticket appears twice'),
  values: z.record(z.string(), z.unknown()).default({}),
  comment: z.string().trim().min(1).max(RICH_TEXT_MAX).optional(),
});
export type BatchTransitionRequest = z.infer<typeof batchTransitionRequestSchema>;

/** Each ticket, in the order sent: moved (with where it went) or refused (with the error it would get alone). */
export const batchTransitionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ticketId: uuidSchema, ok: z.literal(true), ticket: ticketMutationResponseSchema }),
  z.object({ ticketId: uuidSchema, ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type BatchTransitionResult = z.infer<typeof batchTransitionResultSchema>;
export const batchTransitionResponseSchema = z.object({ results: z.array(batchTransitionResultSchema) });
export type BatchTransitionResponse = z.infer<typeof batchTransitionResponseSchema>;
