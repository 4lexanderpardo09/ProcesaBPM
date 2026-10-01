import { Inject, Injectable } from '@nestjs/common';
import { type AddObserverRequest, type CreateCutoffRequest, type CutoffResponse, NotFoundError, type ObserverResponse, type UpdateCutoffRequest } from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { WorkflowLinksRepository } from '../data/workflow-links.repository.js';
import { WorkflowRepository } from '../data/workflow.repository.js';

/** Observers (who is told of every movement) and company cutoffs of a workflow. */
@Injectable()
export class WorkflowLinksService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(WorkflowLinksRepository) private readonly links: WorkflowLinksRepository,
  ) {}

  listObservers(workflowId: string): Promise<ObserverResponse[]> {
    return this.inWorkflow(workflowId, (tx) => this.links.listObservers(tx, this.tenantId, workflowId));
  }

  /** A user, position or group of another tenant is refused by the composite foreign keys (422). */
  addObserver(workflowId: string, request: AddObserverRequest): Promise<ObserverResponse> {
    return this.inWorkflow(workflowId, (tx) => this.links.addObserver(tx, this.tenantId, workflowId, request));
  }

  removeObserver(workflowId: string, observerId: string): Promise<void> {
    return this.inWorkflow(workflowId, async (tx) => {
      if ((await this.links.removeObserver(tx, this.tenantId, workflowId, observerId)) === 0) throw new NotFoundError();
    });
  }

  listCutoffs(workflowId: string): Promise<CutoffResponse[]> {
    return this.inWorkflow(workflowId, (tx) => this.links.listCutoffs(tx, this.tenantId, workflowId));
  }

  createCutoff(workflowId: string, request: CreateCutoffRequest): Promise<CutoffResponse> {
    return this.inWorkflow(workflowId, (tx) => this.links.createCutoff(tx, this.tenantId, workflowId, request));
  }

  updateCutoff(workflowId: string, cutoffId: string, request: UpdateCutoffRequest): Promise<CutoffResponse> {
    return this.inWorkflow(workflowId, async (tx) => {
      if ((await this.links.updateCutoff(tx, this.tenantId, workflowId, cutoffId, compact(request))) === 0) throw new NotFoundError();
      return (await this.links.findCutoff(tx, this.tenantId, workflowId, cutoffId))!;
    });
  }

  removeCutoff(workflowId: string, cutoffId: string): Promise<void> {
    return this.inWorkflow(workflowId, async (tx) => {
      if ((await this.links.removeCutoff(tx, this.tenantId, workflowId, cutoffId)) === 0) throw new NotFoundError();
    });
  }

  private inWorkflow<T>(workflowId: string, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.runner.withTenantTransaction(async (tx) => {
      if ((await this.workflows.findById(tx, this.tenantId, workflowId)) === null) throw new NotFoundError();
      return work(tx);
    });
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
