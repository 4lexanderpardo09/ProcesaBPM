import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '../../modules/audit/domain/audit-actions.js';

export const AUDITED_KEY = 'audit:actions';
export const NOT_AUDITED_KEY = 'audit:notAudited';

/**
 * Declares which audit events the route writes (the service calls `AuditTrail.record` in the transaction of the action).
 * The declaration is checked: every route that changes data of an audited subject must carry it or `@NotAudited`, and
 * the end-to-end tests fail a request that answered 2xx without having recorded each declared action.
 */
export const Audited = (...actions: AuditAction[]): MethodDecorator => SetMetadata<string, readonly AuditAction[]>(AUDITED_KEY, actions);

/** A route that changes audited subjects on purpose without an audit event; the reason is part of the review. */
export const NotAudited = (reason: string): MethodDecorator => SetMetadata<string, string>(NOT_AUDITED_KEY, reason);
