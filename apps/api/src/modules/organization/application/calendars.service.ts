import { Inject, Injectable } from '@nestjs/common';
import {
  type CalendarDetailResponse,
  type CalendarResponse,
  type CreateCalendarRequest,
  InvalidStateError,
  NotFoundError,
  type Page,
  type PageQuery,
  type ReplaceWorkingDayRequest,
  type UpdateCalendarRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CalendarRepository, type CalendarRow } from '../data/calendar.repository.js';
import { formatTimeOfDay } from '../domain/calendar-mapping.js';

const toResponse = (row: CalendarRow): CalendarResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class CalendarsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CalendarRepository) private readonly repository: CalendarRepository,
  ) {}

  list(query: PageQuery): Promise<Page<CalendarResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<CalendarDetailResponse> {
    return this.runner.withTenantTransaction((tx) => this.detail(tx, id));
  }

  create(request: CreateCalendarRequest): Promise<CalendarResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.repository.create(tx, this.tenantId, { name: request.name, ...compact({ countryCode: request.countryCode }) })));
  }

  update(id: string, request: UpdateCalendarRequest): Promise<CalendarResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, compact(request));
      return toResponse(await this.require(tx, id));
    });
  }

  /** The default calendar cannot go; one in use by a company is refused by the database (foreign key). */
  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      const calendar = await this.require(tx, id);
      if (calendar.isDefault) throw new InvalidStateError('The default calendar cannot be deleted');
      await this.repository.remove(tx, this.tenantId, id);
    });
  }

  /** Replaces every slot of the weekday in one operation; overlapping slots are rejected by the database (exclusion constraint). */
  replaceWorkingDay(id: string, weekday: number, request: ReplaceWorkingDayRequest): Promise<CalendarDetailResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.replaceWorkingDay(tx, this.tenantId, id, weekday, request.slots);
      return this.detail(tx, id);
    });
  }

  private async detail(tx: TenantTransaction, id: string): Promise<CalendarDetailResponse> {
    const calendar = await this.require(tx, id);
    const hours = await this.repository.findWorkingHours(tx, this.tenantId, id);
    return {
      ...toResponse(calendar),
      workingHours: hours.map((row) => ({ weekday: row.weekday, startTime: formatTimeOfDay(row.startTime), endTime: formatTimeOfDay(row.endTime) })),
    };
  }

  private async require(tx: TenantTransaction, id: string): Promise<CalendarRow> {
    const calendar = await this.repository.findById(tx, this.tenantId, id);
    if (calendar === null) throw new NotFoundError();
    return calendar;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
