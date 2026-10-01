/** Money is compared as integers scaled by 10^6: never with float arithmetic (0.1 + 0.2 ≠ 0.3). */
export const DECIMAL_SCALE = 6;
const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Exact scaled integer of a JSON number or a plain decimal string (`1500000.50`). Strings with thousands
 * separators or exponents are not numbers here (locale parsing belongs to the client); extra decimals
 * beyond the scale are truncated, which never matters for the 2-6 decimals fields allow.
 */
export function toScaledInteger(value: number | string): bigint | undefined {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(DECIMAL_SCALE) : undefined) : value.trim();
  const match = text === undefined ? null : DECIMAL_TEXT.exec(text);
  if (match === null) return undefined;
  const [, sign, whole, fraction = ''] = match;
  const scaled = BigInt(whole! + fraction.padEnd(DECIMAL_SCALE, '0').slice(0, DECIMAL_SCALE));
  return sign === '-' ? -scaled : scaled;
}

export const decimalPlaces = (value: number | string): number => {
  const text = typeof value === 'number' ? String(value) : value.trim();
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

/** `true` when `amount` is strictly greater than `limit`. */
export function exceeds(amount: number | string, limit: number | string): boolean {
  const left = toScaledInteger(amount);
  const right = toScaledInteger(limit);
  return left !== undefined && right !== undefined && left > right;
}
