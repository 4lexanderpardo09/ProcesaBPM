import { Module } from '@nestjs/common';
import { AuthTokenPurgeJob } from './application/auth-token-purge.job.js';
import { AuthTokenPurgeScheduler } from './application/auth-token-purge.scheduler.js';
import { LoginTokenRepository } from './data/login-token.repository.js';

/** The worker's side of authentication: forgets used login token ids. Imported by the worker only. */
@Module({ providers: [LoginTokenRepository, AuthTokenPurgeJob, AuthTokenPurgeScheduler], exports: [AuthTokenPurgeJob] })
export class AuthMaintenanceModule {}
