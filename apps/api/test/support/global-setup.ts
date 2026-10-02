import { setupTestDatabase, teardown as teardownDatabase } from '@procesabpm/db/testing';
import type { TestProject } from 'vitest/node';
import { setupTestStorage, teardownTestStorage } from './storage-setup.js';

export async function setup(project: TestProject): Promise<void> {
  await setupTestDatabase(project, 'procesabpm_api_test');
  await setupTestStorage(project);
}

export async function teardown(): Promise<void> {
  await teardownTestStorage();
  await teardownDatabase();
}
