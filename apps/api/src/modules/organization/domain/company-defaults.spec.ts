import { describe, expect, it } from 'vitest';
import { resolveCompanyRegion } from './company-defaults.js';

const country = { currencyCode: 'COP', timeZone: 'America/Bogota' };

describe('resolveCompanyRegion', () => {
  it('derives both values from the country', () => {
    expect(resolveCompanyRegion({}, country)).toEqual(country);
  });

  it('keeps what the caller chose', () => {
    expect(resolveCompanyRegion({ currencyCode: 'USD' }, country)).toEqual({ currencyCode: 'USD', timeZone: 'America/Bogota' });
    expect(resolveCompanyRegion({ timeZone: 'UTC' }, country)).toEqual({ currencyCode: 'COP', timeZone: 'UTC' });
  });
});
