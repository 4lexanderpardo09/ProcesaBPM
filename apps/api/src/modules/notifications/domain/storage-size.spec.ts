import { describe, expect, it } from 'vitest';
import { formatStorageSize } from './storage-size.js';

describe('formatStorageSize', () => {
  it('uses binary units, with one decimal from MB up', () => {
    expect(formatStorageSize(0n)).toBe('0 B');
    expect(formatStorageSize(1536n)).toBe('2 KB');
    expect(formatStorageSize(1536n * 1024n)).toBe('1,5 MB');
    expect(formatStorageSize(5n * 1024n ** 3n)).toBe('5 GB');
    expect(formatStorageSize(2048n * 1024n ** 4n)).toBe('2.048 TB');
  });
});
