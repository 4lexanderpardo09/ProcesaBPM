import { describe, expect, it } from 'vitest';
import { EMAIL_POLICY_TYPES, emailPolicyTypeSchema, listNotificationsQuerySchema, notificationPreferenceRequestSchema, notificationTypeSchema, updateNotificationEmailPolicySchema } from './schemas.js';

describe('notification contracts', () => {
  it('lists with defaults and reads the unread filter as a boolean', () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, unread: undefined });
    expect(listNotificationsQuerySchema.parse({ unread: 'true', page: '2' })).toMatchObject({ page: 2, unread: true });
    expect(listNotificationsQuerySchema.safeParse({ unread: 'maybe' }).success).toBe(false);
  });
  it('a preference needs both channels and nothing else', () => {
    expect(notificationPreferenceRequestSchema.safeParse({ inApp: true, email: false }).success).toBe(true);
    expect(notificationPreferenceRequestSchema.safeParse({ inApp: true }).success).toBe(false);
    expect(notificationPreferenceRequestSchema.safeParse({ inApp: true, email: true, extra: 1 }).success).toBe(false);
  });
  it('knows the thirteen types of the database enum', () => {
    expect(notificationTypeSchema.options).toHaveLength(13);
  });

  it('lets an administrator govern every type but the storage warning, with one of the three policies', () => {
    expect(EMAIL_POLICY_TYPES).not.toContain('STORAGE_QUOTA');
    expect(EMAIL_POLICY_TYPES).toContain('SYSTEM');
    expect(emailPolicyTypeSchema.safeParse('STORAGE_QUOTA').success).toBe(false);
    expect(emailPolicyTypeSchema.safeParse('TICKET_CREATED').success).toBe(true);
    expect(updateNotificationEmailPolicySchema.safeParse({ policy: 'DEFAULT_OFF' }).success).toBe(true);
    expect(updateNotificationEmailPolicySchema.safeParse({ policy: 'SOMETIMES' }).success).toBe(false);
    expect(updateNotificationEmailPolicySchema.safeParse({ policy: 'OFF', extra: 1 }).success).toBe(false);
  });
});
