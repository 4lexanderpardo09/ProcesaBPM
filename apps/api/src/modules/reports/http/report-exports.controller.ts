import { Controller, Get, Inject, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { exportReportNameSchema, type ReportName } from '@procesabpm/shared';
import type { Response } from 'express';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { contentDisposition } from '../../../infrastructure/storage/content-disposition.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { ReportExportService } from '../application/report-export.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('reports')
export class ReportExportsController {
  constructor(@Inject(ReportExportService) private readonly exports: ReportExportService) {}

  /** The same filters as the report itself. Needs `export Report` on top of `read Report`. */
  @RequirePermission('export', 'Report')
  @Get(':report/export')
  @Audited('report.exported')
  async export(
    @CurrentAbility() ability: AppAbility,
    @Param('report', new ZodValidationPipe(exportReportNameSchema)) report: ReportName,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.exports.export(ability, report, query);
    response.setHeader('Content-Type', XLSX);
    response.setHeader('Content-Disposition', contentDisposition('attachment', fileName));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(buffer);
  }
}
