import { Module } from '@nestjs/common';
import { LoginBlockRegistry } from './application/login-block-registry.js';
import { LoginBlockRepository } from './data/login-block.repository.js';

/**
 * The announcements that block signing in. Its own module so that authentication (which enforces them) and the platform
 * console (which invalidates the cache) share one registry without importing the announcement routes.
 */
@Module({ providers: [LoginBlockRepository, LoginBlockRegistry], exports: [LoginBlockRegistry] })
export class LoginBlocksModule {}
