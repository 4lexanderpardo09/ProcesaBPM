import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
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

const S3_IMAGE = 'chrislusf/seaweedfs:4.48';
const S3_PORT = 8333;
const S3_CREDENTIALS = { accessKeyId: 'testkey', secretAccessKey: 'testsecret' } as const;

let container: StartedTestContainer | undefined;

/**
 * A real S3-compatible server (SeaweedFS: MinIO stopped publishing images and binaries). Testcontainers when Docker
 * is available; otherwise (cloud sandbox) an already running server given by TEST_S3_ENDPOINT, TEST_S3_ACCESS_KEY and
 * TEST_S3_SECRET_KEY. Every run gets its own bucket. The server must honour `If-None-Match: *` on a presigned PUT.
 */
export async function setupTestStorage(project: TestProject): Promise<void> {
  const settings = process.env.TEST_S3_ENDPOINT ? fromEnvironment() : await startContainer();
  await createBucket(settings);
  project.provide('storage', settings);
}

export async function teardownTestStorage(): Promise<void> {
  await container?.stop();
}

/** The server answers a few seconds after its port opens, so the first attempts may fail. */
async function createBucket(settings: TestStorageSettings): Promise<void> {
  const client = new S3Client({ region: settings.region, endpoint: settings.endpoint, forcePathStyle: true, credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } });
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: settings.bucket }));
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const newBucket = (): string => `test-${randomUUID()}`;

function fromEnvironment(): TestStorageSettings {
  return {
    endpoint: process.env.TEST_S3_ENDPOINT!,
    region: 'us-east-1',
    bucket: newBucket(),
    accessKeyId: process.env.TEST_S3_ACCESS_KEY ?? 'testkey',
    secretAccessKey: process.env.TEST_S3_SECRET_KEY ?? 'testsecret',
  };
}

async function startContainer(): Promise<TestStorageSettings> {
  container = await new GenericContainer(S3_IMAGE)
    .withCommand(['mini', '-dir=/data', `-s3.port=${S3_PORT}`])
    .withEnvironment({ AWS_ACCESS_KEY_ID: S3_CREDENTIALS.accessKeyId, AWS_SECRET_ACCESS_KEY: S3_CREDENTIALS.secretAccessKey })
    .withExposedPorts(S3_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  return { endpoint: `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`, region: 'us-east-1', bucket: newBucket(), ...S3_CREDENTIALS };
}
