import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import {
  type AddCountryHolidayRequest,
  addCountryHolidayRequestSchema,
  type CountrySummary,
  type CreateCountryRequest,
  createCountryRequestSchema,
  type CountryHolidayResponse,
  type CountryHolidaysQuery,
  countryHolidaysQuerySchema,
  isoDateSchema,
  type RegenerateHolidaysRequest,
  regenerateHolidaysRequestSchema,
  type RegeneratedHolidays,
} from '@procesabpm/shared';
import { z } from 'zod';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CountryCatalogService } from '../application/country-catalog.service.js';

const countryCodePipe = new ZodValidationPipe(z.string().regex(/^[A-Z]{2}$/));

@PlatformAdminOnly()
@Controller('platform/catalog/countries')
export class PlatformCatalogController {
  constructor(@Inject(CountryCatalogService) private readonly catalog: CountryCatalogService) {}

  @Get()
  listCountries(): Promise<CountrySummary[]> {
    return this.catalog.listCountries();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createCountry(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Body(new ZodValidationPipe(createCountryRequestSchema)) body: CreateCountryRequest): Promise<CountrySummary> {
    return this.catalog.createCountry(admin.userId, body);
  }

  @Get(':code/holidays')
  listHolidays(@Param('code', countryCodePipe) code: string, @Query(new ZodValidationPipe(countryHolidaysQuerySchema)) query: CountryHolidaysQuery): Promise<CountryHolidayResponse[]> {
    return this.catalog.listHolidays(code, query.year);
  }

  @Post(':code/holidays')
  @HttpCode(HttpStatus.CREATED)
  addHoliday(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('code', countryCodePipe) code: string,
    @Body(new ZodValidationPipe(addCountryHolidayRequestSchema)) body: AddCountryHolidayRequest,
  ): Promise<CountryHolidayResponse> {
    return this.catalog.addHoliday(admin.userId, code, body);
  }

  @Delete(':code/holidays/:date')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteHoliday(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('code', countryCodePipe) code: string,
    @Param('date', new ZodValidationPipe(isoDateSchema)) date: string,
  ): Promise<void> {
    return this.catalog.deleteHoliday(admin.userId, code, date);
  }

  @Post(':code/holidays/regenerate')
  @HttpCode(HttpStatus.OK)
  regenerate(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('code', countryCodePipe) code: string,
    @Body(new ZodValidationPipe(regenerateHolidaysRequestSchema)) body: RegenerateHolidaysRequest,
  ): Promise<RegeneratedHolidays> {
    return this.catalog.regenerateYear(admin.userId, code, body.year);
  }
}
