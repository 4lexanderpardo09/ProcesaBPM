import type { z } from 'zod';
import type { HttpClient, RequestOptions } from '@/shared/api';

type AnyOptions = RequestOptions & { readonly schema?: z.ZodType };
export type FakeHandler = (options: AnyOptions) => unknown;

export interface RecordedCall {
  readonly path: string;
  readonly options: AnyOptions;
}

/** An HttpClient answered by one handler per path; a handler may throw an ApiError. Bodies go through the schema. */
export function createFakeTransport(handlers: Record<string, FakeHandler>) {
  const calls: RecordedCall[] = [];
  const transport = {
    async request(path: string, options: AnyOptions = {}) {
      calls.push({ path, options });
      const handler = handlers[path];
      if (handler === undefined) throw new Error(`No fake handler for ${path}`);
      const body = await handler(options);
      return options.schema === undefined ? undefined : options.schema.parse(body);
    },
  } as HttpClient;
  const callsTo = (path: string) => calls.filter((call) => call.path === path);
  return { transport, calls, callsTo };
}
