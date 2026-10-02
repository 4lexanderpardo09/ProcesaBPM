import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import request from 'supertest';
import { expect } from 'vitest';
import type { ApiConfig } from '../../src/config/app-config.js';
import { MfaSecretCipher } from '../../src/infrastructure/security/mfa-secret-cipher.js';
import { hashDisplayedCode, newBackupCodes } from '../../src/modules/auth/domain/backup-codes.js';
import { stepOf, totpCode } from '../../src/modules/auth/domain/totp.js';
import { TEST_MFA_KEY } from './test-environment.js';

const cipher = new MfaSecretCipher({ MFA_ENCRYPTION_KEYS: [TEST_MFA_KEY] } as unknown as ApiConfig);

export interface MfaCredentials {
  readonly secret: Buffer;
  readonly backupCodes: string[];
}

/** Turns MFA on for a user directly in the database (the enrollment flow has its own tests). */
export async function enableMfa(db: TestDatabase, userId: string): Promise<MfaCredentials> {
  const secret = randomBytes(20);
  const backupCodes = newBackupCodes();
  await db.owner.query(
    `UPDATE users SET mfa_enabled = true, mfa_enabled_at = now(), mfa_secret_encrypted = $2, mfa_last_step = 0, mfa_failed_attempts = 0, mfa_locked_until = NULL WHERE id = $1`,
    [userId, cipher.seal(userId, secret)],
  );
  for (const code of backupCodes) {
    await db.owner.query('INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hashDisplayedCode(code)]);
  }
  return { secret, backupCodes };
}

/** The code the authenticator app shows `stepOffset` steps from now (the replay guard is rewound by `rewindReplayGuard`). */
export const currentCode = (secret: Buffer, stepOffset = 0, nowMs = Date.now()) => totpCode(secret, stepOf(nowMs) + stepOffset);

/** Tests sign the same user in repeatedly within one 30-second step: forget the last accepted step so the same code works again. */
export const rewindReplayGuard = (db: TestDatabase, userId: string) => db.owner.query('UPDATE users SET mfa_last_step = 0 WHERE id = $1', [userId]);

/** Login of a user that has MFA, followed by the code: returns the selection token. */
export async function logInWithMfa(app: INestApplication, db: TestDatabase, user: { userId: string; email: string; password: string }, mfa: MfaCredentials): Promise<string> {
  await rewindReplayGuard(db, user.userId);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
  expect(login.body.step).toBe('MFA_REQUIRED');
  const verified = await request(app.getHttpServer())
    .post('/auth/login/mfa')
    .set('authorization', `Bearer ${login.body.challengeToken}`)
    .send({ code: currentCode(mfa.secret) })
    .expect(200);
  expect(verified.body.step).toBe('SELECT_ORGANIZATION');
  return verified.body.selectionToken as string;
}
