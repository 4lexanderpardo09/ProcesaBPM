import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type DirectoryPerson,
  type InviteMemberRequest,
  inviteMemberRequestSchema,
  type MemberDirectoryQuery,
  memberDirectoryQuerySchema,
  type MemberResponse,
  type MembersQuery,
  membersQuerySchema,
  type Page,
  type SetSignatureRequest,
  setSignatureRequestSchema,
  type SignatureResponse,
  type UpdateMemberRequest,
  updateMemberRequestSchema,
} from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { AuthenticatedOnly, RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { MemberDirectoryService } from '../application/member-directory.service.js';
import { MemberInvitationService } from '../application/member-invitation.service.js';
import { MemberSignatureService } from '../application/member-signature.service.js';
import { MembersService } from '../application/members.service.js';

@Controller('members')
export class MembersController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(MemberInvitationService) private readonly invitations: MemberInvitationService,
    @Inject(MemberDirectoryService) private readonly directoryService: MemberDirectoryService,
    @Inject(MemberSignatureService) private readonly signatures: MemberSignatureService,
  ) {}

  @RequirePermission('read', 'Membership')
  @Get()
  list(@Query(new ZodValidationPipe(membersQuerySchema)) query: MembersQuery): Promise<Page<MemberResponse>> {
    return this.members.list(query);
  }

  /** Open to every member, declared before `:userId`: only ids and names, to choose or name a colleague. */
  @AuthenticatedOnly()
  @Get('directory')
  directory(@Query(new ZodValidationPipe(memberDirectoryQuerySchema)) query: MemberDirectoryQuery): Promise<DirectoryPerson[]> {
    return this.directoryService.find(query);
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

  /** A short-lived link to the member's signature image, or null when they have none. */
  @RequirePermission('read', 'Membership')
  @Get(':userId/signature')
  signature(@Param('userId', ParseUUIDPipe) userId: string): Promise<SignatureResponse | null> {
    return this.signatures.url(userId);
  }

  /** Links an image the caller uploaded (and confirmed) as the member's signature. */
  @RequirePermission('update', 'Membership')
  @Put(':userId/signature')
  @Audited('member.signature_updated')
  @HttpCode(HttpStatus.NO_CONTENT)
  setSignature(@CurrentPrincipal() principal: Principal, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodValidationPipe(setSignatureRequestSchema)) body: SetSignatureRequest): Promise<void> {
    return this.signatures.set(principal.userId, userId, body);
  }

  @RequirePermission('update', 'Membership')
  @Delete(':userId/signature')
  @Audited('member.signature_removed')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearSignature(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.signatures.clear(userId);
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
