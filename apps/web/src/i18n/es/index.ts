import { auth } from './auth';
import { common } from './common';
import { navigation } from './navigation';
import { tickets } from './tickets';

export const es = { auth, common, navigation, tickets } as const;
