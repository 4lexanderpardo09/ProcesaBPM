/** The people and organizations apps/api/test/web-stack/web-stack-fixtures.ts seeds: keep both in sync. */
export const STACK_PASSWORD = 'e2e correct horse battery';

export const PEOPLE = {
  singleOrganization: { email: 'ana@e2e.test', name: 'Ana Torres' },
  tabs: { email: 'tabs@e2e.test', name: 'Tomás Rey' },
  twoOrganizations: { email: 'leo@e2e.test', name: 'Leo Mora' },
  mustEnroll: { email: 'eva@e2e.test', name: 'Eva Ríos' },
  /** Has two unread notifications and one read. */
  notified: { email: 'bell@e2e.test', name: 'Bruno Paz' },
  /** Designs workflows (the workflow specs sign in several times). */
  designer: { email: 'flows@e2e.test', name: 'Fabio Ruiz' },
} as const;
