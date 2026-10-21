import { Link } from 'react-router';
import { cx } from '@/shared/lib/cx';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  readonly label: string;
  /** A link back; the last item is the current page and has none. */
  readonly to?: string;
  /** Shown in the code font (a ticket number). */
  readonly code?: boolean;
}

export interface BreadcrumbProps {
  /** The name of the navigation for assistive technology ("Ruta de navegación"). */
  readonly label: string;
  readonly items: readonly BreadcrumbItem[];
}

/** Where the page sits: "Tickets › Nuevo ticket". The last item is the current page. */
export function Breadcrumb({ label, items }: BreadcrumbProps) {
  return (
    <nav aria-label={label}>
      <ol className={styles.breadcrumb}>
        {items.map((item, index) =>
          index === items.length - 1 ? (
            <li key={item.label} aria-current="page" className={cx(item.code === true && 'text-code')}>
              {item.label}
            </li>
          ) : (
            <li key={item.label} className={cx(item.code === true && 'text-code')}>
              {item.to === undefined ? item.label : <Link to={item.to}>{item.label}</Link>}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
