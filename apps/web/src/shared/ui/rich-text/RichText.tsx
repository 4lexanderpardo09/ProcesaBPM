import { useMemo } from 'react';
import styles from './RichText.module.css';
import { richTextNodes } from './rich-text-nodes';

export interface RichTextProps {
  /** HTML the API already sanitized (descriptions, comments). */
  readonly html: string;
}

/** Formatted text from the API: paragraphs, emphasis, lists and safe links. */
export function RichText({ html }: RichTextProps) {
  const nodes = useMemo(() => richTextNodes(html), [html]);
  return <div className={styles.richText}>{nodes}</div>;
}
