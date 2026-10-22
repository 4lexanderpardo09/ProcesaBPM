import type { CanvasElement } from '@procesabpm/shared';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { cssOf } from '../lib/canvas-css';
import { PX_PER_PT } from '../lib/canvas-doc';
import styles from './Canvas.module.css';

const PLACEHOLDER = /(\{\{[^}]*\}\})/g;

/** A text with its placeholders marked, so the person sees where the ticket's data goes. */
function Marked({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(PLACEHOLDER).map((piece, index) =>
        piece.startsWith('{{') ? (
          <span key={index} className={styles.placeholder}>
            {piece.slice(2, -2)}
          </span>
        ) : (
          <Fragment key={index}>{piece}</Fragment>
        ),
      )}
    </>
  );
}

/** How an element looks on the sheet of the editor: its box with its style, and a sketch of what it prints. */
export function ElementView({ element, zoom }: { readonly element: CanvasElement; readonly zoom: number }) {
  const { t } = useTranslation('workflows');
  const css = cssOf(element.style, zoom);
  switch (element.type) {
    case 'text':
      return (
        <div className={styles.fill} style={css}>
          {element.content === '' ? <span className={styles.ghost}>{t('documents.canvas.emptyText')}</span> : <Marked text={element.content} />}
        </div>
      );
    case 'rectangle':
      return <div className={styles.fill} style={css} />;
    case 'image':
      return (
        <div className={`${styles.fill} ${styles.imageBox}`} style={css}>
          <span className={styles.ghost}>{t('documents.canvas.logo')}</span>
        </div>
      );
    case 'line': {
      const thickness = Math.max(1, element.thickness * PX_PER_PT * zoom);
      const border = `${thickness}px ${element.dash === 'DASHED' ? 'dashed' : element.dash === 'DOTTED' ? 'dotted' : 'solid'} ${element.color}`;
      return (
        <div className={styles.lineBox}>
          <div className={styles.line} style={element.orientation === 'HORIZONTAL' ? { width: '100%', borderTop: border } : { height: '100%', borderLeft: border }} />
        </div>
      );
    }
    case 'signature':
      return (
        <div className={styles.fill} style={{ ...css, justifyContent: 'flex-end' }}>
          {element.showLine && <div className={styles.signatureLine} style={{ borderTopColor: element.style.color }} />}
          {element.showName && <strong>{element.source === 'BLANK' ? t('documents.canvas.signatureName') : element.source === 'REQUESTER' ? t('documents.canvas.requester') : t('documents.canvas.signerOf', { step: element.stepName ?? '' })}</strong>}
          {element.label !== '' && <span>{element.label}</span>}
          {element.showDate && <span className={styles.ghost}>{t('documents.canvas.signatureDate')}</span>}
        </div>
      );
    case 'table': {
      const header = cssOf(element.headerStyle, zoom);
      const body = cssOf(element.style, zoom);
      const columns = element.columns.map((column) => `${column.weight}fr`).join(' ');
      const rows = Math.max(2, element.minRows);
      return (
        <div className={styles.table} style={{ gridTemplateColumns: columns }}>
          {element.showHeader &&
            element.columns.map((column, index) => (
              <div key={`h${index}`} style={{ ...header, display: 'block', textAlign: column.align.toLowerCase() as 'left' }}>
                {column.header}
              </div>
            ))}
          {Array.from({ length: rows }, (_, row) =>
            element.columns.map((column, index) => (
              <div key={`${row}-${index}`} style={{ ...body, display: 'block', textAlign: column.align.toLowerCase() as 'left', background: row % 2 === 1 && element.zebra !== null ? element.zebra : body.background }}>
                {row === 0 ? <Marked text={column.value} /> : ' '}
              </div>
            )),
          )}
          {element.showTotals &&
            element.columns.map((column, index) => (
              <div key={`t${index}`} style={{ ...body, display: 'block', fontWeight: 700, textAlign: column.align.toLowerCase() as 'left' }}>
                {column.sum ? 'Σ' : index === 0 ? element.totalLabel : ''}
              </div>
            ))}
        </div>
      );
    }
  }
}
