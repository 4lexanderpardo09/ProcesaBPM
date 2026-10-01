import { describe, expect, it } from 'vitest';
import { decimalPlaces, exceeds, toScaledInteger } from './decimal.js';

describe('toScaledInteger', () => {
  it.each([
    [1, 1_000_000n],
    ['1500000.50', 1_500_000_500_000n],
    [0.1 + 0.2, 300_000n],
    ['-2.5', -2_500_000n],
  ])('reads %s exactly', (input, expected) => expect(toScaledInteger(input)).toBe(expected));

  it.each(['1.500.000', '1e3', 'abc', '', Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (input) => expect(toScaledInteger(input)).toBeUndefined());
});

describe('exceeds', () => {
  it('is strict: the cap itself is allowed', () => {
    expect(exceeds('1000.00', '1000.00')).toBe(false);
    expect(exceeds('1000.01', '1000.00')).toBe(true);
  });
  it('does not lose cents to float arithmetic', () => expect(exceeds(0.1 + 0.2, '0.30')).toBe(false));
});

describe('decimalPlaces', () => {
  it('counts the digits after the point', () => {
    expect(decimalPlaces(12)).toBe(0);
    expect(decimalPlaces('12.345')).toBe(3);
  });
});
