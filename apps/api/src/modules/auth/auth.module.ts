import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitGuard } from '../../common/auth/rate-limit.js';
import { TenantScopeInterceptor } from '../../common/auth/tenant-scope.interceptor.js';
import { InMemoryRateLimiter, RATE_LIMITER } from '../../infrastructure/security/rate-limiter.js';
import { JwtTokenService } from '../../infrastructure/security/jwt-token-service.js';
import { MfaSecretCipher } from '../../infrastructure/security/mfa-secret-cipher.js';
import { PasswordHasher } from '../../infrastructure/security/password-hasher.js';
import { ChangePasswordService } from './application/change-password.service.js';
import { CurrentPasswordVerifier } from './application/current-password-verifier.js';
import { MfaAccountService } from './application/mfa-account.service.js';
import { TenantSecurityService } from './application/tenant-security.service.js';
import { TenantSecurityRepository } from './data/tenant-security.repository.js';
import { MfaEnrollmentService } from './application/mfa-enrollment.service.js';
import { MfaFactorVerifier } from './application/mfa-factor-verifier.js';
import { MfaLoginService } from './application/mfa-login.service.js';
import { SelectionIssuer } from './application/selection-issuer.js';
import { MfaRepository } from './data/mfa.repository.js';
import { InvitationService } from './application/invitation.service.js';
import { LoginService } from './application/login.service.js';
import { OneTimeTokenService } from './application/one-time-token.service.js';
import { PasswordResetService } from './application/password-reset.service.js';
import { PlatformSessionService } from './application/platform-session.service.js';
import { ProfileService } from './application/profile.service.js';
import { SessionService } from './application/session.service.js';
import { TenantAccessService } from './application/tenant-access.service.js';
import { TenantSelectionService } from './application/tenant-selection.service.js';
import { CredentialsRepository } from './data/credentials.repository.js';
import { LoginTokenRepository } from './data/login-token.repository.js';
import { PlatformAccessRepository } from './data/platform-access.repository.js';
import { PlatformOutboxRepository } from '../../infrastructure/outbox/platform-outbox.repository.js';
import { ProfileRepository } from './data/profile.repository.js';
import { SessionRepository } from './data/session.repository.js';
import { TenantAccessRepository } from './data/tenant-access.repository.js';
import { AccessTokenGuard } from './http/access-token.guard.js';
import { TenantSecurityController } from './http/tenant-security.controller.js';
import { MfaController } from './http/mfa.controller.js';
import { AuthController } from './http/auth.controller.js';

/**
 * Authentication. The global guard that applies it (together with the permission check) is registered
 * by the authorization module, which orders the two.
 */
@Module({
  controllers: [AuthController, MfaController, TenantSecurityController],
  providers: [
    PasswordHasher,
    MfaSecretCipher,
    JwtTokenService,
    { provide: RATE_LIMITER, useClass: InMemoryRateLimiter },
    RateLimitGuard,
    CredentialsRepository,
    SessionRepository,
    LoginTokenRepository,
    TenantAccessRepository,
    ProfileRepository,
    PlatformOutboxRepository,
    PlatformAccessRepository,
    PlatformSessionService,
    TenantAccessService,
    SessionService,
    LoginService,
    TenantSelectionService,
    OneTimeTokenService,
    PasswordResetService,
    InvitationService,
    ProfileService,
    ChangePasswordService,
    SelectionIssuer,
    MfaFactorVerifier,
    MfaEnrollmentService,
    MfaLoginService,
    MfaAccountService,
    TenantSecurityService,
    TenantSecurityRepository,
    CurrentPasswordVerifier,
    MfaRepository,
    AccessTokenGuard,
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
  ],
  exports: [AccessTokenGuard],
})
export class AuthModule {}
