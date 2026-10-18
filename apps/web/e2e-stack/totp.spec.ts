import { expect, test } from '@playwright/test';
import { totpCode } from './support/totp';

test('the TOTP helper matches the RFC 6238 test vector', () => {
  // Secret "12345678901234567890" in base32; RFC 6238 gives 94287082 at T = 59 s (8 digits).
  expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
});
