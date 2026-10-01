import { createHash, randomBytes } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32;

/** Random URL-safe token (256 bits) for refresh sessions and e-mailed links. */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/** What the database stores instead of the token: a leaked table cannot be replayed. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
