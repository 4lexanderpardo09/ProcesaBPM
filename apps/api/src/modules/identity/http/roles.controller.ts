import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CreateRoleRequest,
  createRoleRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type ReplaceRolePermissionsRequest,
  replaceRolePermissionsRequestSchema,
  type RolePermissionResponse,
  type RoleResponse,
  type UpdateRoleRequest,
  updateRoleRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { RolesService } from '../application/roles.service.js';

@Controller('roles')
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @RequirePermission('read', 'Role')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<RoleResponse>> {
    return this.roles.list(query);
  }

  @RequirePermission('read', 'Role')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponse> {
    return this.roles.get(id);
  }

  @RequirePermission('create', 'Role')
  @Post()
  create(@Body(new ZodValidationPipe(createRoleRequestSchema)) body: CreateRoleRequest): Promise<RoleResponse> {
    return this.roles.create(body);
  }

  @RequirePermission('update', 'Role')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateRoleRequestSchema)) body: UpdateRoleRequest): Promise<RoleResponse> {
    return this.roles.update(id, body);
  }

  @RequirePermission('update', 'Role')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponse> {
    return this.roles.activate(id);
  }

  @RequirePermission('delete', 'Role')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponse> {
    return this.roles.deactivate(id);
  }

  @RequirePermission('delete', 'Role')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.roles.remove(id);
  }

  @RequirePermission('read', 'Role')
  @Get(':id/permissions')
  permissions(@Param('id', ParseUUIDPipe) id: string): Promise<RolePermissionResponse[]> {
    return this.roles.permissions(id);
  }

  @RequirePermission('update', 'Role')
  @Put(':id/permissions')
  replacePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(replaceRolePermissionsRequestSchema)) body: ReplaceRolePermissionsRequest,
  ): Promise<RolePermissionResponse[]> {
    return this.roles.replacePermissions(id, body);
  }
}
