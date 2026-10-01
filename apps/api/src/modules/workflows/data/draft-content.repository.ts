import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { CreateAmountRuleRequest, CreateFieldRequest, ReplaceCandidatesRequest, ReplaceInitiatorsRequest, ReplaceSignersRequest, ReplaceSlaOverridesRequest, ReplaceStepFilesRequest, UpdateAmountRuleRequest, UpdateFieldRequest } from '@procesabpm/shared';
import type { Patch } from '../../../common/crud/compact.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Granular writes on the content of a draft. The caller has locked the version and checked it is a draft. */
@Injectable()
export class DraftContentRepository {
  /**
   * Locks the step row: the replace-the-list edits delete and insert, and two of them at once would each
   * miss the other's rows and end up merged (READ COMMITTED). Returns false when the step is not in the version.
   */
  async lockStep(tx: TenantTransaction, tenantId: string, versionId: string, stepId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM steps WHERE tenant_id = ${tenantId}::uuid AND version_id = ${versionId}::uuid AND id = ${stepId}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  async stepBelongs(tx: TenantTransaction, tenantId: string, versionId: string, stepId: string): Promise<boolean> {
    return (await tx.step.count({ where: { tenantId, versionId, id: stepId } })) > 0;
  }

  // ---- Fields ----
  createField(tx: TenantTransaction, tenantId: string, versionId: string, data: CreateFieldRequest) {
    return tx.field.create({
      data: { tenantId, versionId, ...data, config: json(data.config), dataSource: data.dataSource === null ? Prisma.DbNull : json(data.dataSource) },
      select: { id: true },
    });
  }

  async updateField(tx: TenantTransaction, tenantId: string, versionId: string, id: string, data: Patch<UpdateFieldRequest>): Promise<number> {
    const { config, dataSource, ...rest } = data;
    const { count } = await tx.field.updateMany({
      where: { tenantId, versionId, id },
      data: { ...rest, ...(config === undefined ? {} : { config: json(config) }), ...(dataSource === undefined ? {} : { dataSource: dataSource === null ? Prisma.DbNull : json(dataSource) }) },
    });
    return count;
  }

  async deleteField(tx: TenantTransaction, tenantId: string, versionId: string, id: string): Promise<number> {
    return (await tx.field.deleteMany({ where: { tenantId, versionId, id } })).count;
  }

  findField(tx: TenantTransaction, tenantId: string, versionId: string, id: string) {
    return tx.field.findFirst({ where: { tenantId, versionId, id } });
  }

  // ---- Amount rules ----
  createAmountRule(tx: TenantTransaction, tenantId: string, versionId: string, data: CreateAmountRuleRequest) {
    return tx.amountRule.create({ data: { tenantId, versionId, ...data }, select: { id: true } });
  }

  async updateAmountRule(tx: TenantTransaction, tenantId: string, versionId: string, id: string, data: Patch<UpdateAmountRuleRequest>): Promise<number> {
    return (await tx.amountRule.updateMany({ where: { tenantId, versionId, id }, data })).count;
  }

  async deleteAmountRule(tx: TenantTransaction, tenantId: string, versionId: string, id: string): Promise<number> {
    return (await tx.amountRule.deleteMany({ where: { tenantId, versionId, id } })).count;
  }

  findAmountRule(tx: TenantTransaction, tenantId: string, versionId: string, id: string) {
    return tx.amountRule.findFirst({ where: { tenantId, versionId, id } });
  }

  // ---- Step children: each list replaces the previous one ----
  async replaceCandidates(tx: TenantTransaction, tenantId: string, stepId: string, request: ReplaceCandidatesRequest): Promise<void> {
    await tx.stepCandidate.deleteMany({ where: { tenantId, stepId } });
    await tx.stepCandidate.createMany({
      data: request.candidates.map((candidate) => ({
        tenantId,
        stepId,
        participantType: candidate.participantType,
        userId: 'userId' in candidate ? candidate.userId : null,
        positionId: 'positionId' in candidate ? candidate.positionId : null,
        groupId: 'groupId' in candidate ? candidate.groupId : null,
      })),
    });
  }

  async replaceInitiators(tx: TenantTransaction, tenantId: string, stepId: string, request: ReplaceInitiatorsRequest): Promise<void> {
    await tx.stepInitiator.deleteMany({ where: { tenantId, stepId } });
    await tx.stepInitiator.createMany({
      data: request.initiators.map((initiator) => ({
        tenantId,
        stepId,
        participantType: initiator.participantType,
        userId: 'userId' in initiator ? initiator.userId : null,
        positionId: 'positionId' in initiator ? initiator.positionId : null,
        groupId: 'groupId' in initiator ? initiator.groupId : null,
        departmentId: 'departmentId' in initiator ? initiator.departmentId : null,
        companyId: 'companyId' in initiator ? initiator.companyId : null,
        siteId: 'siteId' in initiator ? initiator.siteId : null,
      })),
    });
  }

  async replaceSigners(tx: TenantTransaction, tenantId: string, stepId: string, request: ReplaceSignersRequest): Promise<void> {
    await tx.stepSigner.deleteMany({ where: { tenantId, stepId } });
    await tx.stepSigner.createMany({
      data: request.signers.map((signer, index) => ({
        tenantId,
        stepId,
        signerType: signer.signerType,
        userId: 'userId' in signer ? signer.userId : null,
        positionId: 'positionId' in signer ? signer.positionId : null,
        label: signer.label,
        sortOrder: index,
      })),
    });
  }

  async replaceSlaOverrides(tx: TenantTransaction, tenantId: string, stepId: string, request: ReplaceSlaOverridesRequest): Promise<void> {
    await tx.stepSlaOverride.deleteMany({ where: { tenantId, stepId } });
    await tx.stepSlaOverride.createMany({ data: request.overrides.map((override) => ({ tenantId, stepId, ...override })) });
  }

  async replaceFiles(tx: TenantTransaction, tenantId: string, stepId: string, request: ReplaceStepFilesRequest): Promise<void> {
    await tx.stepFile.deleteMany({ where: { tenantId, stepId } });
    await tx.stepFile.createMany({ data: request.files.map((file) => ({ tenantId, stepId, ...file })) });
  }
}
