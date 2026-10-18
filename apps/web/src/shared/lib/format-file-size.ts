const LOCALE = 'es-CO';
const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;

/** A file size people read at a glance ("850 byte", "12 kB", "3,4 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < KILOBYTE) return unit(bytes, 'byte', 0);
  if (bytes < MEGABYTE) return unit(bytes / KILOBYTE, 'kilobyte', 0);
  return unit(bytes / MEGABYTE, 'megabyte', 1);
}

function unit(value: number, name: string, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits }).format(value);
}
