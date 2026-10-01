export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

export interface LoginCandidate {
  readonly id: string;
  readonly passwordHash: string | null;
  readonly status: UserStatus;
  readonly lockedUntil: Date | null;
  readonly mfaEnabled: boolean;
}

/** Only an active account outside its lockout period may log in, whatever password it sends. */
export function canAttemptLogin(candidate: LoginCandidate, now: Date): boolean {
  return candidate.status === 'ACTIVE' && (candidate.lockedUntil === null || candidate.lockedUntil <= now);
}
