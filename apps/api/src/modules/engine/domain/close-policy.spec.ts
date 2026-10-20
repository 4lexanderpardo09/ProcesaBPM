import { CloseNotAllowedError, CloseRequiredError, ExtraApprovalRequiredError, type StepDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { assertMayClose, assertMayLeaveByDecision, closeRefusal, leaveByDecisionRefusal } from './close-policy.js';

const step = (closeRule: StepDocument['closeRule']) => ({ closeRule }) as StepDocument;

describe('assertMayLeaveByDecision', () => {
  it('refuses a REQUIRED step', () => expect(() => assertMayLeaveByDecision(step('REQUIRED'))).toThrow(CloseRequiredError));
  it.each(['ALLOWED', 'NOT_ALLOWED'] as const)('lets a %s step go', (rule) => expect(() => assertMayLeaveByDecision(step(rule))).not.toThrow());
});

describe('assertMayClose', () => {
  it.each(['ALLOWED', 'REQUIRED'] as const)('a %s step may close', (rule) => expect(() => assertMayClose(step(rule), false)).not.toThrow());
  it('a step that does not allow it may not', () => expect(() => assertMayClose(step('NOT_ALLOWED'), false)).toThrow(CloseNotAllowedError));
  it('closing past an unvisited extra approval is refused', () => expect(() => assertMayClose(step('ALLOWED'), true)).toThrow(ExtraApprovalRequiredError));
});

describe('the refusals behind them', () => {
  it('answer null when the step lets the ticket go', () => {
    expect(leaveByDecisionRefusal(step('ALLOWED'))).toBeNull();
    expect(closeRefusal(step('REQUIRED'), false)).toBeNull();
  });
  it('answer the error the assertion throws', () => {
    expect(leaveByDecisionRefusal(step('REQUIRED'))).toBeInstanceOf(CloseRequiredError);
    expect(closeRefusal(step('NOT_ALLOWED'), false)).toBeInstanceOf(CloseNotAllowedError);
    expect(closeRefusal(step('ALLOWED'), true)).toBeInstanceOf(ExtraApprovalRequiredError);
  });
});
