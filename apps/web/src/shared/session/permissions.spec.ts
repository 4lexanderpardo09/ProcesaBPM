import { describe, expect, it } from 'vitest';
import { grants } from './permissions';

const permission = (action: string, subject: string, conditional = false) => ({ action, subject, conditional });

describe('grants', () => {
  it('matches the action and subject, or manage and all', () => {
    expect(grants([permission('read', 'Category')], ['read', 'Category'])).toBe(true);
    expect(grants([permission('read', 'Category')], ['update', 'Category'])).toBe(false);
    expect(grants([permission('manage', 'Category')], ['update', 'Category'])).toBe(true);
    expect(grants([permission('read', 'all')], ['read', 'Priority'])).toBe(true);
    expect(grants([permission('manage', 'all')], ['delete', 'Role'])).toBe(true);
    expect(grants([], ['read', 'Category'])).toBe(false);
  });

  it('counts a conditional grant: the API decides record by record', () => {
    expect(grants([permission('read', 'Report', true)], ['read', 'Report'])).toBe(true);
  });
});
