import { type KeyboardEvent, useEffect, useRef } from 'react';
import styles from './Tabs.module.css';

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count?: number;
}

export interface TabsProps<T extends string> {
  readonly label: string;
  readonly items: readonly TabItem<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

const STEP_BY_KEY: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };

/** Controlled tab bar (WAI-ARIA tabs pattern: arrow keys move between tabs, only the selected one is focusable). */
export function Tabs<T extends string>({ label, items, value, onChange }: TabsProps<T>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  // On a narrow screen the row scrolls: the selected tab is kept in view (sideways only, the page does not move).
  const selectedIndex = items.findIndex((item) => item.value === value);
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[selectedIndex];
    if (list === null || tab == null) return;
    if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
  }, [selectedIndex]);

  const selectAt = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    onChange(item.value);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEP_BY_KEY[event.key];
    if (step !== undefined) selectAt((index + step + items.length) % items.length);
    else if (event.key === 'Home') selectAt(0);
    else if (event.key === 'End') selectAt(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={styles.list}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.label}
            {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
