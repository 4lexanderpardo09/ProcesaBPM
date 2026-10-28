import { z } from 'zod';
import { DRAFT_LOSS_SUBJECTS } from '../../workflow/draft-spec/spec-from-document.js';
import { DRAFT_DECISION_TOPICS } from '../../workflow/draft-spec/spec.js';

/**
 * The version of the transfer notice an administrator accepts when turning the assistant on (descriptions go to the
 * AI provider, abroad). Raise it when the text changes: turning it on again asks for the new one. An organization
 * already on stays on (the version is checked only when turning it on). 2: descriptions are kept 90 days.
 */
export const AI_NOTICE_VERSION = 2;
export const AI_DESCRIPTION_LIMITS = { min: 20, max: 8_000 } as const;
/** A change asked of an existing draft can be short («quita el aviso»). */
export const AI_REVISION_LIMITS = { min: 5, max: AI_DESCRIPTION_LIMITS.max } as const;

/** What a request asks: a new draft from a description, or a change to the current draft. */
export const AI_DRAFT_MODES = ['CREATE', 'REVISE'] as const;
export type AiDraftMode = (typeof AI_DRAFT_MODES)[number];
/** `ai_jobs.kind`: one per mode. */
export const AI_TASK_KINDS = ['WORKFLOW_DRAFT', 'WORKFLOW_DRAFT_REVISION'] as const;
export type AiTaskKind = (typeof AI_TASK_KINDS)[number];
export const AI_TASK_KIND_OF_MODE: Readonly<Record<AiDraftMode, AiTaskKind>> = { CREATE: 'WORKFLOW_DRAFT', REVISE: 'WORKFLOW_DRAFT_REVISION' };

export const updateAiAssistantSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Required to turn it on: the notice the administrator read. */
    acceptedNoticeVersion: z.number().int().optional(),
  })
  .strict()
  .refine((value) => !value.enabled || value.acceptedNoticeVersion === AI_NOTICE_VERSION, { message: 'Turning the assistant on requires accepting the current notice', path: ['acceptedNoticeVersion'] });
export type UpdateAiAssistantSettings = z.infer<typeof updateAiAssistantSettingsSchema>;

export const aiDailyLimitsSchema = z.object({ jobsPerDay: z.number().int(), tokensPerDay: z.number().int() });
export type AiDailyLimits = z.infer<typeof aiDailyLimitsSchema>;

export const aiUsageTodaySchema = z.object({ jobs: z.number().int(), tokens: z.number().int() });
export type AiUsageToday = z.infer<typeof aiUsageTodaySchema>;

export const aiAssistantSettingsResponseSchema = z.object({
  /** Whether the platform offers the assistant at all (configured by the operator). */
  available: z.boolean(),
  enabled: z.boolean(),
  noticeVersion: z.number().int(),
  limits: aiDailyLimitsSchema,
  today: aiUsageTodaySchema,
});
export type AiAssistantSettingsResponse = z.infer<typeof aiAssistantSettingsResponseSchema>;

export const aiUsageQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).strict();
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

export const AI_JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/**
 * What a running request is doing: reading the catalog, waiting for the model's answer in round n, checking that
 * answer (k problems go back to the model), writing the draft. The last one stays when the request ends.
 */
export const AI_JOB_STAGES = ['READING', 'DESIGNING', 'REVIEWING', 'WRITING'] as const;
export type AiJobStage = (typeof AI_JOB_STAGES)[number];

/** `error_code` of a request someone cancelled (`FAILED`). */
export const AI_JOB_CANCELLED = 'CANCELLED';

