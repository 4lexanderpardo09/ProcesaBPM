import { createHash, randomBytes } from 'node:crypto';

export const BACKUP_CODE_COUNT = 10;
const CODE_LENGTH = 16;
/** Crockford base32: no I, L, O or U, so a code read from paper is hard to mistype. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte & 31];
  return code;
}

const display = (code: string) => code.match(/.{4}/g)!.join('-');

/** Ten codes of 80 bits each, in the form shown to the user once (`xxxx-xxxx-xxxx-xxxx`). */
export function newBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODE_COUNT) codes.add(randomCode());
  return [...codes].map(display);
}

/** Drops spaces and dashes, upper-cases and maps the look-alikes (I, L → 1; O → 0). `undefined` when it cannot be a code. */
export function normalizeBackupCode(input: string): string | undefined {
  const code = input.replace(/[\s-]/g, '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  return code.length === CODE_LENGTH && [...code].every((char) => ALPHABET.includes(char)) ? code : undefined;
}

/** SHA-256 is enough: each code has 80 bits, so a leaked hash cannot be searched offline. */
export function hashBackupCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

export function hashDisplayedCode(displayed: string): string | undefined {
  const normalized = normalizeBackupCode(displayed);
  return normalized === undefined ? undefined : hashBackupCode(normalized);
}
