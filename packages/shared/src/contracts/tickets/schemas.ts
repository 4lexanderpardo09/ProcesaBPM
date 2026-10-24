import { z } from 'zod';
import { pageResponseSchema } from '../common.js';
import { attachmentIdsSchema } from '../files/schemas.js';
import { uuidSchema } from '../ids.js';
import { type TagResponse, tagResponseSchema } from '../tags/schemas.js';

const values = z.record(z.string(), z.unknown()).default({});
/** An HTML fragment, sanitized by the server; the length limit applies to what is sent. */
const comment = z.string().trim().min(1).max(5000).optional();
/**
 * The inboxes: created by me, assigned to me now, observed, all I may read; and, like the help desk, the ones I worked
 * on before (`history`), the ones reopened, and those with errors I reported or that were attributed to me.
 */
export const TICKET_VIEWS = ['created', 'assigned', 'observed', 'all', 'history', 'reopened', 'errors_reported', 'errors_received'] as const;
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
  attachments: attachmentIdsSchema,
});
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;

/** Edits what the ticket says (`update`): its subject, its description (an HTML fragment, sanitized) and its priority. */
export const editTicketRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(20_000),
    /** `null` takes the priority off. */
    priorityId: uuidSchema.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');
export type EditTicketRequest = z.infer<typeof editTicketRequestSchema>;
/** `eventId` is null when nothing actually changed. */
export const editTicketResponseSchema = z.object({ eventId: uuidSchema.nullable() });
export type EditTicketResponse = z.infer<typeof editTicketResponseSchema>;

/** `visitId` is the visit the caller saw: if the ticket moved on, the answer is 409 instead of acting twice. */
export const transitionTicketRequestSchema = z.object({
  transitionId: uuidSchema,
  visitId: uuidSchema,
  values,
  comment,
  assigneeId: uuidSchema.optional(),
  attachments: attachmentIdsSchema,
  /**
   * The signature drawn (or chosen) when answering the step: the caller's own confirmed PNG or JPEG upload. The step's
   * documents show it instead of the profile signature. Without it, the profile signature is used.
   */
  signatureFileId: uuidSchema.optional(),
});
export type TransitionTicketRequest = z.infer<typeof transitionTicketRequestSchema>;

/** On a PARALLEL step `fromUserId` says whose pending signature moves to `toUserId`. */
export const reassignTicketRequestSchema = z.object({ toUserId: uuidSchema, visitId: uuidSchema, comment, fromUserId: uuidSchema.optional() });
export type ReassignTicketRequest = z.infer<typeof reassignTicketRequestSchema>;

export const takeTicketRequestSchema = z.object({ visitId: uuidSchema });
export type TakeTicketRequest = z.infer<typeof takeTicketRequestSchema>;

export const closeTicketRequestSchema = z.object({ visitId: uuidSchema, values, comment, attachments: attachmentIdsSchema });
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

/**
 * Reports an error on an open ticket (`report_error`). It is attributed to whoever handled the previous people step
 * (the creator when there is none, or when the type forces the close). A process error sends the ticket back to that
 * person on that step; a type that forces the close closes it. `visitId` is the visit the caller saw.
 */
export const reportTicketErrorRequestSchema = z.object({
  visitId: uuidSchema,
  errorTypeId: uuidSchema,
  errorSubtypeId: uuidSchema.optional(),
  description: z.string().trim().min(1).max(5000),
});
export type ReportTicketErrorRequest = z.infer<typeof reportTicketErrorRequestSchema>;

/** Signing or rejecting one's own pending signature of a PARALLEL step; `assigneeId` is for a manual-selection step that follows. */
export const parallelTaskActionRequestSchema = z.object({
  visitId: uuidSchema,
  comment,
  assigneeId: uuidSchema.optional(),
  /** Only when signing: the signature drawn at that moment (see `transitionTicketRequestSchema`). */
  signatureFileId: uuidSchema.optional(),
});
export type ParallelTaskActionRequest = z.infer<typeof parallelTaskActionRequestSchema>;

const assigneeTypeSchema = z.enum(['PRIMARY', 'POOL', 'PARALLEL', 'INCIDENT']);

export interface TicketAssigneeResponse {
  readonly userId: string;
  readonly name: string;
  readonly type: 'PRIMARY' | 'POOL' | 'PARALLEL' | 'INCIDENT';
  readonly assignedAt: string;
}

/** A record shown by its name next to its id. */
export interface NamedRefResponse {
  readonly id: string;
  readonly name: string;
}

/** The deadline of the current step (the earliest of its people's SLA clocks); `null` when nothing is due. */
export interface TicketSlaResponse {
  readonly dueAt: string;
  /** Past `dueAt`; a paused clock counts as late only if it already was when it was paused. */
  readonly overdue: boolean;
  /** An incident stopped the clock: `dueAt` moves when it resumes. */
  readonly paused: boolean;
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
  readonly priorityId: string | null;
  readonly createdAt: string;
  readonly closedAt: string | null;
  /** The caller's own tags on this ticket (nobody else's). */
  readonly tags: readonly TagResponse[];
  readonly creator: NamedRefResponse;
  readonly subcategory: NamedRefResponse & { readonly category: NamedRefResponse };
  readonly currentStep: NamedRefResponse | null;
  readonly priority: (NamedRefResponse & { readonly color: string | null }) | null;
  /** Who holds the current step now (empty when closed, parked on a WAIT block or awaiting dispatch). */
  readonly assignees: readonly TicketAssigneeResponse[];
  readonly sla: TicketSlaResponse | null;
}

