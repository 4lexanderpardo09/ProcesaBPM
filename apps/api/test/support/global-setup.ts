import { setupTestDatabase, teardown } from '@procesabpm/db/testing';
import type { TestProject } from 'vitest/node';

export async function setup(project: TestProject): Promise<void> {
  await setupTestDatabase(project, 'procesabpm_api_test');
}

export { teardown };
