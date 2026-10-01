import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound so that hashing a huge input cannot be used to exhaust the server. */
export const PASSWORD_MAX_LENGTH = 128;

/** Policy for a password that is being chosen (not for the one typed at login). */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `The password needs at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `The password can have at most ${PASSWORD_MAX_LENGTH} characters`);
