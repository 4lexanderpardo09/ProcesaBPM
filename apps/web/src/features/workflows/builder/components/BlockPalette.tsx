import type { StepType } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { BLOCK_COLOR, PALETTE_GROUPS } from '../lib/block-catalog';
import { BLOCK_DRAG_TYPE } from './BuilderCanvas';
import styles from './Builder.module.css';

/** The blocks to add, grouped as in the prototype: drag one onto the canvas, or press it to add it in view. What each does is its tooltip. */
export function BlockPalette({ onAdd }: { readonly onAdd: (type: StepType) => void }) {
  const { t } = useTranslation('workflows');
  return (
    <nav className={styles.palette} aria-label={t('builder.palette.label')}>
      <p className={styles.paletteHint}>{t('builder.palette.hint')}</p>
      {PALETTE_GROUPS.map((group) => (
        <section key={group.key} className={styles.paletteGroup}>
          <h3 className={styles.paletteTitle}>{t(`builder.palette.groups.${group.key}`)}</h3>
          <ul className={styles.paletteList}>
            {group.types.map((type) => (
              <li key={type}>
                <button
                  type="button"
                  className={styles.paletteItem}
                  style={{ ['--block-color' as string]: BLOCK_COLOR[type] }}
                  draggable
                  aria-label={t('builder.palette.addNamed', { type: t(`builder.types.${type}`) })}
                  title={t(`builder.typeHints.${type}`)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(BLOCK_DRAG_TYPE, type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAdd(type)}
                >
                  <span className={styles.paletteName}>{t(`builder.types.${type}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
