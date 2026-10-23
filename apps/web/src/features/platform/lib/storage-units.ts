/** Storage in the console: bytes travel as decimal text; people read and type gigabytes and megabytes. */
export const GIGABYTE = 1024 ** 3;
export const MEGABYTE = 1024 ** 2;

const formatter = (unit: 'gigabyte' | 'megabyte') => new Intl.NumberFormat('es-CO', { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 });

/** "10 GB", "512 MB": gigabytes from one up. */
export function formatStorage(bytes: string | number): string {
  const value = Number(bytes);
  return value >= GIGABYTE ? formatter('gigabyte').format(value / GIGABYTE) : formatter('megabyte').format(value / MEGABYTE);
}

/** A typed amount of a unit ("1,5" or "1.5") as whole bytes in decimal text; `undefined` when it is not a number ≥ 0. */
export function bytesOf(text: string, unit: number): string | undefined {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) || value < 0 ? undefined : String(Math.round(value * unit));
}

/** Bytes as the amount of a unit, for an input. */
export const amountOf = (bytes: string, unit: number): string => String(Math.round((Number(bytes) / unit) * 100) / 100);
