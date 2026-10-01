import * as argon2 from '@node-rs/argon2';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PasswordHasher } from './password-hasher.js';

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const original = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...original, verify: vi.fn(original.verify) };
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();
  let stored: string;

  beforeAll(async () => {
    await hasher.onModuleInit();
    stored = await hasher.hash('correct horse battery staple');
  });

  it('produces Argon2id hashes with the OWASP parameters', () => {
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('correct horse battery staple')).not.toBe(stored);
  });

  it.each([
    ['the right password', 'correct horse battery staple', true],
    ['a wrong password', 'correct horse battery stapler', false],
    ['an empty password', '', false],
  ])('verifies %s', async (_label, password, expected) => {
    expect(await hasher.verify(stored, password)).toBe(expected);
  });

  it.each([
    ['no hash (unknown user)', undefined],
    ['a user without a password', null],
    ['a bcrypt hash (no legacy users exist)', '$2b$10$abcdefghijklmnopqrstuuJ8o2DLPbhw4E5U3n5Qe2oEJ7mHdSRe'],
    ['an Argon2i hash', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA'],
    ['a corrupt Argon2id hash', '$argon2id$v=19$garbage'],
  ])('rejects %s', async (_label, hash) => {
    expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(false);
  });

  it.each([
    ['a valid hash and the right password', () => stored, 'correct horse battery staple'],
    ['a valid hash and a wrong password', () => stored, 'wrong password!'],
    ['no hash (unknown user)', () => null, 'wrong password!'],
    ['a hash of another algorithm', () => '$2b$10$abcdefghijklmnopqrstuu', 'wrong password!'],
  ])('runs exactly one Argon2id verification with %s (no timing oracle)', async (_label, hash, password) => {
    const verify = vi.mocked(argon2.verify);
    verify.mockClear();
    await hasher.verify(hash(), password);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]![0]).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});
