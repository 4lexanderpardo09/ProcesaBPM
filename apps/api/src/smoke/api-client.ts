export interface ApiResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** A thin JSON client of the deployed API; the smoke steps decide what status they expect. */
export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async call(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<ApiResponse> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>) };
  }

  /** Fails with the status and the error code the API sent, which is what the operator needs to read. */
  async expect(status: number, method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
    const response = await this.call(method, path, options);
    if (response.status !== status) {
      const error = (response.body.error ?? {}) as { code?: string; message?: string };
      throw new Error(`${method} ${path} answered ${response.status}${error.code ? ` ${error.code}` : ''}${error.message ? ` (${error.message})` : ''}, expected ${status}`);
    }
    return response.body;
  }
}

export const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The response has no ${what}`);
  return value;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