const namedRefSchema = z.object({ id: uuidSchema, name: z.string() });

/** Parses `TicketSummaryResponse` (for the web client); `satisfies` keeps it in step with the interface. */
export const ticketSummaryResponseSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  title: z.string(),
  status: ticketStatusSchema,
  companyId: uuidSchema,
  creatorId: uuidSchema,
  subcategoryId: uuidSchema,
  currentStepId: uuidSchema.nullable(),
  priorityId: uuidSchema.nullable(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  tags: z.array(tagResponseSchema),
  creator: namedRefSchema,
  subcategory: namedRefSchema.extend({ category: namedRefSchema }),
  currentStep: namedRefSchema.nullable(),
  priority: namedRefSchema.extend({ color: z.string().nullable() }).nullable(),
  assignees: z.array(z.object({ userId: uuidSchema, name: z.string(), type: assigneeTypeSchema, assignedAt: z.string() })),
  sla: z.object({ dueAt: z.string(), overdue: z.boolean(), paused: z.boolean() }).nullable(),
}) satisfies z.ZodType<TicketSummaryResponse>;

export const ticketPageResponseSchema = pageResponseSchema(ticketSummaryResponseSchema);

export interface TicketDetailResponse extends TicketSummaryResponse {
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly registeredById: string | null;
  readonly descriptionHtml: string;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  readonly currentLoop: number;
  readonly closedById: string | null;
  /** The visit callers must echo back (`visitId`) when they act on the ticket; `null` once closed. */
  readonly openVisit: { readonly id: string; readonly stepId: string; readonly loop: number; readonly enteredAt: string; readonly dueAt: string | null } | null;
  /** The incident that pauses the ticket, if any. */
  /** Open and with nobody holding it: it waits for the dispatch worker to hand it to someone. */
  readonly awaitingDispatch: boolean;
  /** The signatures of the current parallel step (empty on any other step). */
  readonly parallelTasks: ReadonlyArray<{ readonly id: string; readonly userId: string; readonly name: string; readonly status: 'PENDING' | 'SIGNED' | 'REJECTED' | 'CANCELLED'; readonly completedAt: string | null }>;
  readonly openIncident: {
    readonly id: string;
    readonly assignedToId: string;
    readonly createdById: string;
    readonly assignedTo: NamedRefResponse;
    readonly createdBy: NamedRefResponse;
    readonly openedAt: string;
    readonly descriptionHtml: string;
  } | null;
  /** When the ticket wakes up, while it is parked on a WAIT block (nobody can act on it until then). */
  readonly waitingUntil: string | null;
  readonly values: Readonly<Record<string, unknown>>;
  /** Totals of the TABLE columns that show one, by field code and column code (decimal text). */
  readonly totals: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly company: NamedRefResponse;
  /** Who registered the ticket on behalf of its creator; `null` when the creator did it. */
  readonly registeredBy: NamedRefResponse | null;
  readonly closedBy: NamedRefResponse | null;
  readonly department: NamedRefResponse | null;
  readonly site: NamedRefResponse | null;
  readonly valueNames: TicketValueNamesResponse;
  /** What the caller may do on the ticket right now, so the web offers only what the API would accept. */
  readonly actions: TicketActionsResponse;
}

/**
 * The ticket actions the caller may take now: permission (CASL, per record) and the ticket's state together, the same
 * checks the action routes make. A hint for the interface; the routes still decide.
 */
export interface TicketActionsResponse {
  /** `POST /tickets/:id/transition`: holds the open visit (or may act on it) and the step has decisions. */
  readonly advance: boolean;
  /** `POST /tickets/:id/take`: an open visit of a pool the caller belongs to (a ticket awaiting dispatch is not a pool: nobody takes it). */
  readonly take: boolean;
  /** `POST /tickets/:id/reassign` (on a parallel step, while a signature is still pending to be moved). */
  readonly reassign: boolean;
  /** `POST /tickets/:id/close`: the step's close rule allows it. */
  readonly close: boolean;
  /** `POST /tickets/:id/incidents`: open ticket without an open incident. */
  readonly openIncident: boolean;
  /** `POST /tickets/:id/incidents/:incidentId/resolve`: the open incident is the caller's to resolve. */
  readonly resolveIncident: boolean;
  /** `POST /tickets/:id/reopen`: closed ticket. */
  readonly reopen: boolean;
  /** `POST /tickets/:id/parallel-tasks/sign|reject`: the caller has a pending parallel task on the current step. */
  readonly signParallelTask: boolean;
  /** `POST /tickets/:id/comments`. */
  readonly comment: boolean;
  /** `POST /tickets/:id/errors`: open ticket on a step, and the caller may report errors on it. */
  readonly reportError: boolean;
  /** `PATCH /tickets/:id`: the ticket is not closed and the caller may edit it. */
  readonly edit: boolean;
}

