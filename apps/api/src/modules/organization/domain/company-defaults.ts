export interface CountryDefaults {
  readonly currencyCode: string;
  readonly timeZone: string;
}

export interface CompanyRegionInput {
  readonly currencyCode?: string | undefined;
  readonly timeZone?: string | undefined;
}

/** Currency and time zone the caller did not choose come from the country. */
export function resolveCompanyRegion(input: CompanyRegionInput, country: CountryDefaults): CountryDefaults {
  return { currencyCode: input.currencyCode ?? country.currencyCode, timeZone: input.timeZone ?? country.timeZone };
}
