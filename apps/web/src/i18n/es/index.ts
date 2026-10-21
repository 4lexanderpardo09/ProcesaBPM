import { auth } from './auth';
import { catalog } from './catalog';
import { common } from './common';
import { navigation } from './navigation';
import { tickets } from './tickets';

export const es = { auth, catalog, common, navigation, tickets } as const;
