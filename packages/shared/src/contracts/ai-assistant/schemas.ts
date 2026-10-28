import { z } from 'zod';

/**
 * The version of the transfer notice an administrator accepts when turning the assistant on (descriptions go to the
 * AI provider, abroad). Raise it when the text changes: turning it on again asks for the new one.
 */
export const AI_NOTICE_VERSION = 1;
export const AI_DESCRIPTION_LIMITS = { min: 20, max: 8_000 } as const;

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
    description: z.string().trim().min(AI_DESCRIPTION_LIMITS.min).max(AI_DESCRIPTION_LIMITS.max),
    /** The revision of the draft the person is looking at: a draft edited since then is not overwritten. */
    revision: z.number().int().min(0),
  })
  .strict();
export type RequestAiDraft = z.infer<typeof requestAiDraftSchema>;

export const aiDraftRequestedSchema = z.object({ jobId: z.string() });
export type AiDraftRequested = z.infer<typeof aiDraftRequestedSchema>;

export const aiDraftResultSchema = z.object({
  revision: z.number().int(),
  /** What the assistant decided on its own (Spanish sentences shown to the person). */
  assumptions: z.array(z.string()),
  rounds: z.number().int(),
  /** Problems left in the draft for the person to fix (it is never published by the assistant). */
  errors: z.number().int(),
  warnings: z.number().int(),
});
export type AiDraftResult = z.infer<typeof aiDraftResultSchema>;

export const aiJobResponseSchema = z.object({
  id: z.string(),
  status: z.enum(AI_JOB_STATUSES),
  errorCode: z.string().nullable(),
  result: aiDraftResultSchema.nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type AiJobResponse = z.infer<typeof aiJobResponseSchema>;
