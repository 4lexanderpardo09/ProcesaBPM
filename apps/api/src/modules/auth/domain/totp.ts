import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP = { periodSeconds: 30, digits: 6, skewSteps: 1, secretBytes: 20 } as const;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): Buffer {
  return randomBytes(TOTP.secretBytes);
}

/** RFC 4648 base32 without padding: the form authenticator apps expect in the `otpauth://` URI. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not a base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The time step (RFC 6238 `T`) a Unix time in milliseconds falls in. */
export function stepOf(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP.periodSeconds);
}

/** HOTP (RFC 4226) with HMAC-SHA-1 and dynamic truncation, as 6 digits. */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP.digits).padStart(TOTP.digits, '0');
}

/**
 * The step whose code matches, or `null`. Steps T-1, T and T+1 are all compared in constant time (no early exit), so the
 * time taken does not reveal which one matched. The caller must still refuse a step it has already accepted (replay).
 */
export function matchTotp(secret: Buffer, code: string, nowMs: number): number | null {
  if (!new RegExp(`^\\d{${TOTP.digits}}$`).test(code)) return null;
  const presented = Buffer.from(code, 'ascii');
  const current = stepOf(nowMs);
  let matched: number | null = null;
  for (let step = current - TOTP.skewSteps; step <= current + TOTP.skewSteps; step += 1) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step), 'ascii'), presented) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(input: { issuer: string; account: string; secret: Buffer }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const query = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP.digits),
    period: String(TOTP.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
