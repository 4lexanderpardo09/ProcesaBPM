import { createIcon } from './Icon';

export const InboxIcon = createIcon('InboxIcon', (
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>
));

export const WorkflowIcon = createIcon('WorkflowIcon', (
  <>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </>
));

export const ChartIcon = createIcon('ChartIcon', (
  <>
    <path d="M12 20V10" />
    <path d="M18 20V4" />
    <path d="M6 20v-4" />
  </>
));

export const GridIcon = createIcon('GridIcon', (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </>
));

export const BuildingIcon = createIcon('BuildingIcon', (
  <>
    <rect x="4" y="3" width="16" height="18" rx="1" />
    <path d="M9 21v-4h6v4" />
    <path d="M8 7h2M14 7h2M8 11h2M14 11h2" />
  </>
));

export const UserIcon = createIcon('UserIcon', (
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>
));

export const SearchIcon = createIcon('SearchIcon', (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>
));

export const ChevronDownIcon = createIcon('ChevronDownIcon', <path d="m6 9 6 6 6-6" />);

export const PlusIcon = createIcon('PlusIcon', (
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>
));

export const LogOutIcon = createIcon('LogOutIcon', (
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>
));

export const CopyIcon = createIcon('CopyIcon', (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
));

export const DownloadIcon = createIcon('DownloadIcon', (
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </>
));

export const CheckIcon = createIcon('CheckIcon', <path d="M20 6 9 17l-5-5" />);
