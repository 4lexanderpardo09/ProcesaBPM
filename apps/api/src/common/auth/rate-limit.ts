import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitedError } from '@procesabpm/shared';
import type { Request } from 'express';
import { RATE_LIMITER, type RateLimiter, type RateLimitRule } from '../../infrastructure/security/rate-limiter.js';
import { sha256Hex } from '../../infrastructure/security/token-utils.js';

export interface RateLimitPolicy {
  /** Prefix of the counters, e.g. `login`. */
  readonly name: string;
  readonly perIp: RateLimitRule;
  /** Per e-mail, or per token when the body has no e-mail. */
  readonly perIdentifier: RateLimitRule;
}

const RATE_LIMIT_KEY = 'auth:rateLimit';

export const RateLimit = (policy: RateLimitPolicy): MethodDecorator => SetMetadata(RATE_LIMIT_KEY, policy);

/** The account the request targets, read before validation: rate limiting must also stop malformed floods. */
function identifierOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { email, token } = body as { email?: unknown; token?: unknown };
  if (typeof email === 'string') return `email:${email.trim().toLowerCase()}`;
  if (typeof token === 'string') return `token:${sha256Hex(token)}`;
  return undefined;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<RateLimitPolicy | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (policy === undefined) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const checks = [this.limiter.hit(`${policy.name}:ip:${request.ip ?? 'unknown'}`, policy.perIp)];
    const identifier = identifierOf(request.body);
    if (identifier !== undefined) checks.push(this.limiter.hit(`${policy.name}:${identifier}`, policy.perIdentifier));
    const denied = (await Promise.all(checks)).filter((result) => !result.allowed);
    if (denied.length > 0) throw new RateLimitedError(Math.max(...denied.map((result) => result.retryAfterSeconds)));
    return true;
  }
}
