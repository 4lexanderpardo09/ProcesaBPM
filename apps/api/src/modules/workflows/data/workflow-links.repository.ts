import { Injectable } from '@nestjs/common';
import type { AddObserverRequest, CreateCutoffRequest, CutoffResponse, ObserverResponse, UpdateCutoffRequest } from '@procesabpm/shared';
import type { Patch } from '../../../common/crud/compact.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

const OBSERVER = { id: true, participantType: true, userId: true, positionId: true, groupId: true } as const;
const CUTOFF = { id: true, companyId: true, cutoffDay: true, graceBusinessDays: true, description: true, isActive: true } as const;

/** What hangs from the workflow itself (not from a version): observers and company cutoffs. */
@Injectable()
export class WorkflowLinksRepository {
  listObservers(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<ObserverResponse[]> {
    return tx.workflowObserver.findMany({ where: { tenantId, workflowId }, select: OBSERVER, orderBy: { id: 'asc' } }) as Promise<ObserverResponse[]>;
  }

  addObserver(tx: TenantTransaction, tenantId: string, workflowId: string, request: AddObserverRequest): Promise<ObserverResponse> {
    return tx.workflowObserver.create({
      data: {
        tenantId,
        workflowId,
        participantType: request.participantType,
        userId: 'userId' in request ? request.userId : null,
        positionId: 'positionId' in request ? request.positionId : null,
        groupId: 'groupId' in request ? request.groupId : null,
      },
      select: OBSERVER,
    }) as Promise<ObserverResponse>;
  }

  async removeObserver(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<number> {
    return (await tx.workflowObserver.deleteMany({ where: { tenantId, workflowId, id } })).count;
  }

  listCutoffs(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<CutoffResponse[]> {
    return tx.companyCutoff.findMany({ where: { tenantId, workflowId }, select: CUTOFF, orderBy: [{ companyId: 'asc' }, { cutoffDay: 'asc' }] });
  }

  createCutoff(tx: TenantTransaction, tenantId: string, workflowId: string, request: CreateCutoffRequest): Promise<CutoffResponse> {
    return tx.companyCutoff.create({ data: { tenantId, workflowId, ...request }, select: CUTOFF });
  }

  async updateCutoff(tx: TenantTransaction, tenantId: string, workflowId: string, id: string, request: Patch<UpdateCutoffRequest>): Promise<number> {
    return (await tx.companyCutoff.updateMany({ where: { tenantId, workflowId, id }, data: request })).count;
  }

  findCutoff(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<CutoffResponse | null> {
    return tx.companyCutoff.findFirst({ where: { tenantId, workflowId, id }, select: CUTOFF });
  }

  async removeCutoff(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<number> {
    return (await tx.companyCutoff.deleteMany({ where: { tenantId, workflowId, id } })).count;
  }
}
