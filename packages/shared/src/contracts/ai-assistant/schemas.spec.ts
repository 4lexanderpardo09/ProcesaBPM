import { describe, expect, it } from 'vitest';
import { AI_NOTICE_VERSION, aiJobHistoryQuerySchema, updateAiAssistantSettingsSchema } from './schemas.js';

describe('AI assistant contracts', () => {
  it('the history of a draft brings 20 requests unless asked for up to 50', () => {
    expect(aiJobHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(aiJobHistoryQuerySchema.parse({ limit: '50' })).toEqual({ limit: 50 });
    expect(aiJobHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(aiJobHistoryQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(aiJobHistoryQuerySchema.safeParse({ limit: 5, other: 1 }).success).toBe(false);
  });

  it('turning the assistant on needs the current notice (the one that says descriptions are kept 90 days)', () => {
    expect(AI_NOTICE_VERSION).toBe(2);
    expect(updateAiAssistantSettingsSchema.safeParse({ enabled: true, acceptedNoticeVersion: 1 }).success).toBe(false);
    expect(updateAiAssistantSettingsSchema.safeParse({ enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION }).success).toBe(true);
    expect(updateAiAssistantSettingsSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});
