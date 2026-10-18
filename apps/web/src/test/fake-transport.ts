import type { z } from 'zod';
import type { HttpClient, RequestOptions } from '@/shared/api';

type AnyOptions = RequestOptions & { readonly schema?: z.ZodType };
/** Gets the request options and the full path, query included. */
export type FakeHandler = (options: AnyOptions, path: string) => unknown;

export interface RecordedCall {
  readonly path: string;
  readonly options: AnyOptions;
}

const pathnameOf = (path: string) => path.split('?')[0] ?? path;

/** An HttpClient answered by one handler per path (a handler for the bare path also takes its queries); a handler may throw an ApiError. Bodies go through the schema. */
export function createFakeTransport(handlers: Record<string, FakeHandler>) {
  const calls: RecordedCall[] = [];
  const transport = {
    async request(path: string, options: AnyOptions = {}) {
      calls.push({ path, options });
      const handler = handlers[path] ?? handlers[pathnameOf(path)];
      if (handler === undefined) throw new Error(`No fake handler for ${path}`);
      const body = await handler(options, path);
      return options.schema === undefined ? undefined : options.schema.parse(body);
    },
  } as HttpClient;
  const callsTo = (path: string) => calls.filter((call) => call.path === path || pathnameOf(call.path) === path);
  return { transport, calls, callsTo };
}
