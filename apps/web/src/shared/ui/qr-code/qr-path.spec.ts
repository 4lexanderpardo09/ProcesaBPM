import { describe, expect, it } from 'vitest';
import { qrMatrixOf } from './qr-path';

describe('qrMatrixOf', () => {
  it('draws one square per dark module, with the quiet border', () => {
    const { size, path } = qrMatrixOf('otpauth://totp/ProcesaBPM:ana@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ProcesaBPM');
    expect(size).toBeGreaterThanOrEqual(25);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(path).not.toContain('M0 0');
  });

  it('is deterministic', () => {
    expect(qrMatrixOf('abc')).toEqual(qrMatrixOf('abc'));
  });
});
