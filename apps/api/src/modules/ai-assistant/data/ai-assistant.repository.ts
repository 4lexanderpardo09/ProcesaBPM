import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { AiDraftResult, AiJobResponse, AiJobSummary, AiUsageDay, AiUsageToday } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface NewDraftJob {
  readonly tenantId: string;
  readonly requestedById: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly description: string;
  readonly model: string;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** The organization's AI assistant: its switch, its requests and what they cost. Always inside the tenant's transaction. */
@Injectable()
export class AiAssistantRepository {
  async settingsOf(tx: TenantTransaction, tenantId: string): Promise<{ enabled: boolean; timeZone: string }> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { aiAssistantEnabled: true, timeZone: true } });
    return { enabled: tenant.aiAssistantEnabled, timeZone: tenant.timeZone };
  }

  async setEnabled(tx: TenantTransaction, tenantId: string, enabled: boolean): Promise<void> {
    await tx.tenant.update({ where: { id: tenantId }, data: { aiAssistantEnabled: enabled }, select: { id: true } });
  }

  /** Serializes the requests of one organization, so two at once cannot both pass the daily limit. */
  async lockQuota(tx: TenantTransaction, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-quota:${tenantId}`}, 0))`;
  }

  async usageSince(tx: TenantTransaction, tenantId: string, since: Date): Promise<AiUsageToday> {
    const [jobs, tokens] = await Promise.all([
      tx.aiJob.count({ where: { tenantId, createdAt: { gte: since } } }),
      tx.aiUsage.aggregate({ where: { tenantId, createdAt: { gte: since } }, _sum: { promptTokens: true, completionTokens: true } }),
    ]);
    return { jobs, tokens: (tokens._sum.promptTokens ?? 0) + (tokens._sum.completionTokens ?? 0) };
  }

  async createDraftJob(tx: TenantTransaction, job: NewDraftJob): Promise<string> {
    const created = await tx.aiJob.create({
      data: {
        tenantId: job.tenantId,
        kind: 'WORKFLOW_DRAFT',
        requestedById: job.requestedById,
        workflowId: job.workflowId,
        versionId: job.versionId,
        expectedRevision: job.expectedRevision,
        input: { description: job.description },
        inputChars: job.description.length,
        model: job.model,
      },
      select: { id: true },
    });
    return created.id;
  }

  async activeJobFor(tx: TenantTransaction, tenantId: string, versionId: string): Promise<string | null> {
    const job = await tx.aiJob.findFirst({ where: { tenantId, versionId, status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
    return job?.id ?? null;
  }

  async findJob(tx: TenantTransaction, tenantId: string, id: string): Promise<AiJobResponse | undefined> {
    const job = await tx.aiJob.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (job === null) return undefined;
    return {
      id: job.id,
      status: job.status,
      errorCode: job.errorCode,
      result: job.result as AiDraftResult | null,
      createdAt: job.createdAt.toISOString(),
      startedAt: iso(job.startedAt),
      completedAt: iso(job.completedAt),
    };
  }

  async usageByDay(tx: TenantTransaction, tenantId: string, since: Date, timeZone: string): Promise<AiUsageDay[]> {
    const rows = await tx.$queryRaw<Array<{ date: string; model: string; calls: bigint; prompt: bigint; completion: bigint; reasoning: bigint }>>(Prisma.sql`
      SELECT to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date, model, count(*) AS calls,
             sum(prompt_tokens) AS prompt, sum(completion_tokens) AS completion, sum(reasoning_tokens) AS reasoning
      FROM ai_usage WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${since}
      GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
    return rows.map((row) => ({ date: row.date, model: row.model, calls: Number(row.calls), promptTokens: Number(row.prompt), completionTokens: Number(row.completion), reasoningTokens: Number(row.reasoning) }));
  }

  async recentJobs(tx: TenantTransaction, tenantId: string, limit: number): Promise<AiJobSummary[]> {
    const jobs = await tx.aiJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        errorCode: true,
        model: true,
        createdAt: true,
        completedAt: true,
        requestedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
        usage: { select: { promptTokens: true, completionTokens: true } },
      },
    });
    return jobs.map((job) => ({
      id: job.id,
      status: job.status,
      errorCode: job.errorCode,
      requesterName: `${job.requestedBy.user.firstName} ${job.requestedBy.user.lastName}`.trim(),
      model: job.model,
      tokens: job.usage.reduce((sum, call) => sum + call.promptTokens + call.completionTokens, 0),
      createdAt: job.createdAt.toISOString(),
      completedAt: iso(job.completedAt),
    }));
  }
}
