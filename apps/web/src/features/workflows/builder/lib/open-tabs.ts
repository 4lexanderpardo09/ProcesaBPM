import type { WorkflowVersionDocument } from '@procesabpm/shared';
import type { Selection } from './builder-doc';

export type OpenTab = NonNullable<Selection>;

/** The blocks and connections opened in the inspector, like the help desk's panels: in order, with a history to go back and forth. */
export interface OpenTabs {
  readonly tabs: readonly OpenTab[];
  /** Tabs visited, oldest first; `cursor` is the one shown. */
  readonly history: readonly OpenTab[];
  readonly cursor: number;
}

/** How many tabs stay open: opening another closes the oldest one that is not shown. */
export const MAX_TABS = 8;

export const emptyTabs: OpenTabs = { tabs: [], history: [], cursor: -1 };

const same = (left: OpenTab, right: OpenTab) => left.kind === right.kind && left.id === right.id;

/** Opens (or shows) a block or connection: it becomes the last visited, and the forward history is dropped. */
export function openTab(state: OpenTabs, tab: OpenTab): OpenTabs {
  const current = state.history[state.cursor];
  if (current !== undefined && same(current, tab)) return state;
  let tabs = state.tabs.some((open) => same(open, tab)) ? state.tabs : [...state.tabs, tab];
  if (tabs.length > MAX_TABS) tabs = tabs.filter((open, index) => index !== tabs.findIndex((candidate) => !same(candidate, tab)));
  const history = [...state.history.slice(0, state.cursor + 1), tab];
  return { tabs, history, cursor: history.length - 1 };
}

/** Closes a tab; when it was the one shown, the last visited one still open is shown instead (or none). */
export function closeTab(state: OpenTabs, tab: OpenTab): OpenTabs {
  const tabs = state.tabs.filter((open) => !same(open, tab));
  const history = state.history.filter((visited) => !same(visited, tab)).filter((visited, index, all) => index === 0 || !same(visited, all[index - 1]!));
  const shown = state.history[state.cursor];
  const keep = shown !== undefined && !same(shown, tab) ? history.findLastIndex((visited) => same(visited, shown)) : history.length - 1;
  return { tabs, history, cursor: keep };
}

/** Back (-1) or forward (+1) in the history of visited tabs. */
export function moveInHistory(state: OpenTabs, step: -1 | 1): OpenTabs {
  const cursor = state.cursor + step;
  return cursor < 0 || cursor >= state.history.length ? state : { ...state, cursor };
}

/** Drops what the document no longer has (a removed block or connection). */
export function keepExisting(state: OpenTabs, doc: WorkflowVersionDocument): OpenTabs {
  const exists = (tab: OpenTab) => (tab.kind === 'step' ? doc.steps.some((step) => step.id === tab.id) : doc.transitions.some((transition) => transition.id === tab.id));
  const gone = state.tabs.filter((tab) => !exists(tab));
  return gone.reduce(closeTab, state);
}

/** The tab shown, if any. */
export const shownTab = (state: OpenTabs): OpenTab | undefined => state.history[state.cursor];
