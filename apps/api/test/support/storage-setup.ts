import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import type { TestProject } from 'vitest/node';

export interface TestStorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    storage: TestStorageSettings;
  }
}

let container: StartedMinioContainer | undefined;

/**
 * Real MinIO: Testcontainers when Docker is available; otherwise (cloud sandbox) an already running server
 * given by TEST_S3_ENDPOINT, TEST_S3_ACCESS_KEY and TEST_S3_SECRET_KEY. Every run gets its own bucket.
 */
export async function setupTestStorage(project: TestProject): Promise<void> {
  const settings = process.env.TEST_S3_ENDPOINT ? fromEnvironment() : await startContainer();
  await new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  }).send(new CreateBucketCommand({ Bucket: settings.bucket }));
  project.provide('storage', settings);
}

export async function teardownTestStorage(): Promise<void> {
  await container?.stop();
}

const newBucket = (): string => `test-${randomUUID()}`;

function fromEnvironment(): TestStorageSettings {
  return {
    endpoint: process.env.TEST_S3_ENDPOINT!,
    region: 'us-east-1',
    bucket: newBucket(),
    accessKeyId: process.env.TEST_S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.TEST_S3_SECRET_KEY ?? 'minioadmin',
  };
}

async function startContainer(): Promise<TestStorageSettings> {
  container = await new MinioContainer().start();
  return {
    endpoint: container.getConnectionUrl(),
    region: 'us-east-1',
    bucket: newBucket(),
    accessKeyId: container.getUsername(),
    secretAccessKey: container.getPassword(),
  };
}
