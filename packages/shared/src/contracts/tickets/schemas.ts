import { z } from 'zod';
import { pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';

const values = z.record(z.string(), z.unknown()).default({});
/** An HTML fragment, sanitized by the server; the length limit applies to what is sent. */
const comment = z.string().trim().min(1).max(5000).optional();
export const TICKET_VIEWS = ['created', 'assigned', 'observed', 'all'] as const;
export const ticketStatusSchema = z.enum(['OPEN', 'PAUSED', 'CLOSED']);

export const createTicketRequestSchema = z.object({
  subcategoryId: uuidSchema,
  /** Needed only when the workflow has several START blocks. */
  startStepId: uuidSchema.optional(),
  /** Needed only when the requester belongs to several companies. */
  companyId: uuidSchema.optional(),
  /** Creating on behalf of someone else needs `create_for_others`; defaults to the caller. */
  requesterId: uuidSchema.optional(),
  priorityId: uuidSchema.optional(),
  title: z.string().trim().min(1).max(300),
  /** An HTML fragment: the server sanitizes it with an allowlist (formatting tags and safe links); plain text is valid too. */
  description: z.string().trim().max(20_000).default(''),
  values,
  /** Who takes the first people step when that step has `manual_selection`. */
  assigneeId: uuidSchema.optional(),
});
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;

/** `visitId` is the visit the caller saw: if the ticket moved on, the answer is 409 instead of acting twice. */
export const transitionTicketRequestSchema = z.object({
  transitionId: uuidSchema,
  visitId: uuidSchema,
  values,
  comment,
  assigneeId: uuidSchema.optional(),
});
export type TransitionTicketRequest = z.infer<typeof transitionTicketRequestSchema>;

export const reassignTicketRequestSchema = z.object({ toUserId: uuidSchema, visitId: uuidSchema, comment });
export type ReassignTicketRequest = z.infer<typeof reassignTicketRequestSchema>;

export const takeTicketRequestSchema = z.object({ visitId: uuidSchema });
export type TakeTicketRequest = z.infer<typeof takeTicketRequestSchema>;

export const closeTicketRequestSchema = z.object({ visitId: uuidSchema, values, comment });
export type CloseTicketRequest = z.infer<typeof closeTicketRequestSchema>;

/** An incident (novedad): the ticket is paused and handed to someone else until they resolve it. */
export const openIncidentRequestSchema = z.object({ visitId: uuidSchema, assignedToId: uuidSchema, description: z.string().trim().min(1).max(10_000) });
export type OpenIncidentRequest = z.infer<typeof openIncidentRequestSchema>;

/** `assigneeId` hands the ticket to someone else instead of back to its previous assignees (needs `reassign`). */
export const resolveIncidentRequestSchema = z.object({ resolution: z.string().trim().min(1).max(10_000), assigneeId: uuidSchema.optional() });
export type ResolveIncidentRequest = z.infer<typeof resolveIncidentRequestSchema>;

/** Reopening a closed ticket records an error of a reopening type against whoever is responsible (by default whoever closed it). */
export const reopenTicketRequestSchema = z.object({
  /** A step the ticket has been through; by default the last one. */
  stepId: uuidSchema.optional(),
  errorTypeId: uuidSchema,
  errorSubtypeId: uuidSchema.optional(),
  responsibleId: uuidSchema.optional(),
  /** Who gets the step instead of its last holders. */
  assigneeId: uuidSchema.optional(),
  description: z.string().trim().min(1).max(5000),
});
export type ReopenTicketRequest = z.infer<typeof reopenTicketRequestSchema>;

export const listTicketsQuerySchema = pageQuerySchema.pick({ page: true, pageSize: true }).extend({
  view: z.enum(TICKET_VIEWS).default('assigned'),
  status: ticketStatusSchema.optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export interface TicketAssigneeResponse {
  readonly userId: string;
  readonly type: 'PRIMARY' | 'POOL' | 'PARALLEL' | 'INCIDENT';
  readonly assignedAt: string;
}

export interface TicketSummaryResponse {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly companyId: string;
  readonly creatorId: string;
  readonly subcategoryId: string;
  readonly currentStepId: string | null;
  readonly createdAt: string;
  readonly closedAt: string | null;
}

export interface TicketDetailResponse extends TicketSummaryResponse {
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly registeredById: string | null;
  readonly descriptionHtml: string;
  readonly priorityId: string | null;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  readonly currentLoop: number;
  readonly closedById: string | null;
  /** The visit callers must echo back (`visitId`) when they act on the ticket; `null` once closed. */
  readonly openVisit: { readonly id: string; readonly stepId: string; readonly loop: number; readonly enteredAt: string; readonly dueAt: string | null } | null;
  readonly assignees: readonly TicketAssigneeResponse[];
  /** The incident that pauses the ticket, if any. */
  readonly openIncident: { readonly id: string; readonly assignedToId: string; readonly createdById: string; readonly openedAt: string; readonly descriptionHtml: string } | null;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface TicketEventResponse {
  readonly id: string;
  readonly type: string;
  readonly stepId: string | null;
  readonly transitionId: string | null;
  readonly loop: number;
  readonly actorId: string | null;
  readonly assigneeId: string | null;
  readonly commentHtml: string | null;
  readonly data: unknown;
  readonly createdAt: string;
}

export interface IncidentMutationResponse extends TicketMutationResponse {
  readonly incidentId: string;
}

export interface TicketMutationResponse {
  readonly id: string;
  readonly number: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly currentStepId: string | null;
  readonly openVisitId: string | null;
}
