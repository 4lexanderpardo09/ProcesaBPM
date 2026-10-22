import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { TenantLogoService } from './application/tenant-logo.service.js';
import { TenantLogoRepository } from './data/tenant-logo.repository.js';
import { TenantLogoController } from './http/tenant-logo.controller.js';
import { CalendarHolidaysService } from './application/calendar-holidays.service.js';
import { CalendarPreviewService } from './application/calendar-preview.service.js';
import { CalendarsService } from './application/calendars.service.js';
import { CompaniesService } from './application/companies.service.js';
import { DepartmentsService } from './application/departments.service.js';
import { PositionsService } from './application/positions.service.js';
import { SiteLevelsService } from './application/site-levels.service.js';
import { SitesService } from './application/sites.service.js';
import { CalendarHolidayRepository } from './data/calendar-holiday.repository.js';
import { CalendarRepository } from './data/calendar.repository.js';
import { CompanyRepository } from './data/company.repository.js';
import { DepartmentRepository } from './data/department.repository.js';
import { PositionRepository } from './data/position.repository.js';
import { SiteLevelRepository } from './data/site-level.repository.js';
import { SiteRepository } from './data/site.repository.js';
import { CalendarsController } from './http/calendars.controller.js';
import { CountriesController } from './http/countries.controller.js';
import { CompaniesController } from './http/companies.controller.js';
import { DepartmentsController } from './http/departments.controller.js';
import { PositionsController } from './http/positions.controller.js';
import { SiteLevelsController } from './http/site-levels.controller.js';
import { SitesController } from './http/sites.controller.js';

/** Companies, departments, positions, sites, calendars and the logo of a tenant. */
@Module({
  imports: [FilesModule],
  controllers: [TenantLogoController, CompaniesController, CountriesController, DepartmentsController, PositionsController, SiteLevelsController, SitesController, CalendarsController],
  providers: [
    TenantLogoRepository,
    TenantLogoService,
    CompanyRepository,
    DepartmentRepository,
    PositionRepository,
    SiteRepository,
    SiteLevelRepository,
    CalendarRepository,
    CalendarHolidayRepository,
    CompaniesService,
    DepartmentsService,
    PositionsService,
    SitesService,
    SiteLevelsService,
    CalendarsService,
    CalendarHolidaysService,
    CalendarPreviewService,
  ],
})
export class OrganizationModule {}
