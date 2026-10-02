import { describe, expect, it } from 'vitest';
import { generatedFileName } from './generated-file-name.js';

describe('generatedFileName', () => {
  it('adds the extension and keeps accents', () => {
    expect(generatedFileName('Acta de recepción 1045', 'ticket-1')).toBe('Acta de recepción 1045.pdf');
  });

  it('replaces path separators and characters a file system refuses', () => {
    expect(generatedFileName('a/b\\c:d*e?"<>|f', 'x')).toBe('a-b-c-d-e----f.pdf');
  });

  it('never starts with dots and falls back when nothing is left', () => {
    expect(generatedFileName('..hidden', 'x')).toBe('hidden.pdf');
    expect(generatedFileName('   ', 'ticket-9')).toBe('ticket-9.pdf');
  });

  it('is cut to a reasonable length', () => {
    expect(generatedFileName('a'.repeat(500), 'x').length).toBeLessThanOrEqual(124);
  });
});
