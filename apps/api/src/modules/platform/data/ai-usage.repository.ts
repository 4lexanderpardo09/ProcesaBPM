import { Injectable } from '@nestjs/common';
import type { TenantAiUsage } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

interface TenantAiUsageRow {
  tenant_id: string;
  slug: string;
  name: string;
  status: TenantAiUsage['status'];
  assistant_enabled: boolean;
  jobs: number;
  succeeded: number;
  failed: number;
  calls: number;
  prompt: bigint;
  cached: bigint;
  completion: bigint;
  reasoning: bigint;
}

/**
 * The AI assistant's consumption per organization, for cost control. Only counts and token sums are read: never the
 * description (`ai_jobs.input`) nor the result.
 */
@Injectable()
export class AiUsageRepository {
  /** Organizations with the assistant on or with requests or calls in [since, until), the most tokens first. */
  async perTenant(tx: PlatformTransaction, since: Date, until: Date): Promise<TenantAiUsage[]> {
    const rows = await tx.$queryRaw<TenantAiUsageRow[]>`
      WITH calls AS (
        SELECT tenant_id, count(*)::int AS calls, sum(prompt_tokens)::bigint AS prompt, sum(cached_prompt_tokens)::bigint AS cached,
               sum(completion_tokens)::bigint AS completion, sum(reasoning_tokens)::bigint AS reasoning
        FROM ai_usage WHERE created_at >= ${since} AND created_at < ${until} GROUP BY tenant_id
      ), jobs AS (
        SELECT tenant_id, count(*)::int AS jobs, (count(*) FILTER (WHERE status = 'SUCCEEDED'))::int AS succeeded,
               (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed
        FROM ai_jobs WHERE created_at >= ${since} AND created_at < ${until} GROUP BY tenant_id
      )
      SELECT t.id AS tenant_id, t.slug, t.name, t.status::text AS status, t.ai_assistant_enabled AS assistant_enabled,
             coalesce(j.jobs, 0) AS jobs, coalesce(j.succeeded, 0) AS succeeded, coalesce(j.failed, 0) AS failed,
             coalesce(c.calls, 0) AS calls, coalesce(c.prompt, 0) AS prompt, coalesce(c.cached, 0) AS cached,
             coalesce(c.completion, 0) AS completion, coalesce(c.reasoning, 0) AS reasoning
      FROM tenants t
      LEFT JOIN calls c ON c.tenant_id = t.id
      LEFT JOIN jobs j ON j.tenant_id = t.id
      WHERE t.ai_assistant_enabled OR c.tenant_id IS NOT NULL OR j.tenant_id IS NOT NULL
      ORDER BY coalesce(c.prompt, 0) + coalesce(c.completion, 0) DESC, t.name, t.id`;
    return rows.map(toTenantAiUsage);
  }
}

function toTenantAiUsage(row: TenantAiUsageRow): TenantAiUsage {
  const promptTokens = Number(row.prompt);
  const completionTokens = Number(row.completion);
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    assistantEnabled: row.assistant_enabled,
    jobs: { total: row.jobs, succeeded: row.succeeded, failed: row.failed },
    calls: row.calls,
    promptTokens,
    cachedPromptTokens: Number(row.cached),
    completionTokens,
    reasoningTokens: Number(row.reasoning),
    totalTokens: promptTokens + completionTokens,
  };
}
