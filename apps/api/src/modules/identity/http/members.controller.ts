import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type InviteMemberRequest,
  inviteMemberRequestSchema,
  type MemberResponse,
  type MembersQuery,
  membersQuerySchema,
  type Page,
  type UpdateMemberRequest,
  updateMemberRequestSchema,
} from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { MemberInvitationService } from '../application/member-invitation.service.js';
import { MembersService } from '../application/members.service.js';

@Controller('members')
export class MembersController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(MemberInvitationService) private readonly invitations: MemberInvitationService,
  ) {}

  @RequirePermission('read', 'Membership')
  @Get()
  list(@Query(new ZodValidationPipe(membersQuerySchema)) query: MembersQuery): Promise<Page<MemberResponse>> {
    return this.members.list(query);
  }

  @RequirePermission('read', 'Membership')
  @Get(':userId')
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<MemberResponse> {
    return this.members.get(userId);
  }

  @RequirePermission('create', 'Membership')
  @Post('invitations')
  @Audited('member.invited')
  invite(@Body(new ZodValidationPipe(inviteMemberRequestSchema)) body: InviteMemberRequest): Promise<MemberResponse> {
    return this.invitations.invite(body);
  }

  @RequirePermission('update', 'Membership')
  @Post(':userId/resend-invitation')
  @Audited('member.invitation_resent')
  @HttpCode(HttpStatus.OK)
  resend(@Param('userId', ParseUUIDPipe) userId: string): Promise<MemberResponse> {
    return this.invitations.resend(userId);
  }

  @RequirePermission('update', 'Membership')
  @Patch(':userId')
  @Audited('member.updated')
  update(
    @CurrentAbility() ability: AppAbility,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(updateMemberRequestSchema)) body: UpdateMemberRequest,
  ): Promise<MemberResponse> {
    return this.members.update(ability, userId, body);
  }

  @RequirePermission('update', 'Membership')
  @Post(':userId/activate')
  @Audited('member.reactivated')
  @HttpCode(HttpStatus.OK)
  activate(@Param('userId', ParseUUIDPipe) userId: string): Promise<MemberResponse> {
    return this.members.activate(userId);
  }

  @RequirePermission('delete', 'Membership')
  @Post(':userId/deactivate')
  @Audited('member.deactivated')
  @HttpCode(HttpStatus.OK)
  deactivate(@CurrentAbility() ability: AppAbility, @CurrentPrincipal() principal: Principal, @Param('userId', ParseUUIDPipe) userId: string): Promise<MemberResponse> {
    return this.members.deactivate(ability, principal.userId, userId);
  }
}
