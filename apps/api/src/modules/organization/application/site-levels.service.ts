import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, type SiteLevelResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SiteLevelRepository } from '../data/site-level.repository.js';
import { SiteRepository } from '../data/site.repository.js';

/** The names of the levels of the site tree (1 = "Zona", 2 = "Regional"…): always contiguous from 1. */
@Injectable()
export class SiteLevelsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(SiteLevelRepository) private readonly levels: SiteLevelRepository,
    @Inject(SiteRepository) private readonly sites: SiteRepository,
  ) {}

  list(): Promise<SiteLevelResponse[]> {
    return this.runner.withTenantTransaction((tx) => this.levels.list(tx, this.tenantId));
  }

  /** Names an existing level or the next one; skipping a number would leave a gap. */
  name(level: number, name: string): Promise<SiteLevelResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const existing = await this.levels.list(tx, this.tenantId);
      if (level > existing.length + 1) throw new InvalidStateError(`The next level to name is ${existing.length + 1}`);
      await this.levels.upsert(tx, this.tenantId, level, name);
      return { level, name };
    });
  }

  /** Only the last level can be removed, and only while no site sits at it. */
  remove(level: number): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      const existing = await this.levels.list(tx, this.tenantId);
      if (!existing.some((row) => row.level === level)) return;
      if (level !== existing.length) throw new InvalidStateError('Only the last level can be removed');
      if ((await this.sites.countAtLevel(tx, this.tenantId, level)) > 0) throw new InvalidStateError('There are sites at that level');
      await this.levels.remove(tx, this.tenantId, level);
    });
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
