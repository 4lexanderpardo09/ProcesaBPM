import { colombianHolidays, type Holiday } from './colombia.js';

const GENERATORS: Readonly<Record<string, (year: number) => Holiday[]>> = {
  CO: colombianHolidays,
};

/** The rule-based holiday calendar of a country, when the platform ships one. */
export function holidayGeneratorFor(countryCode: string): ((year: number) => Holiday[]) | undefined {
  return GENERATORS[countryCode];
}
