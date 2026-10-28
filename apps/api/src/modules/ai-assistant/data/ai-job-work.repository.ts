import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { LlmUsage } from '../../../infrastructure/llm/llm-provider.js';

export interface DraftJobInput {
  readonly requestedById: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly description: string;
  readonly enabled: boolean;
}

export interface UsageEntry {
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

/** What the worker reads and records for one request, inside the tenant's transaction (RLS applies). */
@Injectable()
export class AiJobWorkRepository {
  async draftInput(tx: TenantTransaction, tenantId: string, jobId: string): Promise<DraftJobInput | undefined> {
    const job = await tx.aiJob.findUnique({
      where: { tenantId_id: { tenantId, id: jobId } },
      select: { kind: true, requestedById: true, workflowId: true, versionId: true, expectedRevision: true, input: true, tenant: { select: { aiAssistantEnabled: true } } },
    });
    const description = (job?.input as { description?: unknown } | null)?.description;
    if (job === null || job.kind !== 'WORKFLOW_DRAFT' || job.workflowId === null || job.versionId === null || job.expectedRevision === null || typeof description !== 'string') return undefined;
    return { requestedById: job.requestedById, workflowId: job.workflowId, versionId: job.versionId, expectedRevision: job.expectedRevision, description, enabled: job.tenant.aiAssistantEnabled };
  }

  async recordUsage(tx: TenantTransaction, entry: UsageEntry): Promise<void> {
    await tx.aiUsage.create({
      data: {
        tenantId: entry.tenantId,
        jobId: entry.jobId,
        userId: entry.userId,
        taskKind: 'WORKFLOW_DRAFT',
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
