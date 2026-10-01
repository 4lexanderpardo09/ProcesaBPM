import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPROVAL_GROUP_TYPE_NAME,
  DEFAULT_ERROR_TYPES,
  DEFAULT_PRIORITIES,
  DEFAULT_WORKING_SLOTS,
} from '../../src/seed/tenant-defaults.js';

describe('tenant defaults', () => {
  it('has the four priorities in order, with unique names and #RRGGBB colors', () => {
    expect(DEFAULT_PRIORITIES.map((priority) => priority.name)).toEqual(['Baja', 'Media', 'Alta', 'Urgente']);
    expect(DEFAULT_PRIORITIES.map((priority) => priority.sortOrder)).toEqual([1, 2, 3, 4]);
    for (const { color } of DEFAULT_PRIORITIES) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('has exactly one reopening error type, named Reapertura, and unique names', () => {
    const reopening = DEFAULT_ERROR_TYPES.filter((type) => type.isReopening);
    expect(reopening.map((type) => type.name)).toEqual(['Reapertura']);
    expect(new Set(DEFAULT_ERROR_TYPES.map((type) => type.name)).size).toBe(DEFAULT_ERROR_TYPES.length);
  });

  it('has the General approval group type', () => {
    expect(DEFAULT_APPROVAL_GROUP_TYPE_NAME).toBe('General');
  });

  it('works Monday to Friday, 08:00–12:00 and 14:00–18:00, with slots that do not overlap', () => {
    const slots = DEFAULT_WORKING_SLOTS.map(({ startTime, endTime }) => [startTime, endTime]);
    expect(slots).toEqual([['08:00', '12:00'], ['14:00', '18:00']]);
    for (const slot of DEFAULT_WORKING_SLOTS) expect(slot.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_WORKING_SLOTS[0]!.endTime <= DEFAULT_WORKING_SLOTS[1]!.startTime).toBe(true);
  });
});
