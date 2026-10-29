import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';
import { TenantContext } from '../../infrastructure/database/tenant-context.js';
import { describeError } from './describe-error.js';
import { RequestContext } from './request-context.js';

export type LogLevel = AppConfig['LOG_LEVEL'];
export type LogWriter = (line: string) => void;

export const LOG_WRITER = Symbol('LOG_WRITER');

const SEVERITY: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One JSON object per line, enriched with the tenant and request of the current async context. */
@Injectable()
export class JsonLogger implements LoggerService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
    @Inject(LOG_WRITER) private readonly write: LogWriter,
  ) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.emit('info', message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.emit('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.emit('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.emit('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.emit('debug', message, optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.emit('error', message, optional);
  }

  /** Structured fields: `logger.info('ticket created', { ticketId })`. */
  info(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.emit('info', message, [fields]);
  }

  private emit(level: LogLevel, message: unknown, optional: readonly unknown[]): void {
    if (SEVERITY[level] < SEVERITY[this.config.LOG_LEVEL]) return;
    const { fields, context, stack } = this.readOptional(optional);
    const head = this.readMessage(message);
    this.write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        message: head.message,
        context,
        tenant_id: this.tenantContext.current()?.tenantId,
        request_id: this.requestContext.current()?.requestId,
        stack: stack ?? head.stack,
        ...head.fields,
        ...fields,
      }),
    );
  }

  /**
   * The first argument: text; an error, described (name, code, cause) with its stack; or structured fields with their own
   * `message` (`logger.warn({ message: '…', eventId }, 'Context')`). Anything else is described, never `[object Object]`.
   */
  private readMessage(message: unknown): { message: string; stack?: string; fields: Record<string, unknown> } {
    if (typeof message === 'string') return { message, fields: {} };
    if (message instanceof Error || !isRecord(message)) {
      const error = describeError(message);
      return { message: error.message, ...(message instanceof Error && message.stack !== undefined ? { stack: message.stack } : {}), fields: { error } };
    }
    const { message: text, ...fields } = message;
    return { message: typeof text === 'string' ? text : describeError(message).message, fields };
  }

  private readOptional(optional: readonly unknown[]): {
    fields: Record<string, unknown>;
    context: string | undefined;
    stack: string | undefined;
  } {
    let fields: Record<string, unknown> = {};
    let context: string | undefined;
    let stack: string | undefined;
    for (const item of optional) {
      if (typeof item === 'string') {
        if (item.includes('\n    at ')) stack = item;
        else context = item;
      } else if (item instanceof Error) {
        fields = { ...fields, error: describeError(item) };
        stack ??= item.stack;
      } else if (typeof item === 'object' && item !== null) {
        fields = { ...fields, ...item };
      }
    }
    return { fields, context, stack };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
