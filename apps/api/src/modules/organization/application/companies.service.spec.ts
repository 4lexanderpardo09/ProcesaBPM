import { InvalidReferenceError, InvalidStateError, NotFoundError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { CompanyRepository, CompanyRow } from '../data/company.repository.js';
import { CompaniesService } from './companies.service.js';

const TENANT = '018f3c1e-7b2a-7c3d-9e4f-000000000001';
const row = (overrides: Partial<CompanyRow> = {}): CompanyRow => ({
  id: 'company-1',
  name: 'Acme',
  taxId: null,
  countryCode: 'CO',
  currencyCode: 'COP',
  timeZone: 'America/Bogota',
  calendarId: null,
  isDefault: false,
  isActive: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
});

function build(stored: CompanyRow | null) {
  const repository = {
    findById: vi.fn().mockResolvedValue(stored),
    findCountry: vi.fn().mockResolvedValue({ currencyCode: 'MXN', timeZone: 'America/Mexico_City' }),
    create: vi.fn().mockImplementation((_tx, _tenant, data) => Promise.resolve(row(data))),
    update: vi.fn().mockResolvedValue(true),
    setActive: vi.fn().mockResolvedValue(true),
    makeDefault: vi.fn().mockResolvedValue(true),
  };
  const runner = { withTenantTransaction: (work: (tx: unknown) => Promise<unknown>) => work({}) } as unknown as TenantTransactionRunner;
  const context = { require: () => ({ tenantId: TENANT, userId: 'u' }) } as unknown as TenantContext;
  return { service: new CompaniesService(runner, context, repository as unknown as CompanyRepository), repository };
}

describe('CompaniesService', () => {
  it('derives currency and time zone from the country on creation', async () => {
    const { service, repository } = build(null);
    await service.create({ name: 'Mex', countryCode: 'MX' });
    expect(repository.create).toHaveBeenCalledWith(expect.anything(), TENANT, { name: 'Mex', countryCode: 'MX', currencyCode: 'MXN', timeZone: 'America/Mexico_City' });
  });

  it('refuses an unknown country', async () => {
    const { service, repository } = build(null);
    repository.findCountry.mockResolvedValue(null);
    await expect(service.create({ name: 'X', countryCode: 'ZZ' })).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('re-derives currency and time zone when the country changes without them', async () => {
    const { service, repository } = build(row());
    await service.update('company-1', { countryCode: 'MX' });
    expect(repository.update).toHaveBeenCalledWith(expect.anything(), TENANT, 'company-1', { countryCode: 'MX', currencyCode: 'MXN', timeZone: 'America/Mexico_City' });
  });

  it('a missing company is a 404-type error', async () => {
    const { service } = build(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the default company cannot be deactivated', async () => {
    const { service, repository } = build(row({ isDefault: true }));
    await expect(service.deactivate('company-1')).rejects.toBeInstanceOf(InvalidStateError);
    expect(repository.setActive).not.toHaveBeenCalled();
  });

  it('an inactive company cannot become the default; an active one clears the previous default first', async () => {
    const inactive = build(row({ isActive: false }));
    await expect(inactive.service.makeDefault('company-1')).rejects.toBeInstanceOf(InvalidStateError);
    const active = build(row());
    await active.service.makeDefault('company-1');
    expect(active.repository.makeDefault).toHaveBeenCalledWith(expect.anything(), TENANT, 'company-1');
  });

  it('making the current default the default again changes nothing', async () => {
    const { service, repository } = build(row({ isDefault: true }));
    await service.makeDefault('company-1');
    expect(repository.makeDefault).not.toHaveBeenCalled();
  });
});
