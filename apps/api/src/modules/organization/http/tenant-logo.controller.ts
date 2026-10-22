import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  type RequestUploadsRequest,
  requestPdfImageUploadSchema,
  type SetTenantLogoRequest,
  setTenantLogoRequestSchema,
  type StoredFileResponse,
  type TenantLogoResponse,
  type UploadsResponse,
} from '@procesabpm/shared';
import { Audited, NotAudited } from '../../../common/audit/audited.decorator.js';
import { AuthenticatedOnly, RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { UploadConfirmationService } from '../../files/application/upload-confirmation.service.js';
import { UploadRequestService } from '../../files/application/upload-request.service.js';
import { TenantLogoService } from '../application/tenant-logo.service.js';

@Controller('settings/logo')
export class TenantLogoController {
  constructor(
    @Inject(TenantLogoService) private readonly logos: TenantLogoService,
    @Inject(UploadRequestService) private readonly uploads: UploadRequestService,
    @Inject(UploadConfirmationService) private readonly confirmation: UploadConfirmationService,
  ) {}

  /** Anyone in the organization sees its logo (the PDFs and the app show it); null when there is none. */
  @AuthenticatedOnly()
  @Get()
  get(): Promise<TenantLogoResponse | null> {
    return this.logos.get();
  }

  /** The image travels like any upload (reserve, send to the storage, confirm), with the permission to change settings. */
  @RequirePermission('update', 'Setting')
  @NotAudited('reserves an upload; the logo changes, and is audited, when it is set')
  @Post('uploads')
  requestUpload(@Body(new ZodValidationPipe(requestPdfImageUploadSchema)) body: RequestUploadsRequest): Promise<UploadsResponse> {
    return this.uploads.request(body);
  }

  @RequirePermission('update', 'Setting')
  @NotAudited('confirms an upload; the logo changes, and is audited, when it is set')
  @Post('uploads/:fileId/confirm')
  @HttpCode(HttpStatus.OK)
  confirmUpload(@Param('fileId', ParseUUIDPipe) fileId: string): Promise<StoredFileResponse> {
    return this.confirmation.confirm(fileId);
  }

  @RequirePermission('update', 'Setting')
  @Audited('tenant.logo_updated')
  @Put()
  set(@Body(new ZodValidationPipe(setTenantLogoRequestSchema)) body: SetTenantLogoRequest): Promise<TenantLogoResponse> {
    return this.logos.set(body);
  }

  @RequirePermission('update', 'Setting')
  @Audited('tenant.logo_removed')
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): Promise<void> {
    return this.logos.remove();
  }
}
