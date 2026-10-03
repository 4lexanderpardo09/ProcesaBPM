import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, matchTotp, newTotpSecret, otpauthUri, stepOf, totpCode } from './totp.js';

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890": the published codes have 8 digits; ours are the last 6.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it.each(RFC_VECTORS)('matches the RFC 6238 vector at T=%i', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, stepOf(seconds * 1000))).toBe(expected);
    expect(matchTotp(RFC_SECRET, expected, seconds * 1000)).toBe(stepOf(seconds * 1000));
  });

  describe('matchTotp', () => {
    const now = 1_700_000_000_000;
    const at = (offset: number) => totpCode(RFC_SECRET, stepOf(now) + offset);

    it('accepts the previous, current and next step and says which one matched', () => {
      for (const offset of [-1, 0, 1]) expect(matchTotp(RFC_SECRET, at(offset), now)).toBe(stepOf(now) + offset);
    });

    it('refuses two steps away', () => {
      expect(matchTotp(RFC_SECRET, at(-2), now)).toBeNull();
      expect(matchTotp(RFC_SECRET, at(2), now)).toBeNull();
    });

    it.each(['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６'])('refuses the malformed code %j', (code) => {
      expect(matchTotp(RFC_SECRET, code, now)).toBeNull();
    });

    it('refuses a code of another secret', () => {
      expect(matchTotp(Buffer.from('another secret value'), at(0), now)).toBeNull();
    });
  });

  describe('base32', () => {
    it.each([
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ])('encodes the RFC 4648 vector %j', (plain, encoded) => {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    });

    it('round-trips random secrets and tolerates lower case and padding', () => {
      const secret = newTotpSecret();
      expect(secret).toHaveLength(20);
      expect(base32Decode(base32Encode(secret).toLowerCase()).equals(secret)).toBe(true);
      expect(base32Decode('MZXW6YQ=').toString()).toBe('foob');
    });

    it('refuses characters outside the alphabet', () => {
      expect(() => base32Decode('MZXW1')).toThrow();
    });
  });

  it('builds the otpauth URI the authenticator apps read, escaping the account', () => {
    const uri = otpauthUri({ issuer: 'ProcesaBPM', account: 'jane+test@example.com', secret: RFC_SECRET });
    expect(uri).toBe(
      'otpauth://totp/ProcesaBPM:jane%2Btest%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ProcesaBPM&algorithm=SHA1&digits=6&period=30',
    );
  });
});
