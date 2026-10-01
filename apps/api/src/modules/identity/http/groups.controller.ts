import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AddGroupMemberRequest,
  addGroupMemberRequestSchema,
  type GroupMembersResponse,
  type GroupRequest,
  type GroupResponse,
  groupRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type ReplaceGroupMembersRequest,
  replaceGroupMembersRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { GroupsService } from '../application/groups.service.js';

@Controller('groups')
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groups: GroupsService) {}

  @RequirePermission('read', 'Group')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<GroupResponse>> {
    return this.groups.list(query);
  }

  @RequirePermission('read', 'Group')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponse> {
    return this.groups.get(id);
  }

  @RequirePermission('create', 'Group')
  @Post()
  create(@Body(new ZodValidationPipe(groupRequestSchema)) body: GroupRequest): Promise<GroupResponse> {
    return this.groups.create(body);
  }

  @RequirePermission('update', 'Group')
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(groupRequestSchema)) body: GroupRequest): Promise<GroupResponse> {
    return this.groups.rename(id, body);
  }

  @RequirePermission('update', 'Group')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponse> {
    return this.groups.activate(id);
  }

  @RequirePermission('delete', 'Group')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponse> {
    return this.groups.deactivate(id);
  }

  @RequirePermission('read', 'Group')
  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string): Promise<GroupMembersResponse> {
    return this.groups.members(id);
  }

  @RequirePermission('update', 'Group')
  @Put(':id/members')
  replaceMembers(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(replaceGroupMembersRequestSchema)) body: ReplaceGroupMembersRequest): Promise<GroupMembersResponse> {
    return this.groups.replaceMembers(id, body);
  }

  @RequirePermission('update', 'Group')
  @Post(':id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addGroupMemberRequestSchema)) body: AddGroupMemberRequest): Promise<GroupMembersResponse> {
    return this.groups.addMember(id, body.userId);
  }

  @RequirePermission('update', 'Group')
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.groups.removeMember(id, userId);
  }
}