/** `GET /tickets/:id/candidates?for=reassign|incident`: who the current step can go to, or who can take an incident. */
export const TICKET_CANDIDATE_PURPOSES = ['reassign', 'incident'] as const;
export const ticketCandidatesQuerySchema = z.object({ for: z.enum(TICKET_CANDIDATE_PURPOSES) });
export type TicketCandidatesQuery = z.infer<typeof ticketCandidatesQuerySchema>;

/**
 * Names of the people and sites that `values` points to (USER and SITE fields, and SELECT/MULTI_SELECT fields whose
 * preset is USERS or SITES), by id exactly as it appears in `values`. An id missing here does not name anything the
 * tenant has (removed member, deleted site): show it as unknown.
 */
export interface TicketValueNamesResponse {
  readonly users: Readonly<Record<string, string>>;
  readonly sites: Readonly<Record<string, string>>;
  /** Entries of the COMPANIES, DEPARTMENTS and POSITIONS presets. */
  readonly companies: Readonly<Record<string, string>>;
  readonly departments: Readonly<Record<string, string>>;
  readonly positions: Readonly<Record<string, string>>;
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
  /** Who did it; `null` for the system (automatic blocks, workers). */
  readonly actor: NamedRefResponse | null;
  /** Whom it was handed to, when the event assigns someone. */
  readonly assignee: NamedRefResponse | null;
  readonly step: NamedRefResponse | null;
  /** The transition taken, named by its label. */
  readonly transition: NamedRefResponse | null;
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

/** Parses `TicketDetailResponse` (for the web client). */
export const ticketDetailResponseSchema = ticketSummaryResponseSchema.extend({
  workflowId: uuidSchema,
  workflowVersionId: uuidSchema,
  registeredById: uuidSchema.nullable(),
  descriptionHtml: z.string(),
  departmentId: uuidSchema.nullable(),
  siteId: uuidSchema.nullable(),
  currentLoop: z.number(),
  closedById: uuidSchema.nullable(),
  openVisit: z.object({ id: uuidSchema, stepId: uuidSchema, loop: z.number(), enteredAt: z.string(), dueAt: z.string().nullable() }).nullable(),
  awaitingDispatch: z.boolean(),
  parallelTasks: z.array(z.object({ id: uuidSchema, userId: uuidSchema, name: z.string(), status: z.enum(['PENDING', 'SIGNED', 'REJECTED', 'CANCELLED']), completedAt: z.string().nullable() })),
  openIncident: z
    .object({ id: uuidSchema, assignedToId: uuidSchema, createdById: uuidSchema, assignedTo: namedRefSchema, createdBy: namedRefSchema, openedAt: z.string(), descriptionHtml: z.string() })
    .nullable(),
  waitingUntil: z.string().nullable(),
  values: z.record(z.string(), z.unknown()),
  totals: z.record(z.string(), z.record(z.string(), z.string())),
  company: namedRefSchema,
  registeredBy: namedRefSchema.nullable(),
  closedBy: namedRefSchema.nullable(),
  department: namedRefSchema.nullable(),
  site: namedRefSchema.nullable(),
  valueNames: z.object({
    users: z.record(z.string(), z.string()),
    sites: z.record(z.string(), z.string()),
    companies: z.record(z.string(), z.string()),
    departments: z.record(z.string(), z.string()),
    positions: z.record(z.string(), z.string()),
  }),
  actions: z.object({
    advance: z.boolean(),
    take: z.boolean(),
    reassign: z.boolean(),
    close: z.boolean(),
    openIncident: z.boolean(),
    resolveIncident: z.boolean(),
    reopen: z.boolean(),
    signParallelTask: z.boolean(),
    comment: z.boolean(),
    reportError: z.boolean(),
    edit: z.boolean(),
  }),
}) satisfies z.ZodType<TicketDetailResponse>;

/** Parses `TicketEventResponse` (for the web client). */
export const ticketEventResponseSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  stepId: uuidSchema.nullable(),
  transitionId: uuidSchema.nullable(),
  loop: z.number(),
  actorId: uuidSchema.nullable(),
  assigneeId: uuidSchema.nullable(),
  commentHtml: z.string().nullable(),
  data: z.unknown(),
  createdAt: z.string(),
  actor: namedRefSchema.nullable(),
  assignee: namedRefSchema.nullable(),
  step: namedRefSchema.nullable(),
  transition: namedRefSchema.nullable(),
}) satisfies z.ZodType<TicketEventResponse>;

export const ticketTimelineResponseSchema = z.array(ticketEventResponseSchema);

/** Parses the `GET /tickets/:id/candidates` answer (for the web client): people by name, ordered by name. */
export const ticketCandidatesResponseSchema = z.array(namedRefSchema) satisfies z.ZodType<readonly NamedRefResponse[]>;
