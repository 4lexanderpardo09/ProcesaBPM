import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../../config/app-config.js';
import { SecretDecryptionError } from '../crypto/aes-gcm-keyring.js';
import { MfaSecretCipher } from './mfa-secret-cipher.js';

const keys = { old: { id: 'old', key: randomBytes(32) }, current: { id: 'new', key: randomBytes(32) } };
const cipher = (...list: Array<{ id: string; key: Buffer }>) => new MfaSecretCipher({ MFA_ENCRYPTION_KEYS: list } as unknown as ApiConfig);
const secret = randomBytes(20);

describe('MfaSecretCipher', () => {
  it('seals and opens a secret for its user', () => {
    const subject = cipher(keys.current);
    const opened = subject.open('user-1', subject.seal('user-1', secret));
    expect(opened.secret.equals(secret)).toBe(true);
    expect(opened.needsReencryption).toBe(false);
  });

  it('does not open a secret copied to another user', () => {
    const subject = cipher(keys.current);
    expect(() => subject.open('user-2', subject.seal('user-1', secret))).toThrow(SecretDecryptionError);
  });

  it('asks to re-encrypt what an older key sealed', () => {
    const sealedByOld = cipher(keys.old).seal('user-1', secret);
    const opened = cipher(keys.current, keys.old).open('user-1', sealedByOld);
    expect(opened.needsReencryption).toBe(true);
    expect(opened.secret.equals(secret)).toBe(true);
  });
});
