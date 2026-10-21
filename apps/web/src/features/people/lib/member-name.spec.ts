import { describe, expect, it } from 'vitest';
import { memberName } from './member-name';

describe('memberName', () => {
  it('uses the names, and the e-mail while an invitation is pending', () => {
    expect(memberName({ firstName: 'Ana', lastName: 'Torres', email: 'ana@acme.test' })).toBe('Ana Torres');
    expect(memberName({ firstName: '', lastName: '', email: 'nora@acme.test' })).toBe('nora@acme.test');
  });
});
