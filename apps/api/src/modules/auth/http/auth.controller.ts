import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  acceptInvitationRequestSchema,
  type AccessTokenResponse,
  type LoginRequest,
  type LoginResponse,
  loginRequestSchema,
  type MeResponse,
  type PasswordResetConfirm,
  passwordResetConfirmSchema,
  type PasswordResetRequest,
  passwordResetRequestSchema,
  type SelectTenantRequest,
  changePasswordRequestSchema,
  mfaCodeSchema,
  mfaFactorSchema,
  type MfaCode,
  type MfaEnrollment,
  type MfaEnrollmentConfirmedResponse,
  type MfaFactor,
  type MfaLoginResponse,
  type ChangePasswordRequest,
  selectTenantRequestSchema,
  setSignatureRequestSchema,
  type SetSignatureRequest,
  type SignatureResponse,
  type UpdateProfileRequest,
  updateProfileRequestSchema,
  UnauthenticatedError,
} from '@procesabpm/shared';
import type { Request, Response } from 'express';
import { CurrentPlatformPrincipal, CurrentPrincipal, type PlatformPrincipal, type Principal } from '../../../common/auth/principal.js';
import { Public } from '../../../common/auth/public.decorator.js';
import { RateLimit, RateLimitGuard } from '../../../common/auth/rate-limit.js';
import { AuthenticatedOnly, PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { AvailableDuringDeletion } from '../../../common/auth/available-during-deletion.decorator.js';
import { BackgroundTasks } from '../../../common/background/background-tasks.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { InvitationService } from '../application/invitation.service.js';
import { LoginService } from '../application/login.service.js';
import { PlatformSessionService } from '../application/platform-session.service.js';
import { PasswordResetService } from '../application/password-reset.service.js';
import { ProfileService } from '../application/profile.service.js';
import { type ClientInfo, type OpenedSession, SessionService } from '../application/session.service.js';
import { MfaLoginService } from '../application/mfa-login.service.js';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { ChangePasswordService } from '../application/change-password.service.js';
import { TenantSelectionService } from '../application/tenant-selection.service.js';
import { RATE_LIMITS } from '../domain/auth-policy.js';
import { bearerToken } from '../../../common/auth/bearer-token.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';

const USER_AGENT_MAX_LENGTH = 512;

function clientOf(request: Request): ClientInfo {
  return { ipAddress: request.ip ?? null, userAgent: request.header('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null };
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(LoginService) private readonly login: LoginService,
    @Inject(TenantSelectionService) private readonly tenantSelection: TenantSelectionService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordResetService) private readonly passwordReset: PasswordResetService,
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(MfaLoginService) private readonly mfaLogin: MfaLoginService,
    @Inject(ChangePasswordService) private readonly passwordChange: ChangePasswordService,
    @Inject(BackgroundTasks) private readonly background: BackgroundTasks,
    @Inject(PlatformSessionService) private readonly platformSessions: PlatformSessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.login)
  @UseGuards(RateLimitGuard)
  logIn(@Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest): Promise<LoginResponse> {
    return this.login.login(body);
  }

  /** With the challenge token the login returned (`Authorization: Bearer`): a right code completes the sign-in. */
  @Public()
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.mfaLogin)
  @UseGuards(RateLimitGuard)
  verifyMfa(@Req() request: Request, @Body(new ZodValidationPipe(mfaFactorSchema)) body: MfaFactor): Promise<MfaLoginResponse> {
    return this.mfaLogin.verify(this.challengeOf(request), body);
  }

  /** The account must enroll: a new secret for the authenticator app (QR data and the key to type). */
  @Public()
  @Post('login/mfa/enrollment')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.mfaLogin)
  @UseGuards(RateLimitGuard)
  beginMfaEnrollment(@Req() request: Request): Promise<MfaEnrollment> {
    return this.mfaLogin.beginEnrollment(this.challengeOf(request));
  }

  /** The first code from the app: MFA is on, the backup codes come back once, and the sign-in completes. */
  @Public()
  @Post('login/mfa/enrollment/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.mfaLogin)
  @UseGuards(RateLimitGuard)
  confirmMfaEnrollment(@Req() request: Request, @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCode): Promise<MfaEnrollmentConfirmedResponse> {
    return this.mfaLogin.confirmEnrollment(this.challengeOf(request), body.code);
  }

  /** Authenticated with the selection token returned by the login (`Authorization: Bearer`). */
  @Public()
  @Post('select-tenant')
  @RateLimit(RATE_LIMITS.selectTenant)
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async selectTenant(
    @Body(new ZodValidationPipe(selectTenantRequestSchema)) body: SelectTenantRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const selectionToken = bearerToken(request.header('authorization'));
    if (selectionToken === undefined) throw new UnauthenticatedError();
    const session = await this.tenantSelection.select(selectionToken, body.tenantId, clientOf(request));
    return this.deliver(session, response);
  }

  /**
   * A platform administrator opens a platform session with the selection token of the login. The access
   * token is short, has its own audience and no refresh token or cookie: after it, they log in again.
   */
  @Public()
  @Post('platform/select')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.platformSelect)
  @UseGuards(RateLimitGuard)
  async selectPlatform(@Req() request: Request): Promise<AccessTokenResponse> {
    const selectionToken = bearerToken(request.header('authorization'));
    if (selectionToken === undefined) throw new UnauthenticatedError();
    const issued = await this.platformSessions.open(selectionToken, clientOf(request));
    return { accessToken: issued.token, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }

  @PlatformAdminOnly()
  @Post('platform/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutPlatform(@CurrentPlatformPrincipal() principal: PlatformPrincipal): Promise<void> {
    await this.platformSessions.close(principal.userId, principal.sessionId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AccessTokenResponse> {
    try {
      return this.deliver(await this.sessions.refresh(readRefreshCookie(request), clientOf(request)), response);
    } catch (error) {
      // A suspended tenant (403) or a maintenance block (503) keeps the session: it works again afterwards.
      if (error instanceof UnauthenticatedError) clearRefreshCookie(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.logout(readRefreshCookie(request));
    clearRefreshCookie(response);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(RATE_LIMITS.passwordReset)
  @UseGuards(RateLimitGuard)
  /** Answers at once and does the work afterwards, so the response time does not reveal whether the account exists. */
  requestPasswordReset(@Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequest): void {
    this.background.run('auth.password_reset_request', () => this.passwordReset.request(body.email));
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(RATE_LIMITS.passwordResetConfirm)
  @UseGuards(RateLimitGuard)
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirm,
  ): Promise<void> {
    await this.passwordReset.confirm(body.token, body.newPassword);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.invitation)
  @UseGuards(RateLimitGuard)
  acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
  ): Promise<AcceptInvitationResponse> {
    return this.invitations.accept(body.token, body.password);
  }

  /** Any signed-in member may change their own password: no permission of the catalog applies. */
  @AuthenticatedOnly()
  @Post('password')
  @Audited('account.password_changed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(RATE_LIMITS.passwordChange)
  @UseGuards(RateLimitGuard)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.passwordChange.change(principal, body);
  }

  /**
   * Any signed-in member may read their own profile: no permission of the catalog applies. Also during the deletion
   * period, so the application knows to offer only the data export (`tenantMode`).
   */
  @AuthenticatedOnly()
  @AvailableDuringDeletion()
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.profiles.me(principal);
  }

  /** Edits the caller's own name, language and time zone; the e-mail has its own confirmation flow. */
  @AuthenticatedOnly()
  @Patch('me')
  @Audited('account.profile_updated')
  updateMe(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequest): Promise<MeResponse> {
    return this.profiles.update(principal, body);
  }

  /** A short-lived signed URL to the caller's own signature image, or null when there is none. */
  @AuthenticatedOnly()
  @Get('me/signature')
  signature(@CurrentPrincipal() principal: Principal): Promise<SignatureResponse | null> {
    return this.profiles.signatureUrl(principal);
  }

  /** Links one of the caller's own confirmed images (uploaded and confirmed first) as their signature. */
  @AuthenticatedOnly()
  @Put('me/signature')
  @HttpCode(HttpStatus.NO_CONTENT)
  setSignature(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(setSignatureRequestSchema)) body: SetSignatureRequest): Promise<void> {
    return this.profiles.setSignature(principal, body);
  }

  @AuthenticatedOnly()
  @Delete('me/signature')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearSignature(@CurrentPrincipal() principal: Principal): Promise<void> {
    return this.profiles.clearSignature(principal);
  }

  private challengeOf(request: Request): string {
    const token = bearerToken(request.header('authorization'));
    if (token === undefined) throw new UnauthenticatedError();
    return token;
  }

  private deliver(session: OpenedSession, response: Response): AccessTokenResponse {
    setRefreshCookie(response, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken.token, tokenType: 'Bearer', expiresIn: session.accessToken.expiresIn };
  }
}
