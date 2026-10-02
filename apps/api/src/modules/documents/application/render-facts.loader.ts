import { Inject, Injectable } from '@nestjs/common';
import type { FieldDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RenderFactsRepository } from '../data/render-facts.repository.js';
import type { NameLookups, RenderFacts, SignerRecord } from '../domain/render-facts.js';

export interface LoadedFacts {
  readonly facts: RenderFacts;
  readonly workflowId: string;
  readonly companyId: string;
  /** Storage key of each image key the facts mention (`logo`, `sig:<user id>`). */
  readonly imageStorageKeys: ReadonlyMap<string, string>;
}

const ids = (fields: readonly FieldDocument[], values: Readonly<Record<string, unknown>>, type: FieldDocument['type']): string[] =>
  fields.filter((field) => field.type === type).flatMap((field) => {
    const value = values[field.code];
    return typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  });

/** Reads what a ticket's documents show, in a handful of queries, into plain data. */
@Injectable()
export class RenderFactsLoader {
  constructor(@Inject(RenderFactsRepository) private readonly repository: RenderFactsRepository) {}

  async load(tx: TenantTransaction, tenantId: string, ticketId: string, now: Date): Promise<LoadedFacts | null> {
    const base = await this.repository.ticketBase(tx, tenantId, ticketId);
    if (base === null) return null;
    const fields = await this.repository.fields(tx, tenantId, base.versionId);
    const values = await this.repository.values(tx, tenantId, ticketId, base.versionId);
    const steps = await this.repository.peopleSteps(tx, tenantId, base.versionId);
    const rawSigners = await this.repository.signers(tx, tenantId, ticketId, steps);
    const signerFileIds = [...rawSigners.values()].flatMap((records) => records.flatMap((record) => (record.imageFileId === null ? [] : [record.imageFileId])));
    const logoFileId = await this.repository.logoFileId(tx, tenantId);
    const imageFiles = await this.repository.imageKeys(tx, tenantId, [...new Set([...signerFileIds, ...(logoFileId === null ? [] : [logoFileId])])]);

    const imageStorageKeys = new Map<string, string>();
    if (logoFileId !== null && imageFiles.has(logoFileId)) imageStorageKeys.set('logo', imageFiles.get(logoFileId)!);
    const signers = new Map<string, SignerRecord[]>();
    for (const [stepName, records] of rawSigners) {
      signers.set(
        stepName,
        records.map(({ imageFileId, ...record }): SignerRecord => {
          const storageKey = imageFileId === null ? undefined : imageFiles.get(imageFileId);
          if (storageKey === undefined) return { ...record, imageKey: null };
          imageStorageKeys.set(`sig:${record.userId}`, storageKey);
          return { ...record, imageKey: `sig:${record.userId}` };
        }),
      );
    }

    const names: NameLookups = {
      users: await this.repository.userNames(tx, tenantId, [...new Set(ids(fields, values, 'USER'))]),
      sites: await this.repository.siteNames(tx, tenantId, [...new Set(ids(fields, values, 'SITE'))]),
      files: await this.repository.fileNames(tx, tenantId, [...new Set(ids(fields, values, 'FILE'))]),
    };
    return { facts: { ticket: base.ticket, timeZone: base.timeZone, currencyCode: base.currencyCode, fields, values, names, signers, now }, workflowId: base.workflowId, companyId: base.companyId, imageStorageKeys };
  }
}
