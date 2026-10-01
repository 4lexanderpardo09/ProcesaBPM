import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/tokens.js';
import type { AppConfig } from '../../config/app-config.js';
import { ObjectStorage } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

@Global()
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStorage =>
        new S3ObjectStorage({
          endpoint: config.STORAGE_ENDPOINT,
          publicEndpoint: config.STORAGE_PUBLIC_ENDPOINT,
          region: config.STORAGE_REGION,
          bucket: config.STORAGE_BUCKET,
          accessKeyId: config.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
          forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
        }),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
