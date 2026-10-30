/** The lease of a running request; renewed before every call, so a call (at most 9 minutes) always ends inside it. */
export const AI_JOB_LEASE_MINUTES = 10;

export type AiJobOutcome = 'succeeded' | 'failed' | 'interrupted';
