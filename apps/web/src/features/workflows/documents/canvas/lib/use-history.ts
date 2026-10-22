import { useCallback, useRef, useState } from 'react';

interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

const LIMIT = 150;
/** Changes with the same key closer than this merge into one step: typing does not fill the history letter by letter. */
const MERGE_WINDOW_MS = 1000;

/**
 * State with undo and redo. `change` records a step per call (or merges calls with the same `key` in quick
 * succession); `preview` changes without recording, while something is dragged, and `commit` then records one step
 * from where the drag started.
 */
export function useHistory<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] });
  const beforeDrag = useRef<T | null>(null);
  const last = useRef<{ key: string; at: number } | null>(null);

  const change = useCallback((update: (current: T) => T, key?: string) => {
    const now = Date.now();
    const merge = key !== undefined && last.current?.key === key && now - last.current.at < MERGE_WINDOW_MS;
    last.current = key === undefined ? null : { key, at: now };
    setHistory((state) => {
      const next = update(state.present);
      if (next === state.present) return state;
      return { past: merge ? state.past : [...state.past, state.present].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  const preview = useCallback((update: (current: T) => T) => {
    setHistory((state) => {
      if (beforeDrag.current === null) beforeDrag.current = state.present;
      return { ...state, present: update(state.present) };
    });
  }, []);

  const commit = useCallback(() => {
    const start = beforeDrag.current;
    beforeDrag.current = null;
    last.current = null;
    if (start === null) return;
    setHistory((state) => (state.present === start ? state : { past: [...state.past, start].slice(-LIMIT), present: state.present, future: [] }));
  }, []);

  const undo = useCallback(() => {
    last.current = null;
    setHistory((state) => (state.past.length === 0 ? state : { past: state.past.slice(0, -1), present: state.past[state.past.length - 1]!, future: [state.present, ...state.future] }));
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setHistory((state) => (state.future.length === 0 ? state : { past: [...state.past, state.present], present: state.future[0]!, future: state.future.slice(1) }));
  }, []);

  return { current: history.present, change, preview, commit, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
