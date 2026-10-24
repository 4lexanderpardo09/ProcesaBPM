import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { closeTab, emptyTabs, keepExisting, MAX_TABS, moveInHistory, openTab, type OpenTabs, shownTab } from './open-tabs';

const step = (id: string) => ({ kind: 'step', id }) as const;
const open = (...ids: string[]) => ids.reduce<OpenTabs>((state, id) => openTab(state, step(id)), emptyTabs);

describe('open tabs', () => {
  it('opens each block once, shows the last one, and goes back and forth', () => {
    const state = openTab(open('a', 'b', 'c'), step('a'));
    expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c']);
    expect(shownTab(state)?.id).toBe('a');
    expect(shownTab(moveInHistory(state, -1))?.id).toBe('c');
    expect(shownTab(moveInHistory(moveInHistory(state, -1), 1))?.id).toBe('a');
    expect(moveInHistory(state, 1)).toBe(state);
    // Opening from the middle of the history drops what was ahead.
    const branched = openTab(moveInHistory(moveInHistory(state, -1), -1), step('d'));
    expect(branched.history.map((tab) => tab.id)).toEqual(['a', 'b', 'd']);
  });

  it('closing the shown tab shows the last visited one still open; closing another keeps the shown one', () => {
    const state = open('a', 'b', 'c');
    expect(shownTab(closeTab(state, step('c')))?.id).toBe('b');
    expect(shownTab(closeTab(state, step('a')))?.id).toBe('c');
    expect(shownTab(closeTab(closeTab(closeTab(state, step('a')), step('b')), step('c')))).toBeUndefined();
  });

  it('keeps at most a few tabs, and drops the ones whose block is gone', () => {
    const many = open(...Array.from({ length: MAX_TABS + 2 }, (_, index) => `s${String(index)}`));
    expect(many.tabs).toHaveLength(MAX_TABS);
    expect(many.tabs[0]?.id).toBe('s2');
    const doc = { steps: [{ id: 'a' }], transitions: [] } as unknown as WorkflowVersionDocument;
    expect(keepExisting(open('a', 'b'), doc).tabs.map((tab) => tab.id)).toEqual(['a']);
  });
});
