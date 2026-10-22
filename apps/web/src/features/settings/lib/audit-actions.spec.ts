import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { actionLabel } from './audit-actions';

describe('actionLabel', () => {
  const t = i18n.getFixedT('es', 'settings');

  it('names a known action in Spanish', () => {
    expect(actionLabel('role.permissions_replaced', t)).toBe('Cambió los permisos de un rol');
  });

  it('shows the subject and verb of one without a name', () => {
    expect(actionLabel('category.created', t)).toBe('category · created');
  });
});
