/** What a log line says about an error: enough to act on it (what failed, its code, what caused it). */
export interface ErrorDescription {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: ErrorDescription;
  /** The first errors of an AggregateError. */
  readonly errors?: readonly ErrorDescription[];
}

const MAX_DEPTH = 4;
const MAX_TEXT = 500;
const MAX_AGGREGATED = 3;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Short, and without the e-mail addresses a provider's message may echo (`550 <ana@acme.co> rejected`). */
const clip = (text: string): string => {
  const safe = text.replace(EMAIL, '<email>');
  return safe.length <= MAX_TEXT ? safe : `${safe.slice(0, MAX_TEXT - 1)}…`;
};

/**
 * Describes anything that was thrown: an Error (with its `code`, as Node, pg and Prisma set it, and its `cause` chain),
 * or a value that is not one (a plain object some libraries throw, a string). Never `[object Object]`.
 */
export function describeError(error: unknown, depth = 0): ErrorDescription {
  if (!(error instanceof Error)) return { name: typeof error === 'object' && error !== null ? 'NonError' : typeof error, message: clip(textOf(error)), ...codeOf(error) };
  const description: ErrorDescription = { name: error.name, message: clip(error.message || textOf(error)), ...codeOf(error) };
  const cause = depth < MAX_DEPTH && error.cause !== undefined ? { cause: describeError(error.cause, depth + 1) } : {};
  const errors = error instanceof AggregateError && depth < MAX_DEPTH ? { errors: error.errors.slice(0, MAX_AGGREGATED).map((inner: unknown) => describeError(inner, depth + 1)) } : {};
  return { ...description, ...cause, ...errors };
}

function codeOf(error: unknown): { code?: string | number } {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? { code } : {};
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return String(value);
  const message = (value as { message?: unknown }).message;
  if (typeof message === 'string' && message !== '') return message;
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
