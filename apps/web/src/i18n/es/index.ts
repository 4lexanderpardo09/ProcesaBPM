import { admin } from './admin';
import { auth } from './auth';
import { catalog } from './catalog';
import { common } from './common';
import { navigation } from './navigation';
import { notifications } from './notifications';
import { organization } from './organization';
import { people } from './people';
import { profile } from './profile';
import { settings } from './settings';
import { tickets } from './tickets';
import { workflowProblems } from './workflow-problems';
import { workflows } from './workflows';

export const es = { admin, auth, catalog, common, navigation, notifications, organization, people, profile, settings, tickets, workflowProblems, workflows } as const;
