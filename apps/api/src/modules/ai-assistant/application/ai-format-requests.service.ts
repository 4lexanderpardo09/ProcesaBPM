import { Inject, Injectable } from '@nestjs/common';
import {
  AI_FORMAT_TASK_KIND_OF_MODE,
  AiAssistantDisabledError,
  type AiAvailabilityResponse,
  type AiDraftRequested,
  type AiFormatHistoryResponse,
  type AiJobHistoryQuery,
  AiJobInProgressError,
  hasSqlState,
  InvalidStateError,
  NotFoundError,
  RateLimitedError,
  type RequestAiFormat,
} from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { Clock } from '../../../infrastructure/clock.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RATE_LIMITER, type RateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { PdfFormatRepository } from '../../documents/data/pdf-format.repository.js';
import { AiAssistantRepository } from '../data/ai-assistant.repository.js';
import { assertWithinDailyLimit, quotaDay, remainingJobs } from '../domain/daily-quota.js';
import { AI_DRAFT_RATE_LIMIT } from './ai-draft-requests.service.js';
import { dailyLimits } from './ai-settings.service.js';

type AiConfig = Pick<ApiConfig, 'AI_ASSISTANT_AVAILABLE' | 'AI_REASONING_MODEL' | 'AI_DAILY_JOBS_PER_TENANT' | 'AI_DAILY_TOKENS_PER_TENANT'>;

const UNIQUE_VIOLATION = '23505';

/**
 * Jiro in the PDF format designer (docs/arquitectura.md §22): records a request the worker turns into a format design,
 * and reports on it. The same switch, daily limit and per-person rate as the workflow drafts. The design comes back as
 * the request's result; nothing is saved to the format until the person saves it.
 */
@Injectable()
export class AiFormatRequestsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AiAssistantRepository) private readonly assistant: AiAssistantRepository,
    @Inject(PdfFormatRepository) private readonly formats: PdfFormatRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: AiConfig,
  ) {}

  availability(principal: Principal, workflowId: string, formatId: string): Promise<AiAvailabilityResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireFormat(tx, principal.tenantId, workflowId, formatId);
      const settings = await this.assistant.settingsOf(tx, principal.tenantId);
      const available = this.config.AI_ASSISTANT_AVAILABLE && settings.enabled;
      const today = await this.assistant.usageSince(tx, principal.tenantId, quotaDay(this.clock.now(), settings.timeZone).since);
      return { available, remainingJobsToday: available ? remainingJobs(dailyLimits(this.config), today) : 0, activeJobId: await this.assistant.activeJobForFormat(tx, principal.tenantId, formatId) };
    });
  }

  /**
   * The format must be a canvas (version 2: the block designs of version 1 are not drawn by Jiro), the organization must
   * have the assistant on and be inside its daily limit. Two requests for one format at once: the database keeps one
   * and the other gets 409.
   */
  async request(principal: Principal, workflowId: string, formatId: string, body: RequestAiFormat): Promise<AiDraftRequested> {
    if (!this.config.AI_ASSISTANT_AVAILABLE) throw new AiAssistantDisabledError();
    await this.enforceRate(principal.userId);
    try {
      return await this.runner.withTenantTransaction(async (tx) => {
        await this.requireFormat(tx, principal.tenantId, workflowId, formatId);
        await this.assistant.lockQuota(tx, principal.tenantId);
        const settings = await this.assistant.settingsOf(tx, principal.tenantId);
        if (!settings.enabled) throw new AiAssistantDisabledError();
        const day = quotaDay(this.clock.now(), settings.timeZone);
        assertWithinDailyLimit(dailyLimits(this.config), await this.assistant.usageSince(tx, principal.tenantId, day.since), day);
        const kind = AI_FORMAT_TASK_KIND_OF_MODE[body.mode];
        const jobId = await this.assistant.createFormatJob(tx, {
          kind,
          tenantId: principal.tenantId,
          requestedById: principal.userId,
          workflowId,
          formatId,
          description: body.description,
          ...(body.mode === 'REVISE' && body.design !== undefined ? { basis: body.design } : {}),
          ...(body.images === undefined ? {} : { images: body.images }),
          model: this.config.AI_REASONING_MODEL,
        });
        await this.audit.record(tx, { action: 'workflow.ai_format_requested', subjectType: 'Workflow', subjectId: workflowId, after: { formatId, jobId, kind, model: this.config.AI_REASONING_MODEL, inputChars: body.description.length, images: body.images?.length ?? 0 } });
        return { jobId };
      });
    } catch (error) {
      if (hasSqlState(error, UNIQUE_VIOLATION)) throw new AiJobInProgressError({ cause: error });
      throw error;
    }
  }

  /** The requests made for a format (the designer's panel), with their descriptions and designs: kept 90 days. */
  history(principal: Principal, workflowId: string, formatId: string, query: AiJobHistoryQuery): Promise<AiFormatHistoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireFormat(tx, principal.tenantId, workflowId, formatId);
      return { jobs: await this.assistant.formatHistoryOf(tx, principal.tenantId, formatId, query.limit) };
    });
  }

  private async requireFormat(tx: TenantTransaction, tenantId: string, workflowId: string, formatId: string): Promise<void> {
    const format = await this.formats.findById(tx, tenantId, workflowId, formatId);
    if (format === null) throw new NotFoundError();
    if ((format.design as { version?: unknown } | null)?.version !== 2) throw new InvalidStateError('Jiro draws on the free canvas only');
  }

  private async enforceRate(userId: string): Promise<void> {
    // The same budget as the workflow drafts: they are the same paid calls.
    const result = await this.limiter.hit(`ai-draft:user:${userId}`, AI_DRAFT_RATE_LIMIT);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
