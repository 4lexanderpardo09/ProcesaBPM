import { Injectable } from '@nestjs/common';
import { AI_TASK_KINDS, type AiFormatImage, aiFormatImageSchema, type AiFormatTaskKind, type AiTaskKind, aiDraftResultSchema, aiFormatResultSchema, isFormatTaskKind } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { LlmUsage } from '../../../infrastructure/llm/llm-provider.js';

export interface DraftJobInput {
  readonly kind: AiTaskKind;
  readonly createdAt: Date;
  readonly requestedById: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly description: string;
  readonly enabled: boolean;
}

/** A format request: the format it is for and, for a change, the design on screen when it was asked. */
export interface FormatJobInput {
  readonly kind: AiFormatTaskKind;
  readonly createdAt: Date;
  readonly requestedById: string;
  readonly workflowId: string;
  readonly formatId: string;
  readonly description: string;
  /** Stored JSON: parsed with the canvas schema before it is used. */
  readonly basis: unknown;
  /** Pictures of a paper format (the ones that still read as such). */
  readonly images: readonly AiFormatImage[];
  readonly enabled: boolean;
}

/** An earlier request on the same draft, for the context of a revision. */
export interface PastRequest {
  readonly kind: AiTaskKind;
  readonly message: string;
  /** It changed the draft (SUCCEEDED). */
  readonly applied: boolean;
  /** What the model said it decided or changed (empty when not applied). */
  readonly decisions: readonly string[];
}

export interface UsageEntry {
  readonly taskKind: AiTaskKind;
  readonly tenantId: string;
  readonly jobId: string;
  readonly userId: string;
  readonly provider: string;
  readonly model: string;
  readonly jobAttempt: number;
  readonly round: number;
  readonly usage: LlmUsage;
  readonly durationMs: number;
  readonly outcome: 'OK' | 'TOOL_NOT_CALLED' | 'INVALID_OUTPUT' | 'PROVIDER_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'ABORTED';
  readonly errorCode: string | null;
}

const descriptionOf = (input: unknown): string | null => {
  const description = (input as { description?: unknown } | null)?.description;
  return typeof description === 'string' ? description : null;
};

/** What the worker reads and records for one request, inside the tenant's transaction (RLS applies). */
@Injectable()
export class AiJobWorkRepository {
  async draftInput(tx: TenantTransaction, tenantId: string, jobId: string): Promise<DraftJobInput | undefined> {
    const job = await tx.aiJob.findUnique({
      where: { tenantId_id: { tenantId, id: jobId } },
      select: { kind: true, createdAt: true, requestedById: true, workflowId: true, versionId: true, expectedRevision: true, input: true, tenant: { select: { aiAssistantEnabled: true } } },
    });
    const description = descriptionOf(job?.input ?? null);
    if (job === null || !AI_TASK_KINDS.includes(job.kind) || job.workflowId === null || job.versionId === null || job.expectedRevision === null || description === null) return undefined;
    return { kind: job.kind, createdAt: job.createdAt, requestedById: job.requestedById, workflowId: job.workflowId, versionId: job.versionId, expectedRevision: job.expectedRevision, description, enabled: job.tenant.aiAssistantEnabled };
  }

  async kindOf(tx: TenantTransaction, tenantId: string, jobId: string): Promise<AiTaskKind | undefined> {
    const job = await tx.aiJob.findUnique({ where: { tenantId_id: { tenantId, id: jobId } }, select: { kind: true } });
    return job?.kind;
  }

  async formatInput(tx: TenantTransaction, tenantId: string, jobId: string): Promise<FormatJobInput | undefined> {
    const job = await tx.aiJob.findUnique({
      where: { tenantId_id: { tenantId, id: jobId } },
      select: { kind: true, createdAt: true, requestedById: true, workflowId: true, formatId: true, input: true, tenant: { select: { aiAssistantEnabled: true } } },
    });
    const description = descriptionOf(job?.input ?? null);
    if (job === null || !isFormatTaskKind(job.kind) || job.workflowId === null || job.formatId === null || description === null) return undefined;
    const stored = job.input as { basis?: unknown; images?: unknown } | null;
    const images = Array.isArray(stored?.images) ? stored.images.flatMap((image) => aiFormatImageSchema.safeParse(image).data ?? []) : [];
    return { kind: job.kind, createdAt: job.createdAt, requestedById: job.requestedById, workflowId: job.workflowId, formatId: job.formatId, description, basis: stored?.basis ?? null, images, enabled: job.tenant.aiAssistantEnabled };
  }

  /** The finished requests of a format made before `before` (newest `limit`, oldest first). */
  async pastFormatRequests(tx: TenantTransaction, tenantId: string, formatId: string, before: { readonly id: string; readonly createdAt: Date }, limit: number): Promise<PastRequest[]> {
    const jobs = await tx.aiJob.findMany({
      where: { tenantId, formatId, status: { in: ['SUCCEEDED', 'FAILED'] }, id: { not: before.id }, createdAt: { lte: before.createdAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { kind: true, status: true, input: true, result: true },
    });
    return jobs.reverse().flatMap((job) => {
      const message = descriptionOf(job.input);
      if (message === null) return [];
      const result = job.status === 'SUCCEEDED' ? aiFormatResultSchema.safeParse(job.result) : undefined;
      return [{ kind: job.kind, message, applied: job.status === 'SUCCEEDED', decisions: result?.success === true ? result.data.decisions.map((decision) => decision.text) : [] }];
    });
  }

  /** The finished requests of a draft made before `before` (newest `limit`, oldest first). */
  async pastRequests(tx: TenantTransaction, tenantId: string, versionId: string, before: { readonly id: string; readonly createdAt: Date }, limit: number): Promise<PastRequest[]> {
    const jobs = await tx.aiJob.findMany({
      where: { tenantId, versionId, status: { in: ['SUCCEEDED', 'FAILED'] }, id: { not: before.id }, createdAt: { lte: before.createdAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { kind: true, status: true, input: true, result: true },
    });
    return jobs.reverse().flatMap((job) => {
      const message = descriptionOf(job.input);
      if (message === null) return [];
      const result = job.status === 'SUCCEEDED' ? aiDraftResultSchema.safeParse(job.result) : undefined;
      return [{ kind: job.kind, message, applied: job.status === 'SUCCEEDED', decisions: result?.success === true ? result.data.decisions.map((decision) => decision.text) : [] }];
    });
  }

  async recordUsage(tx: TenantTransaction, entry: UsageEntry): Promise<void> {
    await tx.aiUsage.create({
      data: {
        tenantId: entry.tenantId,
        jobId: entry.jobId,
        userId: entry.userId,
        taskKind: entry.taskKind,
        provider: entry.provider,
        model: entry.model,
        jobAttempt: entry.jobAttempt,
        round: entry.round,
        promptTokens: entry.usage.promptTokens,
        cachedPromptTokens: entry.usage.cachedPromptTokens,
        completionTokens: entry.usage.completionTokens,
        reasoningTokens: entry.usage.reasoningTokens,
        durationMs: entry.durationMs,
        outcome: entry.outcome,
        errorCode: entry.errorCode,
      },
      select: { id: true },
    });
  }
}
