import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmKeyring, SecretDecryptionError } from './aes-gcm-keyring.js';

const key = (id: string) => ({ id, key: randomBytes(32) });
const secret = Buffer.from('twenty bytes secret!');
const aad = 'procesabpm:test:user-1';

describe('AesGcmKeyring', () => {
  it('round-trips and reports the key that made the blob', () => {
    const ring = new AesGcmKeyring([key('k1')]);
    const decrypted = ring.decrypt(ring.encrypt(secret, aad), aad);
    expect(decrypted.plaintext.equals(secret)).toBe(true);
    expect(decrypted).toMatchObject({ keyId: 'k1', current: true });
  });

  it('never repeats an IV: two encryptions of the same value differ', () => {
    const ring = new AesGcmKeyring([key('k1')]);
    const blobs = new Set(Array.from({ length: 1000 }, () => ring.encrypt(secret, aad).toString('hex')));
    expect(blobs.size).toBe(1000);
  });

  it('does not decrypt for another owner (associated data)', () => {
    const ring = new AesGcmKeyring([key('k1')]);
    expect(() => ring.decrypt(ring.encrypt(secret, aad), 'procesabpm:test:user-2')).toThrow(SecretDecryptionError);
  });

  it('fails when any byte of the blob is changed', () => {
    const ring = new AesGcmKeyring([key('k1')]);
    const blob = ring.encrypt(secret, aad);
    for (let index = 0; index < blob.length; index += 1) {
      const tampered = Buffer.from(blob);
      tampered[index] = tampered[index]! ^ 0x01;
      expect(() => ring.decrypt(tampered, aad), `byte ${index}`).toThrow(SecretDecryptionError);
    }
  });

  it('refuses truncated blobs and blobs of an unknown format', () => {
    const ring = new AesGcmKeyring([key('k1')]);
    const blob = ring.encrypt(secret, aad);
    expect(() => ring.decrypt(blob.subarray(0, 10), aad)).toThrow(SecretDecryptionError);
    expect(() => ring.decrypt(Buffer.alloc(0), aad)).toThrow(SecretDecryptionError);
    expect(() => ring.decrypt(Buffer.concat([Buffer.from([9]), blob.subarray(1)]), aad)).toThrow(SecretDecryptionError);
  });

  it('decrypts with an older key and says it is not the current one; encrypts with the first', () => {
    const [previous, current] = [key('old'), key('new')];
    const before = new AesGcmKeyring([previous]).encrypt(secret, aad);
    const rotated = new AesGcmKeyring([current, previous]);
    expect(rotated.decrypt(before, aad)).toMatchObject({ keyId: 'old', current: false });
    expect(rotated.decrypt(rotated.encrypt(secret, aad), aad)).toMatchObject({ keyId: 'new', current: true });
  });

  it('refuses a blob whose key was removed', () => {
    const before = new AesGcmKeyring([key('old')]).encrypt(secret, aad);
    expect(() => new AesGcmKeyring([key('new')]).decrypt(before, aad)).toThrow(SecretDecryptionError);
  });

  it('refuses bad keyrings', () => {
    expect(() => new AesGcmKeyring([])).toThrow();
    expect(() => new AesGcmKeyring([{ id: 'short', key: randomBytes(31) }])).toThrow();
    expect(() => new AesGcmKeyring([{ id: 'bad id!', key: randomBytes(32) }])).toThrow();
    expect(() => new AesGcmKeyring([key('same'), key('same')])).toThrow('Duplicate');
  });
});
