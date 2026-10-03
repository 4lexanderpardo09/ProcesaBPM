import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../config/app-config.js';
import { API_CONFIG } from '../../config/tokens.js';
import { AesGcmKeyring } from '../crypto/aes-gcm-keyring.js';

const AAD_PREFIX = 'procesabpm:mfa-secret:v1:';

export interface OpenedMfaSecret {
  readonly secret: Buffer;
  /** The stored blob was made with an older key: store `seal(userId, secret)` in its place. */
  readonly needsReencryption: boolean;
}

/** Encrypts the TOTP secret at rest. The ciphertext is bound to its user, so it does not decrypt on another row. */
@Injectable()
export class MfaSecretCipher {
  private readonly keyring: AesGcmKeyring;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.keyring = new AesGcmKeyring(config.MFA_ENCRYPTION_KEYS);
  }

  seal(userId: string, secret: Buffer): Buffer {
    return this.keyring.encrypt(secret, `${AAD_PREFIX}${userId}`);
  }

  /** Throws `SecretDecryptionError` for a wrong key, a tampered blob or another user's blob. */
  open(userId: string, blob: Buffer): OpenedMfaSecret {
    const { plaintext, current } = this.keyring.decrypt(blob, `${AAD_PREFIX}${userId}`);
    return { secret: plaintext, needsReencryption: !current };
  }
}
