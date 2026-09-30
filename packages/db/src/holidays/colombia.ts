/**
 * Colombian public holidays for any year.
 *
 * Rules (Ley 51 de 1983 "Ley Emiliani" and Ley 2578 de 2026):
 * - Fixed dates that never move: 1 Jan, 1 May, 20 Jul, 7 Aug, 8 Dec, 25 Dec.
 * - Movable dates: when they do not fall on a Monday they move to the next Monday.
 * - Easter-based dates: Holy Thursday and Good Friday stay; Ascension, Corpus Christi
 *   and Sacred Heart are moved to the Monday after their Sunday/Thursday/Friday.
 * - Virgen de Chiquinquirá (9 Jul) is a movable holiday from 2026 onwards.
 */
export interface Holiday {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  name: string;
}

const CHIQUINQUIRA_FIRST_YEAR = 2026;

const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number, name: string]> = [
  [1, 1, 'Año Nuevo'],
  [5, 1, 'Día del Trabajo'],
  [7, 20, 'Día de la Independencia'],
  [8, 7, 'Batalla de Boyacá'],
  [12, 8, 'Inmaculada Concepción'],
  [12, 25, 'Navidad'],
];

const MOVABLE_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number, name: string]> = [
  [1, 6, 'Reyes Magos'],
  [3, 19, 'San José'],
  [6, 29, 'San Pedro y San Pablo'],
  [8, 15, 'Asunción de la Virgen'],
  [10, 12, 'Día de la Raza'],
  [11, 1, 'Todos los Santos'],
  [11, 11, 'Independencia de Cartagena'],
];

const EASTER_HOLIDAYS: ReadonlyArray<readonly [daysFromEaster: number, name: string, movesToMonday: boolean]> = [
  [-3, 'Jueves Santo', false],
  [-2, 'Viernes Santo', false],
  [39, 'Ascensión del Señor', true],
  [60, 'Corpus Christi', true],
  [68, 'Sagrado Corazón de Jesús', true],
];

export function colombianHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  for (const [month, day, name] of FIXED_HOLIDAYS) {
    holidays.push({ date: toIsoDate(utcDate(year, month, day)), name });
  }
  for (const [month, day, name] of MOVABLE_HOLIDAYS) {
    holidays.push({ date: toIsoDate(nextMondayOrSame(utcDate(year, month, day))), name });
  }
  if (year >= CHIQUINQUIRA_FIRST_YEAR) {
    holidays.push({ date: toIsoDate(nextMondayOrSame(utcDate(year, 7, 9))), name: 'Virgen de Chiquinquirá' });
  }

  const easter = easterSunday(year);
  for (const [offset, name, movesToMonday] of EASTER_HOLIDAYS) {
    const date = addDays(easter, offset);
    holidays.push({ date: toIsoDate(movesToMonday ? nextMondayOrSame(date) : date), name });
  }

  return mergeSameDay(holidays);
}

/** Two holidays can land on the same Monday (e.g. 30 Jun 2025); keep one date with both names. */
function mergeSameDay(holidays: Holiday[]): Holiday[] {
  const byDate = new Map<string, string[]>();
  for (const { date, name } of holidays) {
    byDate.set(date, [...(byDate.get(date) ?? []), name]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, names]) => ({ date, name: names.join(' / ') }));
}

/** Gregorian Easter Sunday (anonymous Gregorian algorithm, Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

const MONDAY = 1;

function nextMondayOrSame(date: Date): Date {
  const daysUntilMonday = (MONDAY - date.getUTCDay() + 7) % 7;
  return addDays(date, daysUntilMonday);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
