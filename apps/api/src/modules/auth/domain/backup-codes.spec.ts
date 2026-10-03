import { describe, expect, it } from 'vitest';
import { hashBackupCode, hashDisplayedCode, newBackupCodes, normalizeBackupCode } from './backup-codes.js';

describe('backup codes', () => {
  it('creates ten distinct codes of 16 characters shown in groups of four', () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('reads a code back however it was typed', () => {
    const [code] = newBackupCodes();
    const normalized = normalizeBackupCode(code!)!;
    expect(normalizeBackupCode(code!.toLowerCase())).toBe(normalized);
    expect(normalizeBackupCode(code!.replaceAll('-', ' '))).toBe(normalized);
    expect(normalizeBackupCode(`  ${code!.replaceAll('-', '')}  `)).toBe(normalized);
  });

  it('maps the look-alike letters to the digits they stand for', () => {
    expect(normalizeBackupCode('0123-4567-89AB-CDEF')).toBe(normalizeBackupCode('O123-4567-89AB-CDEF'));
    expect(normalizeBackupCode('1111-1111-1111-1111')).toBe(normalizeBackupCode('IlIl-1111-1111-1111'));
  });

  it.each(['', 'short', '0123-4567-89AB-CDE', '0123-4567-89AB-CDEFG', '0123-4567-89AB-CDE!', '0123-4567-89AB-CDEU'])('refuses %j', (input) => {
    expect(normalizeBackupCode(input)).toBeUndefined();
    expect(hashDisplayedCode(input)).toBeUndefined();
  });

  it('hashes to 64 hex characters, the same for every spelling', () => {
    const [code] = newBackupCodes();
    expect(hashBackupCode(normalizeBackupCode(code!)!)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDisplayedCode(code!.toLowerCase())).toBe(hashDisplayedCode(code!));
  });
});
