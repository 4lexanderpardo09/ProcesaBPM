import { Injectable } from '@nestjs/common';
import type { ErrorTypeTemplate, PriorityTemplate } from '@procesabpm/db';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface WorkingSlotRow {
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
}

export interface NewCompany {
  readonly name: string;
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly calendarId: string;
}

/** Every row is written with an explicit `tenantId`: the platform login bypasses row-level security. */
@Injectable()
export class TenantDefaultsRepository {
  async createCalendar(tx: PlatformTransaction, tenantId: string, name: string, countryCode: string): Promise<string> {
    const calendar = await tx.calendar.create({ data: { tenantId, name, countryCode, isDefault: true }, select: { id: true } });
    return calendar.id;
  }

  async createWorkingHours(tx: PlatformTransaction, tenantId: string, calendarId: string, slots: readonly WorkingSlotRow[]): Promise<void> {
    await tx.calendarWorkingHours.createMany({
      data: slots.map(({ weekday, startTime, endTime }) => ({
        tenantId,
        calendarId,
        weekday,
        startTime: new Date(`1970-01-01T${startTime}:00Z`),
        endTime: new Date(`1970-01-01T${endTime}:00Z`),
      })),
    });
  }

  /** Copies the holidays of the country whose date falls in `[from, to]` (ISO dates, inclusive). */
  async copyCountryHolidays(
    tx: PlatformTransaction,
    target: { tenantId: string; calendarId: string },
    source: { countryCode: string; from: string; to: string },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO calendar_holidays (tenant_id, calendar_id, date, name)
      SELECT ${target.tenantId}::uuid, ${target.calendarId}::uuid, h.date, h.name
      FROM country_holidays h
      WHERE h.country_code = ${source.countryCode} AND h.date BETWEEN ${source.from}::date AND ${source.to}::date`;
  }

  async createDefaultCompany(tx: PlatformTransaction, tenantId: string, company: NewCompany): Promise<string> {
    const created = await tx.company.create({ data: { tenantId, isDefault: true, ...company }, select: { id: true } });
    return created.id;
  }

  async createApprovalGroupType(tx: PlatformTransaction, tenantId: string, name: string): Promise<void> {
    await tx.approvalGroupType.create({ data: { tenantId, name, isDefault: true } });
  }

  async createPriorities(tx: PlatformTransaction, tenantId: string, priorities: readonly PriorityTemplate[]): Promise<void> {
    await tx.priority.createMany({ data: priorities.map((priority) => ({ tenantId, ...priority })) });
  }

  async createErrorTypes(tx: PlatformTransaction, tenantId: string, errorTypes: readonly ErrorTypeTemplate[]): Promise<void> {
    await tx.errorType.createMany({ data: errorTypes.map((errorType) => ({ tenantId, ...errorType })) });
  }
}
