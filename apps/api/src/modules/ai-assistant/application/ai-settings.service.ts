import { Inject, Injectable } from '@nestjs/common';
import { AI_NOTICE_VERSION, type AiAssistantSettingsResponse, AiAssistantDisabledError, type AiDailyLimits, type AiUsageQuery, type AiUsageResponse, type UpdateAiAssistantSettings } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { Clock } from '../../../infrastructure/clock.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { AiAssistantRepository } from '../data/ai-assistant.repository.js';
import { quotaDay } from '../domain/daily-quota.js';

type AiConfig = Pick<ApiConfig, 'AI_ASSISTANT_AVAILABLE' | 'AI_DAILY_JOBS_PER_TENANT' | 'AI_DAILY_TOKENS_PER_TENANT'>;

const DAY_MS = 24 * 60 * 60_000;
const RECENT_JOBS = 50;

export function dailyLimits(config: AiConfig): AiDailyLimits {
  return { jobsPerDay: config.AI_DAILY_JOBS_PER_TENANT, tokensPerDay: config.AI_DAILY_TOKENS_PER_TENANT };
}

/** The organization's switch of the AI assistant (with the transfer notice it accepts) and what the assistant cost it. */
@Injectable()
export class AiSettingsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AiAssistantRepository) private readonly assistant: AiAssistantRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: AiConfig,
  ) {}

  get(principal: Principal): Promise<AiAssistantSettingsResponse> {
    return this.runner.withTenantTransaction((tx) => this.read(tx, principal.tenantId));
  }

  /** The audit row of turning it on records the notice version accepted: the record of the consent to the transfer. */
  update(principal: Principal, settings: UpdateAiAssistantSettings): Promise<AiAssistantSettingsResponse> {
    if (settings.enabled && !this.config.AI_ASSISTANT_AVAILABLE) throw new AiAssistantDisabledError();
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.assistant.settingsOf(tx, principal.tenantId);
      await this.assistant.setEnabled(tx, principal.tenantId, settings.enabled);
      await this.audit.record(tx, {
        action: 'tenant.ai_assistant_updated',
        subjectType: 'Setting',
        subjectId: principal.tenantId,
        before: { enabled: before.enabled },
        after: settings.enabled ? { enabled: true, noticeVersion: AI_NOTICE_VERSION } : { enabled: false },
      });
      return this.read(tx, principal.tenantId);
    });
  }

  usage(principal: Principal, query: AiUsageQuery): Promise<AiUsageResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { timeZone } = await this.assistant.settingsOf(tx, principal.tenantId);
      const since = quotaDay(new Date(this.clock.now().getTime() - (query.days - 1) * DAY_MS), timeZone).since;
      return { days: await this.assistant.usageByDay(tx, principal.tenantId, since, timeZone), recentJobs: await this.assistant.recentJobs(tx, principal.tenantId, RECENT_JOBS) };
    });
  }

  private async read(tx: TenantTransaction, tenantId: string): Promise<AiAssistantSettingsResponse> {
    const settings = await this.assistant.settingsOf(tx, tenantId);
    return {
      available: this.config.AI_ASSISTANT_AVAILABLE,
      enabled: settings.enabled,
      noticeVersion: AI_NOTICE_VERSION,
      limits: dailyLimits(this.config),
      today: await this.assistant.usageSince(tx, tenantId, quotaDay(this.clock.now(), settings.timeZone).since),
    };
  }
}
