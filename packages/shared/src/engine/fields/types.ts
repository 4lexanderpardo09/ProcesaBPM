import type { FieldValueIssue } from '../../errors/domain-error.js';

export type { FieldValueIssue };

export type FieldIssueCode = 'REQUIRED' | 'INVALID_TYPE' | 'OUT_OF_RANGE' | 'TOO_MANY_DECIMALS' | 'NOT_AN_OPTION' | 'UNKNOWN_FIELD' | 'NOT_EDITABLE' | 'TOO_MANY_ROWS' | 'TOO_FEW_ROWS';

/** A value that must exist in the tenant's data (site, user, preset record, dataset row): the server checks it. */
export interface ReferenceToVerify {
  readonly fieldCode: string;
  readonly kind: 'SITE' | 'USER' | 'PRESET' | 'DATASET';
  readonly value: string;
  /** Extra data the check needs (site level, allowed positions, preset name, dataset id and column). */
  readonly config: Readonly<Record<string, unknown>>;
}

export interface ValidationContext {
  /** Today in the company time zone, `YYYY-MM-DD`. */
  readonly today: string;
}

export interface CapturedValues {
  /** Canonical values of the fields the caller sent. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly issues: readonly FieldValueIssue[];
  readonly references: readonly ReferenceToVerify[];
}
