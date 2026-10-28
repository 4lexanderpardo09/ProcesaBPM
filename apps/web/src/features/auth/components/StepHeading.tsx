import { useEffect, useRef } from 'react';
import styles from './auth-forms.module.css';

/** The heading of a sign-in step; it takes the focus when the step appears, so screen readers announce the change. */
export function StepHeading({ title, description }: { readonly title: string; readonly description?: string | undefined }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className={styles.heading}>
      <h1 ref={ref} tabIndex={-1} className="text-page-title">
        {title}
      </h1>
      {description !== undefined && <p className={styles.description}>{description}</p>}
    </div>
  );
}
