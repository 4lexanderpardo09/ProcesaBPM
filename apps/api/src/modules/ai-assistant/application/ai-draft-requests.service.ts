import { Inject, Injectable } from '@nestjs/common';
import {
  AiAssistantDisabledError,
  type AiDraftRequested,
  type AiAvailabilityResponse,
  type AiJobHistoryQuery,
  type AiJobHistoryResponse,
  AiJobInProgressError,
  type AiJobResponse,
  hasSqlState,
  ImmutableDataError,
  InvalidStateError,
  NotFoundError,
  RateLimitedError,
  type RequestAiDraft,
  StaleRevisionError,
} from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { Clock } from '../../../infrastructure/clock.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RATE_LIMITER, type RateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { WorkflowRepository } from '../../workflows/data/workflow.repository.js';
import { AiAssistantRepository } from '../data/ai-assistant.repository.js';
import { assertWithinDailyLimit, quotaDay, remainingJobs } from '../domain/daily-quota.js';
import { dailyLimits } from './ai-settings.service.js';

type AiConfig = Pick<ApiConfig, 'AI_ASSISTANT_AVAILABLE' | 'AI_REASONING_MODEL' | 'AI_DAILY_JOBS_PER_TENANT' | 'AI_DAILY_TOKENS_PER_TENANT'>;

const UNIQUE_VIOLATION = '23505';
/** Per person, on top of the organization's daily limit: a burst of clicks does not queue a burst of paid calls. */
export const AI_DRAFT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 } as const;

/**
 * «Crear con IA»: records a request the worker turns into a draft (docs/arquitectura.md §22), and reports on it. Only
 * the request is written here; the description leaves the platform from the worker, never from the API.
 */
@Injectable()
export class AiDraftRequestsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AiAssistantRepository) private readonly assistant: AiAssistantRepository,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: AiConfig,
  ) {}

  availability(principal: Principal, versionId: string): Promise<AiAvailabilityResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const settings = await this.assistant.settingsOf(tx, principal.tenantId);
      const available = this.config.AI_ASSISTANT_AVAILABLE && settings.enabled;
      const today = await this.assistant.usageSince(tx, principal.tenantId, quotaDay(this.clock.now(), settings.timeZone).since);
      return { available, remainingJobsToday: available ? remainingJobs(dailyLimits(this.config), today) : 0, activeJobId: await this.assistant.activeJobFor(tx, principal.tenantId, versionId) };
    });
  }

  /**
   * The draft must still be the one the person sees (same revision), the organization must have the assistant on and
   * be inside its daily limit. Two requests for one draft at once: the database keeps one and the other gets 409.
   */
  async request(principal: Principal, workflowId: string, versionId: string, body: RequestAiDraft): Promise<AiDraftRequested> {
    if (!this.config.AI_ASSISTANT_AVAILABLE) throw new AiAssistantDisabledError();
    await this.enforceRate(principal.userId);
    try {
      return await this.runner.withTenantTransaction(async (tx) => {
        await this.assertDraftAt(tx, principal.tenantId, workflowId, versionId, body.revision);
        await this.assistant.lockQuota(tx, principal.tenantId);
        const settings = await this.assistant.settingsOf(tx, principal.tenantId);
        if (!settings.enabled) throw new AiAssistantDisabledError();
        const day = quotaDay(this.clock.now(), settings.timeZone);
        assertWithinDailyLimit(dailyLimits(this.config), await this.assistant.usageSince(tx, principal.tenantId, day.since), day);
        const jobId = await this.assistant.createDraftJob(tx, {
          tenantId: principal.tenantId,
          requestedById: principal.userId,
          workflowId,
          versionId,
          expectedRevision: body.revision,
          description: body.description,
          model: this.config.AI_REASONING_MODEL,
        });
        await this.audit.record(tx, { action: 'workflow.ai_draft_requested', subjectType: 'Workflow', subjectId: workflowId, after: { versionId, jobId, model: this.config.AI_REASONING_MODEL, inputChars: body.description.length } });
        return { jobId };
      });
    } catch (error) {
      if (hasSqlState(error, UNIQUE_VIOLATION)) throw new AiJobInProgressError({ cause: error });
      throw error;
    }
  }

  async job(principal: Principal, jobId: string): Promise<AiJobResponse> {
    const found = await this.runner.withTenantTransaction((tx) => this.assistant.findJob(tx, principal.tenantId, jobId));
    if (found === undefined) throw new NotFoundError();
    return withoutTarget(found);
  }

  /** The requests made for a draft (the builder's panel), with their descriptions: kept 90 days inside the organization. */
  history(principal: Principal, workflowId: string, versionId: string, query: AiJobHistoryQuery): Promise<AiJobHistoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      if ((await this.workflows.findVersion(tx, principal.tenantId, workflowId, versionId)) === null) throw new NotFoundError();
      return { jobs: await this.assistant.historyOf(tx, principal.tenantId, versionId, query.limit) };
    });
  }

  /**
   * Ends a PENDING or RUNNING request as CANCELLED (anyone who may edit workflows, not only who asked). The worker
   * notices at its next lease renewal or progress update and stops without writing the draft; calls already made stay
   * paid in the ledger. A request that already ended answers 422 INVALID_STATE; one of another organization, 404.
   */
  cancel(principal: Principal, jobId: string): Promise<AiJobResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const cancelled = await this.assistant.cancel(tx, jobId);
      const job = await this.assistant.findJob(tx, principal.tenantId, jobId);
      if (job === undefined) throw new NotFoundError();
      if (!cancelled) throw new InvalidStateError('The AI request already ended');
      await this.audit.record(tx, { action: 'workflow.ai_draft_cancelled', subjectType: 'Workflow', subjectId: job.workflowId ?? jobId, after: { versionId: job.versionId, jobId } });
      return withoutTarget(job);
    });
  }

  private async assertDraftAt(tx: TenantTransaction, tenantId: string, workflowId: string, versionId: string, revision: number): Promise<void> {
    const version = await this.workflows.findVersion(tx, tenantId, workflowId, versionId);
    if (version === null) throw new NotFoundError();
    if (version.status !== 'DRAFT') throw new ImmutableDataError(`The version is ${version.status.toLowerCase()} and cannot be edited`);
    if (version.revision !== revision) throw new StaleRevisionError(version.revision);
  }

  private async enforceRate(userId: string): Promise<void> {
    const result = await this.limiter.hit(`ai-draft:user:${userId}`, AI_DRAFT_RATE_LIMIT);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}

function withoutTarget({ workflowId: _workflowId, versionId: _versionId, ...job }: AiJobResponse & { workflowId: string | null; versionId: string | null }): AiJobResponse {
  return job;
}
