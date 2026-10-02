import { describe, expect, it } from 'vitest';
import { Decimal, DecimalError } from './fixed-decimal.js';

const d = (value: string | number) => Decimal.parse(value);
const reason = (work: () => unknown): string | undefined => {
  try {
    work();
  } catch (error) {
    return error instanceof DecimalError ? error.reason : 'OTHER';
  }
  return undefined;
};

describe('Decimal', () => {
  it('adds and subtracts exactly where floats do not', () => {
    expect(d('0.1').add(d('0.2')).toPlainString()).toBe('0.3');
    expect(d('0.3').sub(d('0.1')).toPlainString()).toBe('0.2');
    expect(d(1500000.5).add(d(-0.5)).toPlainString()).toBe('1500000');
  });

  it('multiplies exactly and rounds half away from zero past 12 digits', () => {
    expect(d('1234.56').mul(d('0.07')).toPlainString()).toBe('86.4192');
    expect(d('-1.5').mul(d('2')).toPlainString()).toBe('-3');
    expect(d('0.000000000001').mul(d('0.5')).toPlainString()).toBe('0.000000000001');
    expect(d('-0.000000000001').mul(d('0.5')).toPlainString()).toBe('-0.000000000001');
  });

  it('divides to 12 decimals, rounding half up, and refuses zero', () => {
    expect(d('1').div(d('3')).toPlainString()).toBe('0.333333333333');
    expect(d('2').div(d('3')).toPlainString()).toBe('0.666666666667');
    expect(d('-2').div(d('3')).toPlainString()).toBe('-0.666666666667');
    expect(reason(() => d('1').div(Decimal.ZERO))).toBe('DIVISION_BY_ZERO');
  });

  it('rounds to a number of places: half up (away from zero) or down (toward zero)', () => {
    expect(d('2.345').round(2).toPlainString()).toBe('2.35');
    expect(d('-2.345').round(2).toPlainString()).toBe('-2.35');
    expect(d('2.344').round(2).toPlainString()).toBe('2.34');
    expect(d('2.999').round(0).toPlainString()).toBe('3');
    expect(d('2.999').round(2, 'DOWN').toPlainString()).toBe('2.99');
    expect(d('-2.999').round(0, 'DOWN').toPlainString()).toBe('-2');
  });

  it('compares', () => {
    expect([d('1').compare(d('2')), d('2').compare(d('2')), d('3').compare(d('2'))]).toEqual([-1, 0, 1]);
    expect(d('1.0').equals(d('1'))).toBe(true);
  });

  it('refuses text that is not a plain decimal', () => {
    for (const text of ['', 'abc', '1e5', '1,000', '1.2.3', ' ', '+1', '--1']) expect(reason(() => d(text)), text).toBe('INVALID_NUMBER');
    expect(reason(() => d(Number.NaN))).toBe('INVALID_NUMBER');
    expect(d(' 12.50 ').toPlainString()).toBe('12.5');
  });

  it('refuses a magnitude of 10^15 or more, however it got there', () => {
    expect(reason(() => d('1000000000000000'))).toBe('NUMBER_OVERFLOW');
    expect(d('999999999999999.999999999999').toPlainString()).toBe('999999999999999.999999999999');
    expect(reason(() => d('999999999999999').add(d('1')))).toBe('NUMBER_OVERFLOW');
    expect(reason(() => d('100000000').mul(d('100000000')))).toBe('NUMBER_OVERFLOW');
  });

  it('prints without trailing zeros or exponent and counts significant digits', () => {
    expect(d('0.000001').toPlainString()).toBe('0.000001');
    expect(d('100').toPlainString()).toBe('100');
    expect(d('-0.5').toPlainString()).toBe('-0.5');
    expect(d('123456.789').significantDigits()).toBe(9);
    expect(d('0.05').significantDigits()).toBe(1);
  });

  it('agrees with an exact reference on random operands (seeded, no dependency)', () => {
    let seed = 12345;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const random = () => `${next() < 0.5 ? '-' : ''}${Math.floor(next() * 1e9)}.${String(Math.floor(next() * 1e6)).padStart(6, '0')}`;
    for (let round = 0; round < 500; round += 1) {
      const [a, b] = [random(), random()];
      const scale = (text: string) => BigInt(text.replace('.', ''));
      expect(d(a).add(d(b)).sub(d(b)).equals(d(a))).toBe(true);
      expect(d(a).add(d(b)).toPlainString()).toBe(Decimal.parse((Number(scale(a) + scale(b)) / 1e6).toFixed(6)).toPlainString());
      const base = d(`${a.startsWith('-') ? '-' : ''}${Math.floor(next() * 1e5)}.${a.split('.')[1]}`);
      const factor = d(`${Math.floor(next() * 1e5) + 1}.5`);
      expect(base.mul(factor).div(factor).sub(base).abs().compare(d('0.000001'))).toBeLessThanOrEqual(0);
    }
  });
});
