import { Inject, Injectable } from '@nestjs/common';
import { type DraftCatalog, type DraftSpecExtraction, extractDraftSpec } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DraftCatalogRepository } from '../data/draft-catalog.repository.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';

export interface DraftAsSpec {
  readonly catalog: DraftCatalog;
  readonly extraction: DraftSpecExtraction;
}

/** A draft as «Crear con IA» revises it: its spec in the organization's catalog names, or what the spec would lose. */
@Injectable()
export class DraftSpecReader {
  constructor(
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
    @Inject(DraftCatalogRepository) private readonly catalogs: DraftCatalogRepository,
  ) {}

  async read(tx: TenantTransaction, tenantId: string, versionId: string): Promise<DraftAsSpec> {
    const catalog = await this.catalogs.load(tx, tenantId);
    return { catalog, extraction: extractDraftSpec(await this.documents.load(tx, tenantId, versionId), catalog) };
  }
}
