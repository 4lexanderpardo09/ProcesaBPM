import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { AmountRuleDocument, FieldDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {});
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
/** An absent JSON column is SQL NULL, never the JSON value `null` (a CHECK ties `condition` to the transition type). */
const jsonOrNull = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => (value === null || value === undefined ? Prisma.DbNull : json(value));

/** Reads and writes the whole content of a version as a `WorkflowVersionDocument`. Every query carries the tenant. */
@Injectable()
export class VersionDocumentRepository {
  async load(tx: TenantTransaction, tenantId: string, versionId: string): Promise<WorkflowVersionDocument> {
    const [steps, transitions, fields, amountRules] = await Promise.all([
      tx.step.findMany({
        where: { tenantId, versionId },
        orderBy: [{ uiY: 'asc' }, { uiX: 'asc' }, { id: 'asc' }],
        include: { candidates: true, initiators: true, slaOverrides: true, signers: { orderBy: { sortOrder: 'asc' } }, files: { orderBy: { sortOrder: 'asc' } } },
      }),
      tx.transition.findMany({ where: { tenantId, versionId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      tx.field.findMany({ where: { tenantId, versionId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      tx.amountRule.findMany({ where: { tenantId, versionId }, orderBy: { id: 'asc' } }),
    ]);
    return {
      steps: steps.map(
        (step): StepDocument => ({
          id: step.id,
          type: step.type,
          name: step.name,
          description: step.description,
          assignmentMode: step.assignmentMode,
          manualSelection: step.manualSelection,
          siteScope: step.siteScope,
          positionId: step.positionId,
          approvalGroupTypeId: step.approvalGroupTypeId,
          approvalLevel: step.approvalLevel,
          closeRule: step.closeRule,
          slaValue: step.slaValue,
          slaUnit: step.slaUnit,
          deadlineType: step.deadlineType,
          deadlineFieldCode: step.deadlineFieldCode,
          deadlineBusinessDays: step.deadlineBusinessDays,
          maxLoops: step.maxLoops,
          dispatchIntervalMin: step.dispatchIntervalMin,
          allowsBatch: step.allowsBatch,
          config: asObject(step.config),
          ui: { x: step.uiX, y: step.uiY },
          candidates: step.candidates.map((row) => ({
            id: row.id,
            participantType: row.participantType as 'USER' | 'POSITION' | 'GROUP',
            userId: row.userId,
            positionId: row.positionId,
            groupId: row.groupId,
          })),
          initiators: step.initiators.map((row) => ({
            id: row.id,
            participantType: row.participantType,
            userId: row.userId,
            positionId: row.positionId,
            groupId: row.groupId,
            departmentId: row.departmentId,
            companyId: row.companyId,
            siteId: row.siteId,
          })),
          slaOverrides: step.slaOverrides.map((row) => ({ companyId: row.companyId, slaValue: row.slaValue, slaUnit: row.slaUnit })),
          signers: step.signers.map((row) => ({ id: row.id, signerType: row.signerType, userId: row.userId, positionId: row.positionId, label: row.label, sortOrder: row.sortOrder })),
          files: step.files.map((row) => ({ fileId: row.fileId, label: row.label, sortOrder: row.sortOrder })),
        }),
      ),
      transitions: transitions.map(
        (row): TransitionDocument => ({
          id: row.id,
          fromStepId: row.fromStepId,
          toStepId: row.toStepId,
          type: row.type,
          label: row.label,
          condition: (row.condition as TransitionDocument['condition']) ?? null,
          sortOrder: row.sortOrder,
          uiPoints: (row.uiPoints as TransitionDocument['uiPoints']) ?? null,
        }),
      ),
      fields: fields.map(
        (row): FieldDocument => ({
          id: row.id,
          stepId: row.stepId,
          code: row.code,
          label: row.label,
          type: row.type,
          capture: row.capture,
          isRequired: row.isRequired,
          isReadOnly: row.isReadOnly,
          sortOrder: row.sortOrder,
          config: asObject(row.config),
          dataSource: row.dataSource === null ? null : asObject(row.dataSource),
        }),
      ),
      amountRules: amountRules.map(
        (row): AmountRuleDocument => ({
          id: row.id,
          stepId: row.stepId,
          positionId: row.positionId,
          companyId: row.companyId,
          fieldCode: row.fieldCode,
          rowTypeValue: row.rowTypeValue,
          amountColumn: row.amountColumn,
          typeColumn: row.typeColumn,
          maxAmount: row.maxAmount.toFixed(2),
          currencyCode: row.currencyCode,
          action: row.action,
          approvalStepId: row.approvalStepId,
          message: row.message,
          isActive: row.isActive,
        }),
      ),
    };
  }

  /** `uuidv7()` ids from the database, so new rows sort like the rest. */
  async allocateIds(tx: TenantTransaction, count: number): Promise<string[]> {
    if (count === 0) return [];
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id FROM generate_series(1, ${count}::int)`;
    return rows.map((row) => row.id);
  }

  async insertSteps(tx: TenantTransaction, tenantId: string, versionId: string, steps: readonly Pick<StepDocument, Exclude<keyof StepDocument, 'candidates' | 'initiators' | 'slaOverrides' | 'signers' | 'files'>>[]): Promise<void> {
    await tx.step.createMany({
      data: steps.map((step) => ({
        tenantId,
        versionId,
        id: step.id,
        type: step.type,
        name: step.name,
        description: step.description,
        assignmentMode: step.assignmentMode,
        manualSelection: step.manualSelection,
        siteScope: step.siteScope,
        positionId: step.positionId,
        approvalGroupTypeId: step.approvalGroupTypeId,
        approvalLevel: step.approvalLevel,
        closeRule: step.closeRule,
        slaValue: step.slaValue,
        slaUnit: step.slaUnit,
        deadlineType: step.deadlineType,
        deadlineFieldCode: step.deadlineFieldCode,
        deadlineBusinessDays: step.deadlineBusinessDays,
        maxLoops: step.maxLoops,
        dispatchIntervalMin: step.dispatchIntervalMin,
        allowsBatch: step.allowsBatch,
        config: json(step.config),
        uiX: step.ui.x,
        uiY: step.ui.y,
      })),
    });
  }

  async updateStep(tx: TenantTransaction, tenantId: string, versionId: string, step: Pick<StepDocument, Exclude<keyof StepDocument, 'candidates' | 'initiators' | 'slaOverrides' | 'signers' | 'files'>>): Promise<void> {
    const { id, ui, config, ...rest } = step;
    await tx.step.updateMany({ where: { tenantId, versionId, id }, data: { ...rest, config: json(config), uiX: ui.x, uiY: ui.y } });
  }

  async insertTransitions(tx: TenantTransaction, tenantId: string, versionId: string, transitions: readonly TransitionDocument[]): Promise<void> {
    await tx.transition.createMany({
      data: transitions.map((row) => ({
        tenantId,
        versionId,
        id: row.id,
        fromStepId: row.fromStepId,
        toStepId: row.toStepId,
        type: row.type,
        label: row.label,
        condition: jsonOrNull(row.condition),
        sortOrder: row.sortOrder,
        uiPoints: jsonOrNull(row.uiPoints),
      })),
    });
  }

  async insertFields(tx: TenantTransaction, tenantId: string, versionId: string, fields: readonly FieldDocument[]): Promise<void> {
    await tx.field.createMany({
      data: fields.map((row) => ({
        tenantId,
        versionId,
        id: row.id,
        stepId: row.stepId,
        code: row.code,
        label: row.label,
        type: row.type,
        capture: row.capture,
        isRequired: row.isRequired,
        isReadOnly: row.isReadOnly,
        sortOrder: row.sortOrder,
        config: json(row.config),
        dataSource: jsonOrNull(row.dataSource),
      })),
    });
  }

  async insertAmountRules(tx: TenantTransaction, tenantId: string, versionId: string, rules: readonly AmountRuleDocument[]): Promise<void> {
    await tx.amountRule.createMany({
      data: rules.map((row) => ({
        tenantId,
        versionId,
        id: row.id,
        stepId: row.stepId,
        positionId: row.positionId,
        companyId: row.companyId,
        fieldCode: row.fieldCode,
        rowTypeValue: row.rowTypeValue,
        amountColumn: row.amountColumn,
        typeColumn: row.typeColumn,
        maxAmount: row.maxAmount,
        currencyCode: row.currencyCode,
        action: row.action,
        approvalStepId: row.approvalStepId,
        message: row.message,
        isActive: row.isActive,
      })),
    });
  }

  /** The rows that hang off the steps, in one insert per table. */
  async insertStepChildren(tx: TenantTransaction, tenantId: string, steps: readonly StepDocument[]): Promise<void> {
    await tx.stepCandidate.createMany({
      data: steps.flatMap((step) => step.candidates.map((row) => ({ tenantId, stepId: step.id, id: row.id, participantType: row.participantType, userId: row.userId, positionId: row.positionId, groupId: row.groupId }))),
    });
    await tx.stepInitiator.createMany({
      data: steps.flatMap((step) =>
        step.initiators.map((row) => ({ tenantId, stepId: step.id, id: row.id, participantType: row.participantType, userId: row.userId, positionId: row.positionId, groupId: row.groupId, departmentId: row.departmentId, companyId: row.companyId, siteId: row.siteId })),
      ),
    });
    await tx.stepSlaOverride.createMany({ data: steps.flatMap((step) => step.slaOverrides.map((row) => ({ tenantId, stepId: step.id, companyId: row.companyId, slaValue: row.slaValue, slaUnit: row.slaUnit }))) });
    await tx.stepSigner.createMany({
      data: steps.flatMap((step) => step.signers.map((row) => ({ tenantId, stepId: step.id, id: row.id, signerType: row.signerType, userId: row.userId, positionId: row.positionId, label: row.label, sortOrder: row.sortOrder }))),
    });
    await tx.stepFile.createMany({ data: steps.flatMap((step) => step.files.map((row) => ({ tenantId, stepId: step.id, fileId: row.fileId, label: row.label, sortOrder: row.sortOrder }))) });
  }

  /** A whole version content (a copy, or the starting START → END of a new workflow), in foreign key order. */
  async insertDocument(tx: TenantTransaction, tenantId: string, versionId: string, doc: WorkflowVersionDocument): Promise<void> {
    await this.insertSteps(tx, tenantId, versionId, doc.steps);
    await this.insertStepChildren(tx, tenantId, doc.steps);
    await this.insertFields(tx, tenantId, versionId, doc.fields);
    await this.insertTransitions(tx, tenantId, versionId, doc.transitions);
    await this.insertAmountRules(tx, tenantId, versionId, doc.amountRules);
  }

  stepIdsOf(tx: TenantTransaction, tenantId: string, versionId: string): Promise<Array<{ id: string }>> {
    return tx.step.findMany({ where: { tenantId, versionId }, select: { id: true } });
  }

  transitionIdsOf(tx: TenantTransaction, tenantId: string, versionId: string): Promise<Array<{ id: string }>> {
    return tx.transition.findMany({ where: { tenantId, versionId }, select: { id: true } });
  }

  async deleteTransitions(tx: TenantTransaction, tenantId: string, versionId: string): Promise<void> {
    await tx.transition.deleteMany({ where: { tenantId, versionId } });
  }

  async deleteSteps(tx: TenantTransaction, tenantId: string, versionId: string, ids: readonly string[]): Promise<void> {
    if (ids.length > 0) await tx.step.deleteMany({ where: { tenantId, versionId, id: { in: [...ids] } } });
  }

  /** Amount rules owned by the steps about to be removed go with them; the ones that only name them as approval step are returned. */
  async deleteRulesOfSteps(tx: TenantTransaction, tenantId: string, versionId: string, stepIds: readonly string[]): Promise<void> {
    if (stepIds.length > 0) await tx.amountRule.deleteMany({ where: { tenantId, versionId, stepId: { in: [...stepIds] } } });
  }

  async countRulesApprovedBy(tx: TenantTransaction, tenantId: string, versionId: string, stepIds: readonly string[]): Promise<number> {
    return stepIds.length === 0 ? 0 : tx.amountRule.count({ where: { tenantId, versionId, approvalStepId: { in: [...stepIds] } } });
  }
}
