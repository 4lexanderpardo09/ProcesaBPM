import { createContext, type RefObject, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Builder.module.css';

/** Which inspector sections are folded (by title), kept while the person moves between blocks. */
export interface SectionsState {
  readonly collapsed: ReadonlySet<string>;
  readonly toggle: (title: string) => void;
  readonly expand: (title: string) => void;
  readonly setAll: (titles: readonly string[] | null) => void;
}

export const SectionsContext = createContext<SectionsState | undefined>(undefined);

export function useSectionsState(): SectionsState {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return {
    collapsed,
    toggle: (title) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(title)) next.delete(title);
        else next.add(title);
        return next;
      }),
    expand: (title) =>
      setCollapsed((current) => {
        if (!current.has(title)) return current;
        const next = new Set(current);
        next.delete(title);
        return next;
      }),
    setAll: (titles) => setCollapsed(new Set(titles ?? [])),
  };
}

export const useSections = () => useContext(SectionsContext);

/**
 * A chip per section of the inspector (the help desk's section bar): a click unfolds it and scrolls to it. Fold or
 * unfold them all. The sections are read from what is on screen, so every inspector gets its own bar.
 */
export function SectionNav({ container }: { readonly container: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation('workflows');
  const sections = useSections();
  const [titles, setTitles] = useState<readonly string[]>([]);
  useEffect(() => {
    const found = [...(container.current?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].map((element) => element.dataset.section ?? '');
    setTitles((current) => (current.join('|') === found.join('|') ? current : found));
  });
  if (sections === undefined || titles.length < 2) return null;
  const allFolded = titles.every((title) => sections.collapsed.has(title));
  return (
    <nav className={styles.sectionNav} aria-label={t('builder.sections.label')}>
      {titles.map((title) => (
        <button
          key={title}
          type="button"
          className={styles.sectionChip}
          aria-label={t('builder.sections.goTo', { title })}
          onClick={() => {
            sections.expand(title);
            requestAnimationFrame(() => container.current?.querySelector(`[data-section="${CSS.escape(title)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
          }}
        >
          {title}
        </button>
      ))}
      <button type="button" className={styles.sectionChipToggle} onClick={() => sections.setAll(allFolded ? null : titles)}>
        {allFolded ? t('builder.sections.unfoldAll') : t('builder.sections.foldAll')}
      </button>
    </nav>
  );
}
