import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';

export interface PublishedWorkflow {
  readonly workflowId: string;
  readonly versionId: string;
  readonly document: WorkflowVersionDocument;
}

const CACHE_SIZE = 200;

/**
 * Read access to workflow versions that tickets run on. Published and archived versions never change
 * (the database refuses it), so their documents are cached by version; a draft is never served from here.
 */
@Injectable()
export class PublishedVersionReader {
  private readonly cache = new Map<string, WorkflowVersionDocument>();

  constructor(@Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository) {}

  /** The published version of the active workflow of a subcategory, or `null` when there is none. */
  async findForSubcategory(tx: TenantTransaction, tenantId: string, subcategoryId: string): Promise<PublishedWorkflow | null> {
    const version = await tx.workflowVersion.findFirst({
      where: { tenantId, status: 'PUBLISHED', workflow: { subcategoryId, isActive: true } },
      select: { id: true, workflowId: true },
    });
    return version === null ? null : { workflowId: version.workflowId, versionId: version.id, document: await this.documentOf(tx, tenantId, version.id) };
  }

  /** The content of a published or archived version (the one a ticket was created with). */
  async documentOf(tx: TenantTransaction, tenantId: string, versionId: string): Promise<WorkflowVersionDocument> {
    const key = `${tenantId}:${versionId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const version = await tx.workflowVersion.findFirst({ where: { tenantId, id: versionId }, select: { status: true } });
    if (version === null || version.status === 'DRAFT') throw new InvalidStateError('Tickets only run on published versions');
    const document = await this.documents.load(tx, tenantId, versionId);
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, document);
    return document;
  }
}
