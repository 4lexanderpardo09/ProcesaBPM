/** What a sign-in or a reset needs of an account. The lockout is decided by the database when the attempt is claimed. */
export interface LoginCandidate {
  readonly id: string;
  readonly passwordHash: string | null;
  readonly status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
  readonly mfaEnabled: boolean;
}
