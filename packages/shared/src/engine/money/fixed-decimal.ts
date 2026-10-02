/** Digits kept after the point: far more than any field allows (6), so a product of two values is exact. */
export const FIXED_SCALE = 12;
const ONE = 10n ** BigInt(FIXED_SCALE);
/** Magnitudes of 10^15 or more are refused after every operation: a formula cannot grow a number without bound. */
const LIMIT = 10n ** BigInt(15 + FIXED_SCALE);
const PLAIN = /^(-?)(\d+)(?:\.(\d+))?$/;

export type RoundingMode = 'HALF_UP' | 'DOWN';

export class DecimalError extends Error {
  override readonly name = 'DecimalError';
  constructor(readonly reason: 'NUMBER_OVERFLOW' | 'DIVISION_BY_ZERO' | 'INVALID_NUMBER') {
    super(reason);
  }
}

/** Divides rounding half away from zero (HALF_UP) or toward zero (DOWN). */
function divide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let quotient = n / d;
  if (mode === 'HALF_UP' && (n % d) * 2n >= d) quotient += 1n;
  return negative ? -quotient : quotient;
}

/**
 * An exact decimal: an integer scaled by 10^12. Never a float, so `0.1 + 0.2` is `0.3`. Immutable. Every operation
 * checks the magnitude (`NUMBER_OVERFLOW`); dividing by zero is `DIVISION_BY_ZERO`.
 */
export class Decimal {
  private constructor(private readonly scaled: bigint) {
    if (scaled >= LIMIT || scaled <= -LIMIT) throw new DecimalError('NUMBER_OVERFLOW');
  }

  static readonly ZERO = new Decimal(0n);

  /** A plain decimal text (`-1500.25`) or a JSON number. Exponents, thousands separators and anything else are `INVALID_NUMBER`. Extra digits past 12 are rounded. */
  static parse(value: string | number): Decimal {
    const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
    const match = PLAIN.exec(text);
    if (match === null) throw new DecimalError('INVALID_NUMBER');
    const [, sign, whole, fraction = ''] = match;
    const digits = BigInt(whole! + fraction.padEnd(FIXED_SCALE, '0').slice(0, FIXED_SCALE));
    const extra = fraction.length > FIXED_SCALE && fraction.charCodeAt(FIXED_SCALE) >= 53 ? 1n : 0n;
    return new Decimal(sign === '-' ? -(digits + extra) : digits + extra);
  }

  static fromInteger(value: number): Decimal {
    if (!Number.isSafeInteger(value)) throw new DecimalError('NUMBER_OVERFLOW');
    return new Decimal(BigInt(value) * ONE);
  }

  add(other: Decimal): Decimal {
    return new Decimal(this.scaled + other.scaled);
  }

  sub(other: Decimal): Decimal {
    return new Decimal(this.scaled - other.scaled);
  }

  mul(other: Decimal): Decimal {
    return new Decimal(divide(this.scaled * other.scaled, ONE, 'HALF_UP'));
  }

  div(other: Decimal): Decimal {
    if (other.scaled === 0n) throw new DecimalError('DIVISION_BY_ZERO');
    return new Decimal(divide(this.scaled * ONE, other.scaled, 'HALF_UP'));
  }

  /** Remainder with the sign of the dividend, exact (no rounding of the quotient). */
  rem(other: Decimal): Decimal {
    if (other.scaled === 0n) throw new DecimalError('DIVISION_BY_ZERO');
    return new Decimal(this.scaled % other.scaled);
  }

  negate(): Decimal {
    return new Decimal(-this.scaled);
  }

  abs(): Decimal {
    return this.scaled < 0n ? this.negate() : this;
  }

  /** To `places` decimals (0–12): half away from zero by default, or toward zero. */
  round(places: number, mode: RoundingMode = 'HALF_UP'): Decimal {
    const unit = 10n ** BigInt(FIXED_SCALE - places);
    return new Decimal(divide(this.scaled, unit, mode) * unit);
  }

  compare(other: Decimal): -1 | 0 | 1 {
    return this.scaled < other.scaled ? -1 : this.scaled > other.scaled ? 1 : 0;
  }

  equals(other: Decimal): boolean {
    return this.scaled === other.scaled;
  }

  isZero(): boolean {
    return this.scaled === 0n;
  }

  /** `-1500.25`, without trailing zeros and without an exponent. */
  toPlainString(): string {
    const negative = this.scaled < 0n;
    const digits = (negative ? -this.scaled : this.scaled).toString().padStart(FIXED_SCALE + 1, '0');
    const whole = digits.slice(0, -FIXED_SCALE);
    const fraction = digits.slice(-FIXED_SCALE).replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
  }

  /** Digits in the integer and fractional part, to know whether a JSON number can hold it exactly (15 significant digits). */
  significantDigits(): number {
    return this.toPlainString().replace(/^-/, '').replace('.', '').replace(/^0+(?=\d)/, '').length;
  }

  toJSON(): string {
    return this.toPlainString();
  }
}
