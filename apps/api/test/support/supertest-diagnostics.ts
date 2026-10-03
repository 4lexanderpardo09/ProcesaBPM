import { createRequire } from 'node:module';

/**
 * A failed `.expect(200)` says only "expected 200, got 422". When the API fails under load in a suite of hundreds of
 * requests, the status alone cannot tell which rule refused the request, so the message of every failed status assertion
 * also carries the response body (the error code and its details) and the request that produced it.
 */
const BODY_LIMIT = 2_000;

interface Assertion {
  _assertStatus(status: number, res: unknown): Error | undefined;
  _assertStatusArray(statuses: number[], res: unknown): Error | undefined;
}
interface Response {
  readonly status: number;
  readonly body?: unknown;
  /** A string in supertest; a method in `fetch` (whose body cannot be read twice, so it is left out). */
  readonly text?: unknown;
  readonly req?: { readonly method?: string; readonly path?: string };
}

export const describeResponse = (res: Response): string => {
  const body = res.body !== undefined && Object.keys(res.body as object).length > 0 ? JSON.stringify(res.body) : (typeof res.text === 'string' ? res.text : '');
  const request = res.req?.method === undefined ? '' : `${res.req.method} ${res.req.path ?? ''} -> `;
  return `\n  ${request}${res.status} ${body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}…` : body}`;
};

function withBody<Args extends unknown[]>(original: (...args: Args) => Error | undefined): (this: unknown, ...args: Args) => Error | undefined {
  return function (this: unknown, ...args: Args) {
    const error = original.apply(this, args);
    if (error !== undefined) error.message += describeResponse(args[args.length - 1] as Response);
    return error;
  };
}

let installed = false;

export function installSupertestDiagnostics(): void {
  if (installed) return;
  installed = true;
  const Test = createRequire(import.meta.url)('supertest/lib/test.js') as { prototype: Assertion };
  Test.prototype._assertStatus = withBody(Test.prototype._assertStatus);
  Test.prototype._assertStatusArray = withBody(Test.prototype._assertStatusArray);
}

/** `expect(res.status).toBe(n)` that, when it fails, says what the API answered. */
export function expectStatus(res: Response, status: number): void {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}${describeResponse(res)}`);
}
