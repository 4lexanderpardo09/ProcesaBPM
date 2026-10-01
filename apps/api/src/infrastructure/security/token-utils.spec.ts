import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, sha256Hex } from './token-utils.js';

describe('token utilities', () => {
  it('generates 256-bit URL-safe tokens that never repeat', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateOpaqueToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('hashes with SHA-256 as lowercase hexadecimal (the format the database checks)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
