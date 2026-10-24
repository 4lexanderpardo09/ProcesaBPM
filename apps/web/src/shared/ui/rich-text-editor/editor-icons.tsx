import { createIcon } from '../icons/Icon';

export const UndoIcon = createIcon('UndoIcon', (
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>
));

export const RedoIcon = createIcon('RedoIcon', (
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>
));

export const BulletListIcon = createIcon('BulletListIcon', (
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </>
));

export const NumberedListIcon = createIcon('NumberedListIcon', (
  <>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 4h1v4M4 8h2M4 14.5a1 1 0 0 1 2 0c0 1-2 1.5-2 3.5h2" />
  </>
));

export const QuoteIcon = createIcon('QuoteIcon', (
  <>
    <path d="M4 6v12" />
    <path d="M9 8h11M9 12h11M9 16h7" />
  </>
));

export const AlignLeftIcon = createIcon('AlignLeftIcon', <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />);
export const AlignCenterIcon = createIcon('AlignCenterIcon', <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />);
export const AlignRightIcon = createIcon('AlignRightIcon', <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />);
export const AlignJustifyIcon = createIcon('AlignJustifyIcon', <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />);

export const LinkIcon = createIcon('LinkIcon', (
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>
));

export const TableIcon = createIcon('TableIcon', (
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
  </>
));

export const HighlightIcon = createIcon('HighlightIcon', (
  <>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </>
));

export const ClearFormatIcon = createIcon('ClearFormatIcon', (
  <>
    <path d="M4 7V5h13v2" />
    <path d="M10.5 5 8 19" />
    <path d="m15 13 6 6M21 13l-6 6" />
  </>
));
