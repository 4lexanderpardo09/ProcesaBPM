import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEY_ID_LENGTH = 32;
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export interface KeyringKey {
  readonly id: string;
  /** 32 bytes (AES-256). */
  readonly key: Buffer;
}

export interface DecryptedSecret {
  readonly plaintext: Buffer;
  readonly keyId: string;
  /** `false` when an older key decrypted it: the caller should re-encrypt it with the current key. */
  readonly current: boolean;
}

/** The reason is never shown to a client: a wrong key, a tampered blob and a blob of another owner look the same. */
export class SecretDecryptionError extends Error {
  override readonly name = 'SecretDecryptionError';
}

/**
 * AES-256-GCM with a rotatable set of keys: the first key encrypts and every key decrypts. A blob is
 * `version · len(keyId) · keyId · iv · ciphertext · tag`, so it names the key that made it. The associated data binds
 * the ciphertext to its owner: a blob copied onto another row does not decrypt.
 */
export class AesGcmKeyring {
  private readonly byId = new Map<string, Buffer>();

  constructor(private readonly keys: readonly KeyringKey[]) {
    if (keys.length === 0) throw new Error('A keyring needs at least one key');
    for (const { id, key } of keys) {
      if (!KEY_ID_PATTERN.test(id)) throw new Error(`Invalid key id ${id}`);
      if (key.length !== KEY_BYTES) throw new Error(`Key ${id} must be ${KEY_BYTES} bytes`);
      if (this.byId.has(id)) throw new Error(`Duplicate key id ${id}`);
      this.byId.set(id, key);
    }
  }

  encrypt(plaintext: Buffer, associatedData: string): Buffer {
    const { id, key } = this.keys[0]!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const keyId = Buffer.from(id, 'ascii');
    return Buffer.concat([Buffer.from([FORMAT_VERSION, keyId.length]), keyId, iv, ciphertext, cipher.getAuthTag()]);
  }

  decrypt(blob: Buffer, associatedData: string): DecryptedSecret {
    try {
      if (blob.length < 2 || blob[0] !== FORMAT_VERSION) throw new SecretDecryptionError('Unknown format');
      const keyIdLength = blob[1]!;
      const ivStart = 2 + keyIdLength;
      if (keyIdLength < 1 || keyIdLength > MAX_KEY_ID_LENGTH || blob.length < ivStart + IV_BYTES + TAG_BYTES) throw new SecretDecryptionError('Malformed blob');
      const keyId = blob.subarray(2, ivStart).toString('ascii');
      const key = this.byId.get(keyId);
      if (key === undefined) throw new SecretDecryptionError('Unknown key');
      const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(ivStart, ivStart + IV_BYTES));
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES));
      const plaintext = Buffer.concat([decipher.update(blob.subarray(ivStart + IV_BYTES, blob.length - TAG_BYTES)), decipher.final()]);
      return { plaintext, keyId, current: keyId === this.keys[0]!.id };
    } catch (error) {
      throw error instanceof SecretDecryptionError ? error : new SecretDecryptionError('Authentication failed');
    }
  }
}
