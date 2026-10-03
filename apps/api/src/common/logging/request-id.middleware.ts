import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const USER_AGENT_MAX_LENGTH = 512;
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Keeps a well-formed id sent by a proxy, otherwise generates one; echoes it in the response. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(@Inject(RequestContext) private readonly requestContext: RequestContext) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header(REQUEST_ID_HEADER);
    const requestId = incoming !== undefined && ACCEPTED_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    response.setHeader(REQUEST_ID_HEADER, requestId);
    const userAgent = request.header('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH);
    this.requestContext.run({ requestId, auditedActions: new Set<string>(), ...(request.ip === undefined ? {} : { ipAddress: request.ip }), ...(userAgent === undefined ? {} : { userAgent }) }, next);
  }
}
