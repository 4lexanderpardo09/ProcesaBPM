import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import { type AiFormatJob, type AiFormatTaskKind, type AiJobHistoryItem, type AiJobResponse, type AiJobSummary, type AiTaskKind, type AiUsageDay, type AiUsageToday, aiDraftPreviewSchema, aiDraftResultSchema, aiFormatResultSchema, isFormatTaskKind, type PdfCanvasDesign } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface NewDraftJob {
  readonly kind: AiTaskKind;
  readonly tenantId: string;
  readonly requestedById: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  /** The process description, or the change asked of the current draft. */
  readonly description: string;
  readonly model: string;
}

export interface NewFormatJob {
  readonly kind: AiFormatTaskKind;
  readonly tenantId: string;
  readonly requestedById: string;
  readonly workflowId: string;
  readonly formatId: string;
  readonly description: string;
  /** A change: the design on screen it starts from. */
  readonly basis?: PdfCanvasDesign;
  readonly model: string;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const JOB_COLUMNS = { id: true, kind: true, status: true, stage: true, round: true, problems: true, preview: true, errorCode: true, result: true, createdAt: true, startedAt: true, completedAt: true } as const;
type JobRow = Prisma.AiJobGetPayload<{ select: typeof JOB_COLUMNS }>;
const PERSON = { select: { user: { select: { firstName: true, lastName: true } } } } as const;
const fullName = (person: { user: { firstName: string; lastName: string } }): string => `${person.user.firstName} ${person.user.lastName}`.trim();
const descriptionOf = (input: Prisma.JsonValue): string | null => {
  const description = (input as { description?: unknown } | null)?.description;
  return typeof description === 'string' ? description : null;
};

function jobResponse(job: JobRow): AiJobResponse {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    stage: job.stage,
    round: job.round,
    problems: job.problems,
    errorCode: job.errorCode,
    preview: job.preview === null ? null : (aiDraftPreviewSchema.safeParse(job.preview).data ?? null),
    // Parsed so requests finished before a field existed read with its default. A format's result (its design) is read
    // only by the format's own history.
    result: job.result === null || isFormatTaskKind(job.kind) ? null : aiDraftResultSchema.parse(job.result),
    createdAt: job.createdAt.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
  };
}

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
        kind: job.kind,
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

  async createFormatJob(tx: TenantTransaction, job: NewFormatJob): Promise<string> {
    const created = await tx.aiJob.create({
      data: {
        tenantId: job.tenantId,
        kind: job.kind,
        requestedById: job.requestedById,
        workflowId: job.workflowId,
        formatId: job.formatId,
        input: job.basis === undefined ? { description: job.description } : { description: job.description, basis: job.basis },
        inputChars: job.description.length,
        model: job.model,
      },
      select: { id: true },
    });
    return created.id;
  }

  async activeJobForFormat(tx: TenantTransaction, tenantId: string, formatId: string): Promise<string | null> {
    const job = await tx.aiJob.findFirst({ where: { tenantId, formatId, status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
    return job?.id ?? null;
  }

  /** The newest requests of a format, with the design each one produced, oldest first. */
  async formatHistoryOf(tx: TenantTransaction, tenantId: string, formatId: string, limit: number): Promise<AiFormatJob[]> {
    const jobs = await tx.aiJob.findMany({
      where: { tenantId, formatId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { ...JOB_COLUMNS, input: true, requestedById: true, requestedBy: PERSON, cancelledBy: PERSON },
    });
    const tokens = await this.tokensByJob(tx, tenantId, jobs.map((job) => job.id));
    return jobs.reverse().map((job) => {
      const { preview: _preview, result: _result, ...response } = jobResponse(job);
      return {
        ...response,
        result: job.result === null ? null : (aiFormatResultSchema.safeParse(job.result).data ?? null),
        description: descriptionOf(job.input),
        requestedById: job.requestedById,
        requesterName: fullName(job.requestedBy),
        cancelledByName: job.cancelledBy === null ? null : fullName(job.cancelledBy),
        tokens: tokens.get(job.id) ?? 0,
      };
    });
  }

  async activeJobFor(tx: TenantTransaction, tenantId: string, versionId: string): Promise<string | null> {
    const job = await tx.aiJob.findFirst({ where: { tenantId, versionId, status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
    return job?.id ?? null;
  }

  async findJob(tx: TenantTransaction, tenantId: string, id: string): Promise<(AiJobResponse & { workflowId: string | null; versionId: string | null }) | undefined> {
    const job = await tx.aiJob.findUnique({ where: { tenantId_id: { tenantId, id } }, select: { ...JOB_COLUMNS, workflowId: true, versionId: true } });
    return job === null ? undefined : { ...jobResponse(job), workflowId: job.workflowId, versionId: job.versionId };
  }

  /** The newest requests of a draft with what was asked, by whom and what they cost, oldest first. */
  async historyOf(tx: TenantTransaction, tenantId: string, versionId: string, limit: number): Promise<AiJobHistoryItem[]> {
    const jobs = await tx.aiJob.findMany({
      where: { tenantId, versionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { ...JOB_COLUMNS, input: true, requestedById: true, requestedBy: PERSON, cancelledBy: PERSON },
    });
    const tokens = await this.tokensByJob(tx, tenantId, jobs.map((job) => job.id));
    return jobs.reverse().map((job) => ({
      ...jobResponse(job),
      description: descriptionOf(job.input),
      requestedById: job.requestedById,
      requesterName: fullName(job.requestedBy),
      cancelledByName: job.cancelledBy === null ? null : fullName(job.cancelledBy),
      tokens: tokens.get(job.id) ?? 0,
    }));
  }

  /** Cancels an open request of the tenant in context for the member in context (cancel_ai_job). `false`: nothing open to cancel. */
  async cancel(tx: TenantTransaction, jobId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT cancel_ai_job(${jobId}::uuid) AS ok`;
    return row?.ok === true;
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
        requestedBy: PERSON,
      },
    });
    const tokens = await this.tokensByJob(tx, tenantId, jobs.map((job) => job.id));
    return jobs.map((job) => ({
      id: job.id,
      status: job.status,
      errorCode: job.errorCode,
      requesterName: fullName(job.requestedBy),
      model: job.model,
      tokens: tokens.get(job.id) ?? 0,
      createdAt: job.createdAt.toISOString(),
      completedAt: iso(job.completedAt),
    }));
  }

  /** Prompt plus completion tokens per request, joined by column: the ledger has no foreign key to its request (it outlives it). */
  private async tokensByJob(tx: TenantTransaction, tenantId: string, jobIds: string[]): Promise<Map<string, number>> {
    if (jobIds.length === 0) return new Map();
    const sums = await tx.aiUsage.groupBy({ by: ['jobId'], where: { tenantId, jobId: { in: jobIds } }, _sum: { promptTokens: true, completionTokens: true } });
    return new Map(sums.map((sum) => [sum.jobId, (sum._sum.promptTokens ?? 0) + (sum._sum.completionTokens ?? 0)]));
  }
}
