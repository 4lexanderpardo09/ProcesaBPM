import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format-file-size';

const spaced = (text: string) => text.replace(/\s/g, ' ');

describe('formatFileSize', () => {
  it('uses bytes, kilobytes or megabytes by size', () => {
    expect(spaced(formatFileSize(850))).toBe('850 byte');
    expect(spaced(formatFileSize(12 * 1024 + 300))).toBe('12 kB');
    expect(spaced(formatFileSize(3.4 * 1024 * 1024))).toBe('3,4 MB');
  });
});
