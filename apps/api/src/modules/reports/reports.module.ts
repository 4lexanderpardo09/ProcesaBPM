import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { SUBJECT_REGISTRY } from '../authorization/application/ability.service.js';
import { SpreadsheetModule } from '../../infrastructure/spreadsheet/spreadsheet.module.js';
import { AuthorizationCoreModule } from '../authorization/authorization-core.module.js';
import type { SubjectRegistry } from '../authorization/domain/subject-registry.js';
import { BreakdownReportsService } from './application/breakdown-reports.service.js';
import { PerformanceReportsService } from './application/performance-reports.service.js';
import { ReportExportService } from './application/report-export.service.js';
import { ReportRunner } from './application/report-runner.js';
import { CatalogReportRepository } from './data/catalog-report.repository.js';
import { IncidentRepository } from './data/incident.repository.js';
import { PerformanceRepository } from './data/performance.repository.js';
import { UserDetailRepository } from './data/user-detail.repository.js';
import { REPORT_SCOPE_FIELDS } from './domain/report-scope.js';
import { ReportExportsController } from './http/report-exports.controller.js';
import { ReportsController } from './http/reports.controller.js';

/** Live reports (performance, SLA, ranking, incidents, categories, backlog). A `Report` permission may be limited by company, department, site or workflow. */
@Module({
  imports: [AuthorizationCoreModule, SpreadsheetModule],
  controllers: [ReportsController, ReportExportsController],
  providers: [ReportRunner, PerformanceRepository, IncidentRepository, CatalogReportRepository, UserDetailRepository, PerformanceReportsService, BreakdownReportsService, ReportExportService],
})
export class ReportsModule implements OnModuleInit {
  constructor(@Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry) {}

  onModuleInit(): void {
    this.registry.register('Report', { fields: new Set(REPORT_SCOPE_FIELDS) });
  }
}
