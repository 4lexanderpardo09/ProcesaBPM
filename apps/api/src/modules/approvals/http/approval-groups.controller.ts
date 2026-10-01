import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AddApprovalMemberRequest,
  addApprovalMemberRequestSchema,
  type ApprovalGroupResponse,
  type ApprovalGroupsQuery,
  type ApprovalMembersResponse,
  approvalGroupsQuerySchema,
  type ApproversResponse,
  type CreateApprovalGroupRequest,
  createApprovalGroupRequestSchema,
  type Page,
  type RenameApprovalGroupRequest,
  renameApprovalGroupRequestSchema,
  type ReplaceApprovalMembersRequest,
  replaceApprovalMembersRequestSchema,
  type ReplaceApproversRequest,
  replaceApproversRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { ApprovalGroupsService } from '../application/approval-groups.service.js';

@Controller('approval-groups')
export class ApprovalGroupsController {
  constructor(@Inject(ApprovalGroupsService) private readonly groups: ApprovalGroupsService) {}

  @RequirePermission('read', 'ApprovalGroup')
  @Get()
  list(@Query(new ZodValidationPipe(approvalGroupsQuerySchema)) query: ApprovalGroupsQuery): Promise<Page<ApprovalGroupResponse>> {
    return this.groups.list(query);
  }

  @RequirePermission('read', 'ApprovalGroup')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ApprovalGroupResponse> {
    return this.groups.get(id);
  }

  @RequirePermission('create', 'ApprovalGroup')
  @Post()
  create(@Body(new ZodValidationPipe(createApprovalGroupRequestSchema)) body: CreateApprovalGroupRequest): Promise<ApprovalGroupResponse> {
    return this.groups.create(body);
  }

  @RequirePermission('update', 'ApprovalGroup')
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(renameApprovalGroupRequestSchema)) body: RenameApprovalGroupRequest): Promise<ApprovalGroupResponse> {
    return this.groups.rename(id, body);
  }

  @RequirePermission('update', 'ApprovalGroup')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<ApprovalGroupResponse> {
    return this.groups.activate(id);
  }

  @RequirePermission('delete', 'ApprovalGroup')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<ApprovalGroupResponse> {
    return this.groups.deactivate(id);
  }

  @RequirePermission('read', 'ApprovalGroup')
  @Get(':id/approvers')
  approvers(@Param('id', ParseUUIDPipe) id: string): Promise<ApproversResponse> {
    return this.groups.approvers(id);
  }

  /** The order of the list is the order of approval. */
  @RequirePermission('update', 'ApprovalGroup')
  @Put(':id/approvers')
  replaceApprovers(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(replaceApproversRequestSchema)) body: ReplaceApproversRequest): Promise<ApproversResponse> {
    return this.groups.replaceApprovers(id, body);
  }

  @RequirePermission('read', 'ApprovalGroup')
  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string): Promise<ApprovalMembersResponse> {
    return this.groups.members(id);
  }

  @RequirePermission('update', 'ApprovalGroup')
  @Put(':id/members')
  replaceMembers(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(replaceApprovalMembersRequestSchema)) body: ReplaceApprovalMembersRequest): Promise<ApprovalMembersResponse> {
    return this.groups.replaceMembers(id, body);
  }

  @RequirePermission('update', 'ApprovalGroup')
  @Post(':id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addApprovalMemberRequestSchema)) body: AddApprovalMemberRequest): Promise<ApprovalMembersResponse> {
    return this.groups.addMember(id, body.userId);
  }

  @RequirePermission('update', 'ApprovalGroup')
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.groups.removeMember(id, userId);
  }
}
