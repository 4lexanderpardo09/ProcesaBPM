import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import {
  type DataExportListResponse,
  type DataExportResponse,
  type DownloadUrlResponse,
  type IssueDataExportDownload,
  issueDataExportDownloadSchema,
  type RequestDataExport,
  requestDataExportSchema,
  uuidSchema,
} from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { AvailableDuringDeletion } from '../../../common/auth/available-during-deletion.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { DataExportDownloadsService } from '../application/data-export-downloads.service.js';
import { DataExportRequestsService } from '../application/data-export-requests.service.js';

/**
 * The organization's data export during the deletion period. Not a permission of the catalog: the services allow only the
 * owner or an active administrator (fixed full-access rule), so no custom role can be given it.
 */
@Controller('data-exports')
@AuthenticatedOnly()
export class DataExportsController {
  constructor(
    @Inject(DataExportRequestsService) private readonly requests: DataExportRequestsService,
    @Inject(DataExportDownloadsService) private readonly downloads: DataExportDownloadsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @AvailableDuringDeletion()
  @Audited('data_export.requested')
  request(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(requestDataExportSchema)) body: RequestDataExport): Promise<DataExportResponse> {
    return this.requests.request(principal, body);
  }

  @Get()
  @AvailableDuringDeletion()
  list(@CurrentPrincipal() principal: Principal): Promise<DataExportListResponse> {
    return this.requests.list(principal);
  }

  @Get(':id')
  @AvailableDuringDeletion()
  get(@CurrentPrincipal() principal: Principal, @Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<DataExportResponse> {
    return this.requests.get(principal, id);
  }

  @Post(':id/download-url')
  @HttpCode(HttpStatus.OK)
  @AvailableDuringDeletion()
  @Audited('data_export.download_url_issued')
  downloadUrl(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(issueDataExportDownloadSchema)) body: IssueDataExportDownload,
  ): Promise<DownloadUrlResponse> {
    return this.downloads.issueUrl(principal, id, body);
  }
}
