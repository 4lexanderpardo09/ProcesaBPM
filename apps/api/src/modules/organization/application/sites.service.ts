import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateSiteRequest,
  DuplicateError,
  InvalidReferenceError,
  InvalidStateError,
  NotFoundError,
  type Page,
  type PageQuery,
  type SiteResponse,
  type SiteTreeNode,
  type UpdateSiteRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SiteRepository, type SiteRow } from '../data/site.repository.js';
import { assertMoveKeepsTreeAcyclic, buildTree, levelsAfterMove } from '../domain/site-tree.js';

/** Same bound as the level names (`siteLevelParamSchema`). */
const MAX_SITE_LEVEL = 20;

const toResponse = (row: SiteRow): SiteResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class SitesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(SiteRepository) private readonly repository: SiteRepository,
  ) {}

  list(query: PageQuery): Promise<Page<SiteResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  tree(includeInactive: boolean): Promise<SiteTreeNode[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const rows = await this.repository.findAll(tx, this.tenantId, { includeInactive });
      return buildTree(rows.map(toResponse));
    });
  }

  get(id: string): Promise<SiteResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  /** A child is one level below its parent; a site without parent is level 1. */
  create(request: CreateSiteRequest): Promise<SiteResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.repository.lockTree(tx, this.tenantId);
      const parent = request.parentId === undefined ? null : await this.repository.findById(tx, this.tenantId, request.parentId);
      if (request.parentId !== undefined && parent === null) throw new InvalidReferenceError('The parent site does not exist');
      const level = (parent?.level ?? 0) + 1;
      if (level > MAX_SITE_LEVEL) throw new InvalidStateError(`The site tree cannot be deeper than ${MAX_SITE_LEVEL} levels`);
      await this.assertNameFree(tx, parent?.id ?? null, request.name);
      const created = await this.repository.create(tx, this.tenantId, {
        name: request.name,
        level,
        ...compact({ parentId: request.parentId, isCentral: request.isCentral }),
      });
      return toResponse(created);
    });
  }

  update(id: string, request: UpdateSiteRequest): Promise<SiteResponse> {
    return this.change(id, compact(request));
  }

  activate(id: string): Promise<SiteResponse> {
    return this.change(id, { isActive: true });
  }

  deactivate(id: string): Promise<SiteResponse> {
    return this.change(id, { isActive: false });
  }

  /** Moves the site (and its subtree) under another parent, or to the root with `null`, without creating a cycle. */
  move(id: string, newParentId: string | null): Promise<SiteResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.repository.lockTree(tx, this.tenantId);
      const moving = await this.require(tx, id);
      const sites = await this.repository.findAll(tx, this.tenantId, { includeInactive: true });
      if (newParentId !== null && !sites.some((site) => site.id === newParentId)) {
        throw new InvalidReferenceError('The parent site does not exist');
      }
      assertMoveKeepsTreeAcyclic(sites, id, newParentId);
      const levels = levelsAfterMove(sites, id, newParentId);
      if (Math.max(...levels.values()) > MAX_SITE_LEVEL) throw new InvalidStateError(`The site tree cannot be deeper than ${MAX_SITE_LEVEL} levels`);
      await this.assertNameFree(tx, newParentId, moving.name, id);
      for (const [siteId, level] of levels) {
        await this.repository.setParentAndLevel(tx, this.tenantId, siteId, siteId === id ? newParentId : undefined, level);
      }
      return toResponse(await this.require(tx, id));
    });
  }

  private change(id: string, data: { name?: string; isCentral?: boolean; isActive?: boolean }): Promise<SiteResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.repository.lockTree(tx, this.tenantId);
      const site = await this.require(tx, id);
      if (data.name !== undefined) await this.assertNameFree(tx, site.parentId, data.name, id);
      await this.repository.update(tx, this.tenantId, id, data);
      return toResponse(await this.require(tx, id));
    });
  }

  private async assertNameFree(tx: TenantTransaction, parentId: string | null, name: string, exceptId?: string): Promise<void> {
    if (await this.repository.nameTaken(tx, this.tenantId, parentId, name, exceptId)) throw new DuplicateError('A site with that name already exists under the same parent');
  }

  private async require(tx: TenantTransaction, id: string): Promise<SiteRow> {
    const site = await this.repository.findById(tx, this.tenantId, id);
    if (site === null) throw new NotFoundError();
    return site;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
