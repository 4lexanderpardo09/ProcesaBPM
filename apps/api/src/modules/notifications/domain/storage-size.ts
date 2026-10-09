const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A byte count for people (binary units, one decimal from MB up, Colombian Spanish separators): "1,5 GB". */
export function formatStorageSize(bytes: bigint): string {
  let unit = 0;
  let value = Number(bytes);
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit >= 2 ? 1 : 0;
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimals }).format(value)} ${UNITS[unit]}`;
}
