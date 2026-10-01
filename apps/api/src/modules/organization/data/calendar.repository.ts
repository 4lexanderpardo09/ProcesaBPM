import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface CalendarRow {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string | null;
  readonly isDefault: boolean;
  readonly createdAt: Date;
}

export interface WorkingHoursRow {
  readonly weekday: number;
  readonly startTime: Date;
  readonly endTime: Date;
}

export interface WorkingSlotInput {
  readonly startTime: string;
  readonly endTime: string;
}

const SELECT = { id: true, name: true, countryCode: true, isDefault: true, createdAt: true } as const;

/** Prisma maps `time` columns to a `Date` on 1970-01-01; the instant is the time of day in UTC. */
const timeColumn = (value: string): Date => new Date(`1970-01-01T${value}:00Z`);

@Injectable()
export class CalendarRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: CalendarRow[]; total: number }> {
    const where = { tenantId, ...(query.search === undefined ? {} : { name: { contains: query.search, mode: 'insensitive' as const } }) };
    const [rows, total] = await Promise.all([
      tx.calendar.findMany({ where, select: SELECT, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], ...pageWindow(query) }),
      tx.calendar.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<CalendarRow | null> {
    return tx.calendar.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { name: string; countryCode?: string }): Promise<CalendarRow> {
    return tx.calendar.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; countryCode?: string | null }): Promise<void> {
    await tx.calendar.updateMany({ where: { tenantId, id }, data });
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.calendar.deleteMany({ where: { tenantId, id } });
  }

  async isInUse(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    return (await tx.company.count({ where: { tenantId, calendarId: id } })) > 0;
  }

  findWorkingHours(tx: TenantTransaction, tenantId: string, calendarId: string): Promise<WorkingHoursRow[]> {
    return tx.calendarWorkingHours.findMany({
      where: { tenantId, calendarId },
      select: { weekday: true, startTime: true, endTime: true },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
  }

  /** The new slots are inserted right after the old ones are removed, in the caller's transaction. */
  async replaceWorkingDay(tx: TenantTransaction, tenantId: string, calendarId: string, weekday: number, slots: readonly WorkingSlotInput[]): Promise<void> {
    await tx.calendarWorkingHours.deleteMany({ where: { tenantId, calendarId, weekday } });
    await tx.calendarWorkingHours.createMany({
      data: slots.map((slot) => ({ tenantId, calendarId, weekday, startTime: timeColumn(slot.startTime), endTime: timeColumn(slot.endTime) })),
    });
  }

  async findTenantTimeZone(tx: TenantTransaction, tenantId: string): Promise<string | undefined> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timeZone: true } });
    return tenant?.timeZone;
  }

  async findCountryTimeZone(tx: TenantTransaction, countryCode: string): Promise<string | undefined> {
    const country = await tx.country.findUnique({ where: { code: countryCode }, select: { timeZone: true } });
    return country?.timeZone;
  }
}