export const aiUsageDaySchema = z.object({
  /** Day in the organization's time zone (YYYY-MM-DD). */
  date: z.string(),
  model: z.string(),
  calls: z.number().int(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  reasoningTokens: z.number().int(),
});
export type AiUsageDay = z.infer<typeof aiUsageDaySchema>;

export const aiJobSummarySchema = z.object({
  id: z.string(),
  status: z.enum(AI_JOB_STATUSES),
  errorCode: z.string().nullable(),
  requesterName: z.string(),
  model: z.string(),
  tokens: z.number().int(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AiJobSummary = z.infer<typeof aiJobSummarySchema>;

export const aiUsageResponseSchema = z.object({ days: z.array(aiUsageDaySchema), recentJobs: z.array(aiJobSummarySchema) });
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;

export const aiAvailabilityQuerySchema = z.object({ versionId: z.uuid() }).strict();
export type AiAvailabilityQuery = z.infer<typeof aiAvailabilityQuerySchema>;

export const aiAvailabilityResponseSchema = z.object({
  /** The platform offers it and the organization turned it on. */
  available: z.boolean(),
  remainingJobsToday: z.number().int(),
  /** A request still running for this draft (the builder picks it up when it opens). */
  activeJobId: z.string().nullable(),
});
export type AiAvailabilityResponse = z.infer<typeof aiAvailabilityResponseSchema>;

export const requestAiDraftSchema = z
  .object({
    /** CREATE (the default) replaces the draft with a new one; REVISE changes the current draft as the description asks. */
    mode: z.enum(AI_DRAFT_MODES).default('CREATE'),
    /** The process description, or the change asked (REVISE). */
    description: z.string().trim().max(AI_DESCRIPTION_LIMITS.max),
    /** The revision of the draft the person is looking at: a draft edited since then is not overwritten. */
    revision: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, context) => {
    const min = value.mode === 'REVISE' ? AI_REVISION_LIMITS.min : AI_DESCRIPTION_LIMITS.min;
    if (value.description.length < min) context.addIssue({ code: 'too_small', origin: 'string', minimum: min, inclusive: true, path: ['description'], message: `Too small: expected at least ${min} characters` });
  });
export type RequestAiDraft = z.infer<typeof requestAiDraftSchema>;

export const aiDraftRequestedSchema = z.object({ jobId: z.string() });
export type AiDraftRequested = z.infer<typeof aiDraftRequestedSchema>;

export const aiDraftOutlineSchema = z.object({
  /** Blocks other than the start and the ends. */
  steps: z.number().int(),
  approvals: z.number().int(),
  fields: z.number().int(),
  initiators: z.number().int(),
  amountRules: z.number().int(),
});
export type AiDraftOutline = z.infer<typeof aiDraftOutlineSchema>;

export const aiDraftResultSchema = z.object({
  revision: z.number().int(),
  /** What the assistant decided on its own (Spanish sentences shown to the person). */
  assumptions: z.array(z.string()),
  /** The main design choices, by topic. Empty on requests finished before they were asked for. */
  decisions: z.array(z.object({ topic: z.enum(DRAFT_DECISION_TOPICS), text: z.string() })).default([]),
  /** What the draft holds, counted by the platform (not by the model). Null on older requests. */
  outline: aiDraftOutlineSchema.nullable().default(null),
  /** Problems the review found in earlier answers and sent back to the model. */
  corrections: z.number().int().default(0),
  rounds: z.number().int(),
  /** Problems left in the draft for the person to fix (it is never published by the assistant). */
  errors: z.number().int(),
  warnings: z.number().int(),
});
export type AiDraftResult = z.infer<typeof aiDraftResultSchema>;

export const aiJobResponseSchema = z.object({
  id: z.string(),
  kind: z.enum(AI_TASK_KINDS),
  status: z.enum(AI_JOB_STATUSES),
  stage: z.enum(AI_JOB_STAGES).nullable(),
  /** The round of the stage (1..AI_MAX_ROUNDS), when it has one. */
  round: z.number().int().nullable(),
  /** Problems found in the answer of that round (REVIEWING). */
  problems: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  result: aiDraftResultSchema.nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type AiJobResponse = z.infer<typeof aiJobResponseSchema>;

export const AI_JOB_HISTORY_LIMITS = { default: 20, max: 50 } as const;

export const aiJobHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(AI_JOB_HISTORY_LIMITS.max).default(AI_JOB_HISTORY_LIMITS.default) }).strict();
export type AiJobHistoryQuery = z.infer<typeof aiJobHistoryQuerySchema>;

/** One request in the history of a draft: what was asked, by whom, and how it went. */
export const aiJobHistoryItemSchema = aiJobResponseSchema.extend({
  /** What the person wrote (kept 90 days inside the organization); null for a request made before it was kept. */
  description: z.string().nullable(),
  requestedById: z.string(),
  requesterName: z.string(),
  cancelledByName: z.string().nullable(),
  /** Prompt plus completion tokens of its calls. */
  tokens: z.number().int(),
});
export type AiJobHistoryItem = z.infer<typeof aiJobHistoryItemSchema>;

/** The newest requests of a draft, oldest first (read like a conversation). */
export const aiJobHistoryResponseSchema = z.object({ jobs: z.array(aiJobHistoryItemSchema) });
export type AiJobHistoryResponse = z.infer<typeof aiJobHistoryResponseSchema>;

export const draftSpecLossSchema = z.object({ subject: z.enum(DRAFT_LOSS_SUBJECTS), name: z.string(), properties: z.array(z.string()) });

/** `details` of a 422 AI_DRAFT_NOT_REVISABLE: what of the draft a revision would lose. */
export const aiDraftNotRevisableDetailsSchema = z.object({ losses: z.array(draftSpecLossSchema) });
export type AiDraftNotRevisableDetails = z.infer<typeof aiDraftNotRevisableDetailsSchema>;
