import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitedError } from '@procesabpm/shared';
import type { Request } from 'express';
import { RATE_LIMITER, type RateLimiter, type RateLimitRule } from '../../infrastructure/security/rate-limiter.js';
import { bearerToken } from './bearer-token.js';
import { sha256Hex } from '../../infrastructure/security/token-utils.js';

export interface RateLimitPolicy {
  /** Prefix of the counters, e.g. `login`. */
  readonly name: string;
  readonly perIp: RateLimitRule;
  /** Per e-mail, or per token (in the body or as a bearer) when there is no e-mail. */
  readonly perIdentifier: RateLimitRule;
}

const RATE_LIMIT_KEY = 'auth:rateLimit';

export const RateLimit = (policy: RateLimitPolicy): MethodDecorator => SetMetadata(RATE_LIMIT_KEY, policy);

/** The account the request targets, read before validation: rate limiting must also stop malformed floods. */
function identifierOf(request: Request): string | undefined {
  const { email, token } = typeof request.body === 'object' && request.body !== null ? (request.body as { email?: unknown; token?: unknown }) : {};
  if (typeof email === 'string') return `email:${email.trim().toLowerCase()}`;
  if (typeof token === 'string') return `token:${sha256Hex(token)}`;
  // Routes that authenticate with a bearer token (tenant selection, MFA challenge) are keyed by that token.
  const bearer = bearerToken(request.header?.('authorization'));
  return bearer === undefined ? undefined : `token:${sha256Hex(bearer)}`;
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
    // The IP goes first: a client over its limit cannot spend the budget of someone else's e-mail.
    await this.enforce(`${policy.name}:ip:${request.ip ?? 'unknown'}`, policy.perIp);
    const identifier = identifierOf(request);
    if (identifier !== undefined) await this.enforce(`${policy.name}:${identifier}`, policy.perIdentifier);
    return true;
  }

  private async enforce(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.limiter.hit(key, rule);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
