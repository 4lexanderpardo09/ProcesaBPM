import { randomBytes } from 'node:crypto';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable, type OnModuleInit } from '@nestjs/common';

/** Argon2id with the OWASP minimum configuration (19 MiB, 2 iterations, 1 lane). */
const ARGON2ID: Algorithm = 2;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const ARGON2ID_PREFIX = '$argon2id$';

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private decoyHash: string | undefined;

  async onModuleInit(): Promise<void> {
    this.decoyHash = await this.hash(randomBytes(16).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  /**
   * Always performs one Argon2id verification, even without a usable hash (unknown user, no
   * password, hash of another algorithm), so the time taken does not tell those cases apart.
   * There are no legacy users: a hash that is not Argon2id is simply never valid.
   */
  async verify(storedHash: string | null | undefined, password: string): Promise<boolean> {
    if (typeof storedHash === 'string' && storedHash.startsWith(ARGON2ID_PREFIX)) {
      try {
        return await verify(storedHash, password);
      } catch {
        return false;
      }
    }
    await verify(this.decoy(), password);
    return false;
  }

  private decoy(): string {
    if (this.decoyHash === undefined) throw new Error('PasswordHasher was not initialized');
    return this.decoyHash;
  }
}
