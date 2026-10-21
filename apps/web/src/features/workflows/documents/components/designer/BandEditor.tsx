import type { PdfBlock, PdfDesign, WorkflowVersionDocument } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Select } from '@/shared/ui';
import { WholeNumberField } from '../../../builder/components/WholeNumberField';
import { addBlock, type Band, BAND_BLOCK_TYPES, BLOCK_TYPES, type BlockRef, type BlockType, blocksOf, blockSummary, moveBlock, removeBlock, replaceBlock, sameBlock, withBand } from '../../lib/design-doc';
import type { DesignProblem } from '../../lib/design-problems';
import { BlockEditor } from './BlockEditor';
import { ProblemText } from './ProblemText';
import styles from './Designer.module.css';

export interface BandEditorProps {
  readonly band: Band;
  readonly design: PdfDesign;
  readonly document: WorkflowVersionDocument;
  readonly problems: readonly DesignProblem[];
  readonly selected: BlockRef | undefined;
  readonly onSelect: (block: BlockRef | undefined) => void;
  readonly onChange: (design: PdfDesign) => void;
}

/** One zone of the page (header, body or footer): its blocks in order; the open one shows its settings in place. */
export function BandEditor({ band, design, document, problems, selected, onSelect, onChange }: BandEditorProps) {
  const { t } = useTranslation('workflows');
  const [adding, setAdding] = useState('');
  const blocks = blocksOf(design, band);
  const inBand = band !== 'body';
  const enabled = band === 'body' || design[band] !== undefined;
  const types = inBand ? BAND_BLOCK_TYPES : BLOCK_TYPES;
  const label = (block: PdfBlock, index: number) => t('documents.designer.blockLabel', { index: index + 1, type: t(`documents.designer.types.${block.type}`) });

  return (
    <section className={styles.band} aria-labelledby={`band-${band}`}>
      <header className={styles.bandHeader}>
        <h3 id={`band-${band}`} className={styles.bandTitle}>
          {t(`documents.designer.bands.${band}`)}
        </h3>
        {band !== 'body' && (
          <Checkbox
            label={t('documents.designer.useBand', { band: t(`documents.designer.bands.${band}`) })}
            checked={enabled}
            onChange={(event) => {
              if (selected?.band === band) onSelect(undefined);
              onChange(withBand(design, band, event.target.checked));
            }}
          />
        )}
      </header>
      {enabled && (
        <>
          {band !== 'body' && (
            <>
              <p className={styles.note}>{t('documents.designer.bandHint')}</p>
              <WholeNumberField label={t('documents.designer.bandHeight')} hint={t('documents.designer.block.points', { min: 12, max: 120 })} value={design[band]?.height ?? null} onChange={(height) => onChange({ ...design, [band]: { blocks: [...blocks], height: height ?? 0 } })} />
            </>
          )}
          {blocks.length === 0 ? (
            <p className={styles.note}>{t('documents.designer.noBlocks')}</p>
          ) : (
            <ol className={styles.blocks} aria-label={t('documents.designer.blocksOf', { band: t(`documents.designer.bands.${band}`) })}>
              {blocks.map((block, index) => {
                const ref = { band, index };
                const open = sameBlock(selected, ref);
                const own = problems.filter((problem) => sameBlock(problem.block, ref));
                const summary = blockSummary(block);
                return (
                  <li key={index} className={styles.blockRow} data-open={open || undefined} data-problem={own.some((problem) => !problem.draftOnly) || undefined}>
                    <div className={styles.blockHead}>
                      <button type="button" className={styles.blockToggle} aria-expanded={open} onClick={() => onSelect(open ? undefined : ref)}>
                        <span className={styles.blockName}>{label(block, index)}</span>
                        {summary !== '' && <span className={styles.blockSummary}>{summary}</span>}
                        {own.length > 0 && <span className={styles.blockBadge}>{t('documents.designer.problemCount', { count: own.length })}</span>}
                      </button>
                      <div className={styles.blockActions}>
                        <Button variant="ghost" aria-label={t('documents.designer.moveUp', { block: label(block, index) })} disabled={index === 0} onClick={() => move(index, -1)}>
                          ↑
                        </Button>
                        <Button variant="ghost" aria-label={t('documents.designer.moveDown', { block: label(block, index) })} disabled={index === blocks.length - 1} onClick={() => move(index, 1)}>
                          ↓
                        </Button>
                        <Button variant="ghost" aria-label={t('documents.designer.removeBlock', { block: label(block, index) })} onClick={() => remove(index)}>
                          ×
                        </Button>
                      </div>
                    </div>
                    {open && (
                      <div className={styles.blockBody} role="region" aria-label={t('documents.designer.blockSettings', { block: label(block, index) })}>
                        {own.length > 0 && (
                          <ul className={styles.problems}>
                            {own.map((problem, at) => (
                              <li key={at} data-draft={problem.draftOnly || undefined}>
                                <ProblemText problem={problem} />
                              </li>
                            ))}
                          </ul>
                        )}
                        <BlockEditor block={block} document={document} inBand={inBand} onChange={(next) => onChange(replaceBlock(design, band, index, next))} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <Select
            label={t('documents.designer.addBlock', { band: t(`documents.designer.bands.${band}`) })}
            placeholder={t('documents.designer.addBlockPlaceholder')}
            options={types.map((type) => ({ value: type, label: t(`documents.designer.types.${type}`) }))}
            value={adding}
            onChange={(event) => {
              const type = event.target.value as BlockType | '';
              setAdding('');
              if (type === '') return;
              onChange(addBlock(design, band, type));
              onSelect({ band, index: blocks.length });
            }}
          />
        </>
      )}
    </section>
  );

  function move(index: number, step: -1 | 1) {
    onChange(moveBlock(design, band, index, step));
    if (sameBlock(selected, { band, index })) onSelect({ band, index: index + step });
  }

  function remove(index: number) {
    onChange(removeBlock(design, band, index));
    if (selected?.band === band && selected.index >= index) onSelect(selected.index === index ? undefined : { band, index: selected.index - 1 });
  }
}
