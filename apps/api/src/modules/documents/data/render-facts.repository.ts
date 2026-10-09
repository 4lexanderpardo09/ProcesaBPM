import { Injectable } from '@nestjs/common';
import { type FieldDocument, PDF_IMAGE_MIME_TYPES } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { SignerRecord, TicketFacts } from '../domain/render-facts.js';

export interface TicketBase {
  readonly ticket: TicketFacts;
  readonly versionId: string;
  readonly workflowId: string;
  readonly companyId: string;
  readonly timeZone: string;
  readonly currencyCode: string;
}

export interface PeopleStep {
  readonly id: string;
  readonly name: string;
}

export interface RawSigner extends Omit<SignerRecord, 'imageKey'> {
  readonly imageFileId: string | null;
}

const PEOPLE_STEP_TYPES = ['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE'] as const;

/** Read-only facts about a ticket for rendering. Every query names the tenant: row-level security is the second wall. */
@Injectable()
export class RenderFactsRepository {
  async ticketBase(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketBase | null> {
    const ticket = await tx.ticket.findFirst({
      where: { tenantId, id: ticketId, deletedAt: null },
      select: {
        number: true,
        title: true,
        status: true,
        createdAt: true,
        closedAt: true,
        creatorId: true,
        workflowVersionId: true,
        workflowId: true,
        companyId: true,
        company: { select: { name: true, timeZone: true, currencyCode: true } },
        creator: { select: { user: { select: { firstName: true, lastName: true } } } },
        currentStep: { select: { name: true } },
      },
    });
    if (ticket === null) return null;
    return {
      ticket: {
        number: ticket.number.toString(),
        title: ticket.title,
        status: ticket.status,
        createdAt: ticket.createdAt,
        closedAt: ticket.closedAt,
        companyName: ticket.company.name,
        creatorId: ticket.creatorId,
        creatorName: fullName(ticket.creator.user),
        currentStepName: ticket.currentStep?.name ?? null,
      },
      versionId: ticket.workflowVersionId,
      workflowId: ticket.workflowId,
      companyId: ticket.companyId,
      timeZone: ticket.company.timeZone,
      currencyCode: ticket.company.currencyCode,
    };
  }

  async fields(tx: TenantTransaction, tenantId: string, versionId: string): Promise<FieldDocument[]> {
    const rows = await tx.field.findMany({ where: { tenantId, versionId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return rows.map((row) => ({
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
    }));
  }

  async values(tx: TenantTransaction, tenantId: string, ticketId: string, versionId: string): Promise<Record<string, unknown>> {
    const rows = await tx.ticketFieldValue.findMany({ where: { tenantId, ticketId, workflowVersionId: versionId }, select: { value: true, field: { select: { code: true } } } });
    return Object.fromEntries(rows.map((row) => [row.field.code, row.value]));
  }

  peopleSteps(tx: TenantTransaction, tenantId: string, versionId: string): Promise<PeopleStep[]> {
    return tx.step.findMany({ where: { tenantId, versionId, type: { in: [...PEOPLE_STEP_TYPES] } }, select: { id: true, name: true } });
  }

  async userNames(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx.membership.findMany({ where: { tenantId, userId: { in: [...userIds] } }, select: { userId: true, user: { select: { firstName: true, lastName: true } } } });
    return new Map(rows.map((row) => [row.userId, fullName(row.user)]));
  }

  async siteNames(tx: TenantTransaction, tenantId: string, siteIds: readonly string[]): Promise<Map<string, string>> {
    if (siteIds.length === 0) return new Map();
    const rows = await tx.site.findMany({ where: { tenantId, id: { in: [...siteIds] } }, select: { id: true, name: true } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async fileNames(tx: TenantTransaction, tenantId: string, fileIds: readonly string[]): Promise<Map<string, string>> {
    if (fileIds.length === 0) return new Map();
    const rows = await tx.storedFile.findMany({ where: { tenantId, id: { in: [...fileIds] }, status: 'CONFIRMED' }, select: { id: true, originalName: true } });
    return new Map(rows.map((row) => [row.id, row.originalName]));
  }

  /**
   * Who signed each step, in the order they did, for the latest loop that has anyone: the people of a parallel step who
   * signed, or the person who moved the ticket on from any other step.
   */
  async signers(tx: TenantTransaction, tenantId: string, ticketId: string, steps: readonly PeopleStep[]): Promise<Map<string, RawSigner[]>> {
    const result = new Map<string, RawSigner[]>();
    if (steps.length === 0) return result;
    const stepIds = steps.map((step) => step.id);
    const tasks = await tx.ticketParallelTask.findMany({ where: { tenantId, ticketId, stepId: { in: stepIds }, status: 'SIGNED' }, orderBy: [{ completedAt: 'asc' }, { id: 'asc' }], select: { stepId: true, loop: true, userId: true, completedAt: true, createdAt: true } });
    const events = await tx.ticketEvent.findMany({ where: { tenantId, ticketId, stepId: { in: stepIds }, type: { in: ['TRANSITIONED', 'CLOSED'] }, actorId: { not: null } }, orderBy: { seq: 'asc' }, select: { stepId: true, loop: true, actorId: true, createdAt: true } });
    const signatures = await tx.ticketSignature.findMany({ where: { tenantId, ticketId, stepId: { in: stepIds } }, orderBy: { signedAt: 'asc' }, select: { stepId: true, userId: true, fileId: true } });
    const memberships = await tx.membership.findMany({ where: { tenantId, userId: { in: [...new Set([...tasks.map((task) => task.userId), ...events.flatMap((event) => (event.actorId === null ? [] : [event.actorId]))])] } }, select: { userId: true, signatureFileId: true, user: { select: { firstName: true, lastName: true } } } });
    const people = new Map(memberships.map((membership) => [membership.userId, membership]));

    for (const step of steps) {
      const stepTasks = tasks.filter((task) => task.stepId === step.id);
      const stepEvents = events.filter((event) => event.stepId === step.id);
      const loop = Math.max(0, ...stepTasks.map((task) => task.loop), ...stepEvents.map((event) => event.loop));
      const raw: Array<{ userId: string; at: Date }> = stepTasks.some((task) => task.loop === loop)
        ? stepTasks.filter((task) => task.loop === loop).map((task) => ({ userId: task.userId, at: task.completedAt ?? task.createdAt }))
        : stepEvents.filter((event) => event.loop === loop).slice(-1).map((event) => ({ userId: event.actorId!, at: event.createdAt }));
      const records = raw.flatMap(({ userId, at }): RawSigner[] => {
        const person = people.get(userId);
        if (person === undefined) return [];
        const stamped = signatures.filter((signature) => signature.stepId === step.id && signature.userId === userId).at(-1)?.fileId;
        return [{ userId, name: fullName(person.user), signedAt: at, imageFileId: stamped ?? person.signatureFileId }];
      });
      if (records.length > 0) result.set(step.name, records);
    }
    return result;
  }

  /** Storage keys of the images that can be drawn (PNG or JPEG, confirmed), by file id. */
  async imageKeys(tx: TenantTransaction, tenantId: string, fileIds: readonly string[]): Promise<Map<string, string>> {
    if (fileIds.length === 0) return new Map();
    const rows = await tx.storedFile.findMany({ where: { tenantId, id: { in: [...fileIds] }, status: 'CONFIRMED', mimeType: { in: [...PDF_IMAGE_MIME_TYPES] } }, select: { id: true, storageKey: true } });
    return new Map(rows.map((row) => [row.id, row.storageKey]));
  }

  async logoFileId(tx: TenantTransaction, tenantId: string): Promise<string | null> {
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { logoFileId: true } });
    return tenant?.logoFileId ?? null;
  }
}

const fullName = (user: { firstName: string; lastName: string }): string => `${user.firstName} ${user.lastName}`.trim();
const asObject = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
