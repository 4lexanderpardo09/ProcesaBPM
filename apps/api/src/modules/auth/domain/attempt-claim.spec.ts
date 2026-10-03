import { describe, expect, it } from 'vitest';
import { toAttemptClaim } from './attempt-claim.js';

describe('toAttemptClaim', () => {
  it('a refused claim is neither claimed nor locking', () => {
    expect(toAttemptClaim(null, 5)).toEqual({ claimed: false, locking: false });
    expect(toAttemptClaim(undefined, 5)).toEqual({ claimed: false, locking: false });
  });

  it('only the claim that reaches the maximum (or one after an expired lock) locks', () => {
    expect(toAttemptClaim(1, 5)).toEqual({ claimed: true, locking: false });
    expect(toAttemptClaim(4, 5)).toEqual({ claimed: true, locking: false });
    expect(toAttemptClaim(5, 5)).toEqual({ claimed: true, locking: true });
    expect(toAttemptClaim(6, 5)).toEqual({ claimed: true, locking: true });
  });
});
