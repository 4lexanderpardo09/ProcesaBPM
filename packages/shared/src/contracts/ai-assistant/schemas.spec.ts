import { describe, expect, it } from 'vitest';
import { advanceSpec } from '../../workflow/draft-spec/test-fixtures.js';
import { workflowDraftSpecSchema } from '../../workflow/draft-spec/spec.js';
import { AI_NOTICE_VERSION, aiDraftResultSchema, aiJobHistoryQuerySchema, updateAiAssistantSettingsSchema } from './schemas.js';

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

  it('reads a result stored before decisions, the outline and corrections existed', () => {
    const stored = { revision: 3, assumptions: ['Supuesto'], rounds: 2, errors: 0, warnings: 1 };
    expect(aiDraftResultSchema.parse(stored)).toEqual({ ...stored, decisions: [], outline: null, corrections: 0 });
  });

  it('a template written before decisions existed still imports, and an unknown topic is refused', () => {
    const { decisions: _decisions, ...older } = advanceSpec();
    expect(workflowDraftSpecSchema.parse(older).decisions).toEqual([]);
    expect(workflowDraftSpecSchema.safeParse({ ...advanceSpec(), decisions: [{ topic: 'OTHER', text: 'x' }] }).success).toBe(false);
  });
});
