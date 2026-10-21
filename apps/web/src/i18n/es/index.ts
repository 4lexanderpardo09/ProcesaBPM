import { admin } from './admin';
import { auth } from './auth';
import { catalog } from './catalog';
import { common } from './common';
import { navigation } from './navigation';
import { organization } from './organization';
import { people } from './people';
import { profile } from './profile';
import { tickets } from './tickets';

export const es = { admin, auth, catalog, common, navigation, organization, people, profile, tickets } as const;
