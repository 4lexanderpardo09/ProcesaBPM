import { describe, expect, it } from 'vitest';
import { parseWhole, patchConfig } from './numbers';

describe('parseWhole', () => {
  it('reads whole numbers, negative too', () => {
    expect(parseWhole(' 12 ')).toBe(12);
    expect(parseWhole('-3')).toBe(-3);
  });
  it('gives null for empty, decimal or unsafe values', () => {
    expect(parseWhole('')).toBeNull();
    expect(parseWhole('1.5')).toBeNull();
    expect(parseWhole('2e3')).toBeNull();
    expect(parseWhole('99999999999999999999')).toBeNull();
  });
});

describe('patchConfig', () => {
  it('changes keys and takes out the ones set to undefined', () => {
    expect(patchConfig({ instructions: 'a', batch: { maxTickets: 5 } }, { instructions: 'b', batch: undefined })).toEqual({ instructions: 'b' });
  });
});
