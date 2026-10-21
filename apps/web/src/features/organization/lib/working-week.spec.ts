import { describe, expect, it } from 'vitest';
import { slotIssues, slotsOf, weeklyMinutes } from './working-week';

describe('slotsOf', () => {
  it('takes the slots of one weekday, earliest first', () => {
    const hours = [
      { weekday: 1, startTime: '14:00', endTime: '18:00' },
      { weekday: 2, startTime: '08:00', endTime: '12:00' },
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
    ];
    expect(slotsOf(hours, 1)).toEqual([
      { startTime: '08:00', endTime: '12:00' },
      { startTime: '14:00', endTime: '18:00' },
    ]);
    expect(slotsOf(hours, 0)).toEqual([]);
  });
});

describe('weeklyMinutes', () => {
  it('adds up every slot of the week', () => {
    expect(weeklyMinutes([
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      { weekday: 1, startTime: '14:00', endTime: '18:30' },
      { weekday: 6, startTime: '08:00', endTime: '12:00' },
    ])).toBe(750);
  });
});

describe('slotIssues', () => {
  it('accepts slots apart or touching', () => {
    expect(slotIssues([
      { startTime: '14:00', endTime: '18:00' },
      { startTime: '08:00', endTime: '12:00' },
      { startTime: '12:00', endTime: '13:00' },
    ]).size).toBe(0);
  });

  it('marks an empty time and a slot that ends before it starts', () => {
    expect([...slotIssues([
      { startTime: '', endTime: '12:00' },
      { startTime: '18:00', endTime: '08:00' },
      { startTime: '09:00', endTime: '09:00' },
    ])]).toEqual([
      [0, 'incomplete'],
      [1, 'endsBeforeStart'],
      [2, 'endsBeforeStart'],
    ]);
  });

  it('marks the later of two slots that overlap, also inside a longer one', () => {
    expect([...slotIssues([
      { startTime: '08:00', endTime: '17:00' },
      { startTime: '13:00', endTime: '14:00' },
      { startTime: '16:00', endTime: '18:00' },
    ])]).toEqual([
      [1, 'overlaps'],
      [2, 'overlaps'],
    ]);
  });
});
