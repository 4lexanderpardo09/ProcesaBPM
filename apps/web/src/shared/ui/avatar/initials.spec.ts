import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it.each([
    ['Marta Gómez', 'MG'],
    ['Alexander Pardo Ruiz', 'AR'],
    ['ana', 'A'],
    ['  Diego   Salazar  ', 'DS'],
    ['Ángela Ñuñez', 'ÁÑ'],
    ['', ''],
    ['   ', ''],
  ])('%s → %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
