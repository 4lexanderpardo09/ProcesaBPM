import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AddHolidayRequest,
  addHolidayRequestSchema,
  type CalendarDetailResponse,
  type CalendarResponse,
  type CreateCalendarRequest,
  createCalendarRequestSchema,
  type HolidayResponse,
  type HolidaysQuery,
  holidaysQuerySchema,
  type ImportHolidaysRequest,
  type ImportHolidaysResponse,
  importHolidaysRequestSchema,
  isoDateSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type PreviewDueDateRequest,
  type PreviewDueDateResponse,
  previewDueDateRequestSchema,
  type ReplaceWorkingDayRequest,
  replaceWorkingDayRequestSchema,
  type UpdateCalendarRequest,
  updateCalendarRequestSchema,
  weekdayParamSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CalendarHolidaysService } from '../application/calendar-holidays.service.js';
import { CalendarPreviewService } from '../application/calendar-preview.service.js';
import { CalendarsService } from '../application/calendars.service.js';

@Controller('calendars')
export class CalendarsController {
  constructor(
    @Inject(CalendarsService) private readonly calendars: CalendarsService,
    @Inject(CalendarHolidaysService) private readonly holidays: CalendarHolidaysService,
    @Inject(CalendarPreviewService) private readonly previews: CalendarPreviewService,
  ) {}

  @RequirePermission('read', 'Calendar')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<CalendarResponse>> {
    return this.calendars.list(query);
  }

  @RequirePermission('read', 'Calendar')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CalendarDetailResponse> {
    return this.calendars.get(id);
  }

  @RequirePermission('create', 'Calendar')
  @Post()
  create(@Body(new ZodValidationPipe(createCalendarRequestSchema)) body: CreateCalendarRequest): Promise<CalendarResponse> {
    return this.calendars.create(body);
  }

  @RequirePermission('update', 'Calendar')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCalendarRequestSchema)) body: UpdateCalendarRequest): Promise<CalendarResponse> {
    return this.calendars.update(id, body);
  }

  @RequirePermission('delete', 'Calendar')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.calendars.remove(id);
  }

  @RequirePermission('update', 'Calendar')
  @Put(':id/working-hours/:weekday')
  replaceWorkingDay(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('weekday', new ZodValidationPipe(weekdayParamSchema)) weekday: number,
    @Body(new ZodValidationPipe(replaceWorkingDayRequestSchema)) body: ReplaceWorkingDayRequest,
  ): Promise<CalendarDetailResponse> {
    return this.calendars.replaceWorkingDay(id, weekday, body);
  }

  @RequirePermission('read', 'Calendar')
  @Get(':id/holidays')
  listHolidays(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(holidaysQuerySchema)) query: HolidaysQuery): Promise<HolidayResponse[]> {
    return this.holidays.list(id, query.year);
  }

  @RequirePermission('update', 'Calendar')
  @Post(':id/holidays')
  addHoliday(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addHolidayRequestSchema)) body: AddHolidayRequest): Promise<HolidayResponse> {
    return this.holidays.add(id, body);
  }

  /** Declared before `:date` so that "import" is not taken as a date. */
  @RequirePermission('update', 'Calendar')
  @Post(':id/holidays/import')
  @HttpCode(HttpStatus.OK)
  importHolidays(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(importHolidaysRequestSchema)) body: ImportHolidaysRequest): Promise<ImportHolidaysResponse> {
    return this.holidays.importFromCountry(id, body.year);
  }

  @RequirePermission('update', 'Calendar')
  @Delete(':id/holidays/:date')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHoliday(@Param('id', ParseUUIDPipe) id: string, @Param('date', new ZodValidationPipe(isoDateSchema)) date: string): Promise<void> {
    return this.holidays.remove(id, date);
  }

  @RequirePermission('read', 'Calendar')
  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(previewDueDateRequestSchema)) body: PreviewDueDateRequest): Promise<PreviewDueDateResponse> {
    return this.previews.preview(id, body);
  }
}
