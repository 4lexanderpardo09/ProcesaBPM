import { Injectable } from '@nestjs/common';
import type { BusinessCalendar } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { toBusinessCalendar } from '../../organization/domain/calendar-mapping.js';

export interface MemberRow {
  readonly userId: string;
  readonly name: string;
  readonly positionId: string | null;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  readonly companyIds: readonly string[];
}

export interface CompanyRow {
  readonly id: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly calendarId: string | null;
}

/** The calendar a company works with, and its id (visits and clocks keep the id). */
export interface ResolvedCalendar {
  readonly id: string;
  readonly calendar: BusinessCalendar;
}

/** Holidays are loaded for this window around the start of a clock (calendars hold years of them). */
const HOLIDAY_WINDOW_BEFORE_MS = 86_400_000;
const HOLIDAY_WINDOW_AFTER_MS = 2 * 366 * 86_400_000;

/** Reads of the people, company and calendar a ticket depends on. Every query carries the tenant. */
@Injectable()
export class TicketContextRepository {
  /** An active member of an enabled user, with their companies; `null` when they cannot take part in tickets. */
  async findActiveMember(tx: TenantTransaction, tenantId: string, userId: string): Promise<MemberRow | null> {
    const membership = await tx.membership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE', user: { status: { not: 'DISABLED' } } },
      select: { userId: true, positionId: true, departmentId: true, siteId: true, user: { select: { firstName: true, lastName: true } }, companies: { select: { companyId: true } } },
    });
    return membership === null
      ? null
      : {
          userId: membership.userId,
          name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
          positionId: membership.positionId,
          departmentId: membership.departmentId,
          siteId: membership.siteId,
          companyIds: membership.companies.map((row) => row.companyId),
        };
  }

  /**
   * The subcategory when a person of the company and department may pick it: both it and its category are
   * active, and a category with no visibility rows on an axis is open on that axis (as in the catalog).
   */
  findAvailableSubcategory(tx: TenantTransaction, tenantId: string, subcategoryId: string, companyId: string, departmentId: string | null): Promise<{ defaultPriorityId: string | null } | null> {
    return tx.subcategory.findFirst({
      where: {
        tenantId,
        id: subcategoryId,
        isActive: true,
        category: {
          isActive: true,
          AND: [
            { OR: [{ companies: { none: {} } }, { companies: { some: { companyId } } }] },
            { OR: [{ departments: { none: {} } }, ...(departmentId === null ? [] : [{ departments: { some: { departmentId } } }])] },
          ],
        },
      },
      select: { defaultPriorityId: true },
    });
  }

  /** An active error type meant for reopening that does not force a close, with its subtype (if any) belonging to it and active. */
  async findReopeningErrorType(tx: TenantTransaction, tenantId: string, errorTypeId: string, errorSubtypeId: string | undefined): Promise<{ isProcessError: boolean } | null> {
    const type = await tx.errorType.findFirst({ where: { tenantId, id: errorTypeId, isActive: true, isReopening: true, forcesClose: false }, select: { isProcessError: true } });
    if (type === null) return null;
    if (errorSubtypeId !== undefined && (await tx.errorSubtype.count({ where: { tenantId, id: errorSubtypeId, errorTypeId, isActive: true } })) === 0) return null;
    return type;
  }

  async activeGroupIdsOf(tx: TenantTransaction, tenantId: string, userId: string): Promise<Set<string>> {
    const rows = await tx.groupMember.findMany({ where: { tenantId, userId, group: { isActive: true } }, select: { groupId: true } });
    return new Set(rows.map((row) => row.groupId));
  }

  /** The site and all its ancestors, the site first. */
  async siteAncestry(tx: TenantTransaction, tenantId: string, siteId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, 1 AS depth FROM sites WHERE tenant_id = ${tenantId}::uuid AND id = ${siteId}::uuid
        UNION ALL
        SELECT s.id, s.parent_id, c.depth + 1 FROM sites s
        JOIN chain c ON s.tenant_id = ${tenantId}::uuid AND s.id = c.parent_id
        WHERE c.depth < 20
      )
      SELECT id::text AS id FROM chain ORDER BY depth`;
    return rows.map((row) => row.id);
  }

  /** A company; tickets that already exist keep working when their company was deactivated since (`onlyActive: false`). */
  findCompany(tx: TenantTransaction, tenantId: string, companyId: string, onlyActive = true): Promise<CompanyRow | null> {
    return tx.company.findFirst({ where: { tenantId, id: companyId, ...(onlyActive ? { isActive: true } : {}) }, select: { id: true, currencyCode: true, timeZone: true, calendarId: true } });
  }

  /** The calendar with that id, or the tenant's default one when `calendarId` is `null`; `null` when there is none. */
  async findBusinessCalendar(tx: TenantTransaction, tenantId: string, timeZone: string, calendarId: string | null, around: Date): Promise<ResolvedCalendar | null> {
    const calendar = await tx.calendar.findFirst({
      where: calendarId === null ? { tenantId, isDefault: true } : { tenantId, id: calendarId },
      select: {
        id: true,
        workingHours: { select: { weekday: true, startTime: true, endTime: true } },
        holidays: { where: { date: { gte: new Date(around.getTime() - HOLIDAY_WINDOW_BEFORE_MS), lte: new Date(around.getTime() + HOLIDAY_WINDOW_AFTER_MS) } }, select: { date: true } },
      },
    });
    return calendar === null ? null : { id: calendar.id, calendar: toBusinessCalendar({ timeZone, workingHours: calendar.workingHours, holidays: calendar.holidays }) };
  }
}
