/** The outcome of counting one password or second-factor attempt before it is checked. */
export interface AttemptClaim {
  /** `false`: locked, not active or unknown; the attempt must not be checked. */
  readonly claimed: boolean;
  /** This claim locked the account (or the second factor): if the attempt turns out wrong, the user is told. */
  readonly locking: boolean;
}

/** `claimNumber` is what the `*_counted` claim functions return: the attempts in a row, or `null` when refused. */
export function toAttemptClaim(claimNumber: number | null | undefined, maxFailedAttempts: number): AttemptClaim {
  if (claimNumber === null || claimNumber === undefined) return { claimed: false, locking: false };
  return { claimed: true, locking: claimNumber >= maxFailedAttempts };
}
