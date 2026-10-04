import { describe, expect, it } from 'vitest';
import { exportedFilePath, MAX_EXPORTED_FILE_NAME, sanitizeExportedFileName } from './export-file-name.js';

describe('sanitizeExportedFileName', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeExportedFileName('Informe año 2026.pdf')).toBe('Informe año 2026.pdf');
  });

  it('cannot leave its folder: separators and parent segments are neutralized', () => {
    for (const name of ['../../etc/passwd', '..\\..\\windows\\system.ini', '/absolute/path.txt', 'C:\\x.txt', '....//x']) {
      const safe = sanitizeExportedFileName(name);
      expect(safe, name).not.toMatch(/[/\\]/);
      expect(safe.split('.').includes(''), name).toBe(false);
      expect(safe.startsWith('.'), name).toBe(false);
    }
    expect(sanitizeExportedFileName('../../etc/passwd')).toBe('_._etc_passwd');
  });

  it('removes control and reserved characters, leading and trailing dots and spaces', () => {
    expect(sanitizeExportedFileName(' .a\u0000b<c>:d"e|f?g*h. ')).toBe('a_b_c__d_e_f_g_h');
    expect(sanitizeExportedFileName('...')).toBe('file');
    expect(sanitizeExportedFileName('')).toBe('file');
  });

  it('prefixes names Windows reserves', () => {
    expect(sanitizeExportedFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeExportedFileName('nul')).toBe('_nul');
  });

  it('caps the length, keeping the extension and whole characters', () => {
    const long = `${'é'.repeat(200)}😀.pdf`;
    const safe = sanitizeExportedFileName(long);
    expect(Array.from(safe)).toHaveLength(MAX_EXPORTED_FILE_NAME);
    expect(safe.endsWith('.pdf')).toBe(true);
    expect(sanitizeExportedFileName(`${'a'.repeat(118)}😀😀😀`)).toBe(`${'a'.repeat(118)}😀😀`);
  });

  it('places every file in its own folder named by its id', () => {
    expect(exportedFilePath('0199', '../x.pdf')).toBe('files/0199/_x.pdf');
  });
});
