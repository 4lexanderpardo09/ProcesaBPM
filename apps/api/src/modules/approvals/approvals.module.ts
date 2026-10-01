import { Module } from '@nestjs/common';
import { ApprovalGroupTypesService } from './application/approval-group-types.service.js';
import { ApprovalGroupsService } from './application/approval-groups.service.js';
import { ApproverResolver } from './application/approver-resolver.service.js';
import { DelegationsService } from './application/delegations.service.js';
import { ApprovalGroupTypeRepository } from './data/approval-group-type.repository.js';
import { ApprovalGroupRepository } from './data/approval-group.repository.js';
import { ApproverSnapshotRepository } from './data/approver-snapshot.repository.js';
import { DelegationRepository } from './data/delegation.repository.js';
import { ApprovalGroupTypesController } from './http/approval-group-types.controller.js';
import { ApprovalGroupsController } from './http/approval-groups.controller.js';
import { ApproverResolutionController } from './http/approver-resolution.controller.js';
import { DelegationsController } from './http/delegations.controller.js';

/** Approval groups, delegations and the resolution of who approves what (docs/base-de-datos.md §8.12). */
@Module({
  controllers: [ApprovalGroupTypesController, ApprovalGroupsController, DelegationsController, ApproverResolutionController],
  providers: [
    ApprovalGroupTypeRepository,
    ApprovalGroupRepository,
    DelegationRepository,
    ApproverSnapshotRepository,
    ApprovalGroupTypesService,
    ApprovalGroupsService,
    DelegationsService,
    ApproverResolver,
  ],
  exports: [ApproverResolver],
})
export class ApprovalsModule {}
