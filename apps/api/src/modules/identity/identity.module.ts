import { Module } from '@nestjs/common';
import { PlatformOutboxRepository } from '../../infrastructure/outbox/platform-outbox.repository.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { GroupsService } from './application/groups.service.js';
import { MemberInvitationService } from './application/member-invitation.service.js';
import { MembersService } from './application/members.service.js';
import { PermissionCatalogService } from './application/permission-catalog.service.js';
import { RolesService } from './application/roles.service.js';
import { GroupRepository } from './data/group.repository.js';
import { MemberRepository } from './data/member.repository.js';
import { RoleRepository } from './data/role.repository.js';
import { GroupsController } from './http/groups.controller.js';
import { MembersController } from './http/members.controller.js';
import { PermissionsController } from './http/permissions.controller.js';
import { RolesController } from './http/roles.controller.js';

/** Members (with invitations), roles and their permissions, and groups of members. */
@Module({
  imports: [AuthorizationModule],
  controllers: [MembersController, RolesController, PermissionsController, GroupsController],
  providers: [
    PlatformOutboxRepository,
    MemberRepository,
    RoleRepository,
    GroupRepository,
    MembersService,
    MemberInvitationService,
    RolesService,
    PermissionCatalogService,
    GroupsService,
  ],
})
export class IdentityModule {}
