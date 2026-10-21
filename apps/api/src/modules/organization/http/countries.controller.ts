import { Controller, Get, Inject } from '@nestjs/common';
import type { CountryResponse } from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { CompaniesService } from '../application/companies.service.js';

/** The countries a company can be of, for whoever manages companies (the list is the platform's, the same for every tenant). */
@Controller('countries')
export class CountriesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @RequirePermission('read', 'Company')
  @Get()
  list(): Promise<CountryResponse[]> {
    return this.companies.countries();
  }
}
