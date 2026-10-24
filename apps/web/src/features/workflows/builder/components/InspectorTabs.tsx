import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { BLOCK_COLOR } from '../lib/block-catalog';
import { type OpenTab, type OpenTabs, shownTab } from '../lib/open-tabs';
import styles from './Builder.module.css';

export interface InspectorTabsProps {
  readonly state: OpenTabs;
  readonly doc: WorkflowVersionDocument;
  readonly wide: boolean;
  readonly onShow: (tab: OpenTab) => void;
  readonly onClose: (tab: OpenTab) => void;
  readonly onCloseAll: () => void;
  readonly onHistory: (step: -1 | 1) => void;
  readonly onToggleWide: () => void;
}

/**
 * The blocks and connections opened in the inspector, one tab each (the help desk's panels over its canvas): back and
 * forward through the ones visited, close one or all, and a wider inspector for long forms.
 */
export function InspectorTabs({ state, doc, wide, onShow, onClose, onCloseAll, onHistory, onToggleWide }: InspectorTabsProps) {
  const { t } = useTranslation('workflows');
  const shown = shownTab(state);
  const labelOf = (tab: OpenTab) => {
    if (tab.kind === 'step') return doc.steps.find((step) => step.id === tab.id)?.name ?? '';
    const transition = doc.transitions.find((candidate) => candidate.id === tab.id);
    return transition === undefined ? '' : t('builder.tabs.connection', { label: transition.label });
  };
  const colorOf = (tab: OpenTab) => {
    const type = tab.kind === 'step' ? doc.steps.find((step) => step.id === tab.id)?.type : undefined;
    return type === undefined ? 'var(--faint)' : BLOCK_COLOR[type];
  };
  return (
    <div className={styles.tabsBar}>
      <button type="button" className={styles.tabsNav} disabled={state.cursor <= 0} aria-label={t('builder.tabs.back')} title={t('builder.tabs.back')} onClick={() => onHistory(-1)}>
        ‹
      </button>
      <button type="button" className={styles.tabsNav} disabled={state.cursor >= state.history.length - 1} aria-label={t('builder.tabs.forward')} title={t('builder.tabs.forward')} onClick={() => onHistory(1)}>
        ›
      </button>
      <nav className={styles.tabsList} aria-label={t('builder.tabs.label')}>
        {state.tabs.map((tab) => {
          const active = shown !== undefined && shown.kind === tab.kind && shown.id === tab.id;
          const label = labelOf(tab);
          return (
            <span key={`${tab.kind}:${tab.id}`} className={cx(styles.tab, active && styles.tabActive)} style={{ ['--block-color' as string]: colorOf(tab) }}>
              <button type="button" className={styles.tabLabel} aria-current={active ? 'true' : undefined} title={label} onClick={() => onShow(tab)}>
                {label}
              </button>
              <button type="button" className={styles.tabClose} aria-label={t('builder.tabs.close', { name: label })} onClick={() => onClose(tab)}>
                ×
              </button>
            </span>
          );
        })}
      </nav>
      {state.tabs.length > 1 && (
        <button type="button" className={styles.tabsNav} aria-label={t('builder.tabs.closeAll')} title={t('builder.tabs.closeAll')} onClick={onCloseAll}>
          ⨯
        </button>
      )}
      <button type="button" className={styles.tabsNav} aria-pressed={wide} aria-label={wide ? t('builder.tabs.narrow') : t('builder.tabs.wide')} title={wide ? t('builder.tabs.narrow') : t('builder.tabs.wide')} onClick={onToggleWide}>
        {wide ? '⇥' : '⇤'}
      </button>
    </div>
  );
}
