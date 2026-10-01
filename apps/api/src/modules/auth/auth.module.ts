import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitGuard } from '../../common/auth/rate-limit.js';
import { TenantScopeInterceptor } from '../../common/auth/tenant-scope.interceptor.js';
import { Clock } from '../../infrastructure/clock.js';
import { InMemoryRateLimiter, RATE_LIMITER } from '../../infrastructure/security/rate-limiter.js';
import { JwtTokenService } from '../../infrastructure/security/jwt-token-service.js';
import { PasswordHasher } from '../../infrastructure/security/password-hasher.js';
import { InvitationService } from './application/invitation.service.js';
import { LoginService } from './application/login.service.js';
import { OneTimeTokenService } from './application/one-time-token.service.js';
import { PasswordResetService } from './application/password-reset.service.js';
import { ProfileService } from './application/profile.service.js';
import { SessionService } from './application/session.service.js';
import { TenantAccessService } from './application/tenant-access.service.js';
import { TenantSelectionService } from './application/tenant-selection.service.js';
import { CredentialsRepository } from './data/credentials.repository.js';
import { OutboxRepository } from './data/outbox.repository.js';
import { ProfileRepository } from './data/profile.repository.js';
import { SessionRepository } from './data/session.repository.js';
import { TenantAccessRepository } from './data/tenant-access.repository.js';
import { AccessTokenGuard } from './http/access-token.guard.js';
import { AuthController } from './http/auth.controller.js';

/** Registers the global guard: every route of the application requires an access token unless `@Public()`. */
@Module({
  controllers: [AuthController],
  providers: [
    Clock,
    PasswordHasher,
    JwtTokenService,
    { provide: RATE_LIMITER, useClass: InMemoryRateLimiter },
    RateLimitGuard,
    CredentialsRepository,
    SessionRepository,
    TenantAccessRepository,
    ProfileRepository,
    OutboxRepository,
    TenantAccessService,
    SessionService,
    LoginService,
    TenantSelectionService,
    OneTimeTokenService,
    PasswordResetService,
    InvitationService,
    ProfileService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
  ],
})
export class AuthModule {}
