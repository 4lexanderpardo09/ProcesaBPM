import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { ApiError } from '@/shared/api';
import { problemsByElement, problemTarget, problemText } from './problems';
import { serverOnlyProblems, withServerProblems } from './server-problems';

const t = i18n.getFixedT('es', ['workflowProblems', 'workflows']) as TFunction<['workflowProblems', 'workflows']>;

describe('problem text', () => {
  it('fills in the values, joining lists and naming modes and operators in Spanish', () => {
    expect(problemText({ code: 'STEP_NAME_DUPLICATE', severity: 'error', params: { name: 'Revisión' } }, t)).toBe('Hay otro bloque llamado «Revisión»: los nombres no se pueden repetir.');
    expect(problemText({ code: 'TEMPLATE_UNKNOWN_FIELD', severity: 'warning', params: { codes: ['A', 'B'] } }, t)).toContain('A, B');
    expect(problemText({ code: 'ASSIGNMENT_MISSING_CANDIDATES', severity: 'error', params: { mode: 'POOL' } }, t)).toBe('El modo «Bolsa (el primero que lo toma)» necesita sus personas, grupos o cargo.');
    expect(problemText({ code: 'CONDITION_OPERATOR_TYPE_MISMATCH', severity: 'error', params: { code: 'AMOUNT', operator: 'gt', fieldType: 'TEXT' } }, t)).toBe('El operador «es mayor que» no sirve para el campo AMOUNT.');
  });

  it('still says something, and which code, when the code is new', () => {
    expect(problemText({ code: 'SOMETHING_NEW', severity: 'error' }, t)).toBe('Hay un problema que esta pantalla aún no sabe explicar (SOMETHING_NEW).');
  });

  it('points at the block, else the connection', () => {
    expect(problemTarget({ code: 'X', severity: 'error', stepId: 's', transitionId: 't' })).toEqual({ kind: 'step', id: 's' });
    expect(problemTarget({ code: 'X', severity: 'error', transitionId: 't' })).toEqual({ kind: 'transition', id: 't' });
    expect(problemTarget({ code: 'NO_END', severity: 'error' })).toBeNull();
  });

  it('groups the problems of each block and connection', () => {
    const of = problemsByElement({ errors: [{ code: 'A', severity: 'error', stepId: 's' }], warnings: [{ code: 'B', severity: 'warning', stepId: 's' }, { code: 'C', severity: 'warning', transitionId: 't' }] });
    expect(of('s').errors).toHaveLength(1);
    expect(of('s').warnings).toHaveLength(1);
    expect(of('t').warnings).toHaveLength(1);
    expect(of('other')).toEqual({ errors: [], warnings: [] });
  });
});

describe('server problems', () => {
  const refused = (details: unknown) => new ApiError({ status: 422, code: 'WORKFLOW_NOT_PUBLISHABLE', message: 'x', details });

  it('keeps from a refused publication only what the canvas cannot find by itself', () => {
    const problems = serverOnlyProblems(
      refused({ errors: [{ code: 'NO_END', severity: 'error' }, { code: 'CALCULATOR_NOT_CONFIGURED', severity: 'error', stepId: 's', params: { code: 'MEAL_ALLOWANCE' } }], warnings: [] }),
    );
    expect(problems.map((problem) => problem.code)).toEqual(['CALCULATOR_NOT_CONFIGURED']);
    expect(withServerProblems({ errors: [], warnings: [] }, problems).errors).toHaveLength(1);
  });

  it('ignores any other error and malformed details', () => {
    expect(serverOnlyProblems(new ApiError({ status: 409, code: 'STALE_REVISION', message: 'x' }))).toEqual([]);
    expect(serverOnlyProblems(refused('nonsense'))).toEqual([]);
    expect(serverOnlyProblems(refused({ errors: [{ nope: true }] }))).toEqual([]);
  });
});
