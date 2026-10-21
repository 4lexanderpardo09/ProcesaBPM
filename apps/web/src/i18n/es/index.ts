import { admin } from './admin';
import { auth } from './auth';
import { catalog } from './catalog';
import { common } from './common';
import { navigation } from './navigation';
import { tickets } from './tickets';

export const es = { admin, auth, catalog, common, navigation, tickets } as const;
