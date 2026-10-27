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

export interface AiDailyLimits {
  readonly jobsPerDay: number;
  readonly tokensPerDay: number;
}

export interface AiUsageToday {
  readonly jobs: number;
  readonly tokens: number;
}

export interface AiAssistantSettingsResponse {
  /** Whether the platform offers the assistant at all (configured by the operator). */
  readonly available: boolean;
  readonly enabled: boolean;
  readonly noticeVersion: number;
  readonly limits: AiDailyLimits;
  readonly today: AiUsageToday;
}

export const aiUsageQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).strict();
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

export interface AiUsageDay {
  /** Day in the organization's time zone (YYYY-MM-DD). */
  readonly date: string;
  readonly model: string;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
}

export const AI_JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export interface AiJobSummary {
  readonly id: string;
  readonly status: AiJobStatus;
  readonly errorCode: string | null;
  readonly requesterName: string;
  readonly model: string;
  readonly tokens: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface AiUsageResponse {
  readonly days: readonly AiUsageDay[];
  readonly recentJobs: readonly AiJobSummary[];
}

export const aiAvailabilityQuerySchema = z.object({ versionId: z.uuid() }).strict();
export type AiAvailabilityQuery = z.infer<typeof aiAvailabilityQuerySchema>;

export interface AiAvailabilityResponse {
  /** The platform offers it and the organization turned it on. */
  readonly available: boolean;
  readonly remainingJobsToday: number;
  /** A request still running for this draft (the builder picks it up when it opens). */
  readonly activeJobId: string | null;
}

export const requestAiDraftSchema = z
  .object({
    description: z.string().trim().min(AI_DESCRIPTION_LIMITS.min).max(AI_DESCRIPTION_LIMITS.max),
    /** The revision of the draft the person is looking at: a draft edited since then is not overwritten. */
    revision: z.number().int().min(0),
  })
  .strict();
export type RequestAiDraft = z.infer<typeof requestAiDraftSchema>;

export interface AiDraftResult {
  readonly revision: number;
  /** What the assistant decided on its own (Spanish sentences shown to the person). */
  readonly assumptions: readonly string[];
  readonly rounds: number;
  /** Problems left in the draft for the person to fix (it is never published by the assistant). */
  readonly errors: number;
  readonly warnings: number;
}

export interface AiJobResponse {
  readonly id: string;
  readonly status: AiJobStatus;
  readonly errorCode: string | null;
  readonly result: AiDraftResult | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}
