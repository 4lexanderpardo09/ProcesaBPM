import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import {
  type BackupCodesResponse,
  disableMfaRequestSchema,
  type DisableMfaRequest,
  mfaCodeSchema,
  mfaEnrollmentConfirmRequestSchema,
  type MfaEnrollmentConfirmRequest,
  type MfaCode,
  type MfaEnrollment,
  type MfaStatusResponse,
} from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RateLimit, RateLimitGuard } from '../../../common/auth/rate-limit.js';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { MfaAccountService } from '../application/mfa-account.service.js';
import { RATE_LIMITS } from '../domain/auth-policy.js';

/** Any signed-in member manages their own second factor: no permission of the catalog applies. */
@AuthenticatedOnly()
@Controller('auth/mfa')
export class MfaController {
  constructor(@Inject(MfaAccountService) private readonly account: MfaAccountService) {}

  @Get()
  status(@CurrentPrincipal() principal: Principal): Promise<MfaStatusResponse> {
    return this.account.status(principal);
  }

  @Post('enrollment')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.mfaAccount)
  @UseGuards(RateLimitGuard)
  beginEnrollment(@CurrentPrincipal() principal: Principal): Promise<MfaEnrollment> {
    return this.account.beginEnrollment(principal);
  }

  @Post('enrollment/confirm')
  @Audited('account.mfa_enabled')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.mfaAccount)
  @UseGuards(RateLimitGuard)
  confirmEnrollment(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(mfaEnrollmentConfirmRequestSchema)) body: MfaEnrollmentConfirmRequest): Promise<BackupCodesResponse> {
    return this.account.confirmEnrollment(principal, body.code, body.currentPassword);
  }

  @Post('disable')
  @Audited('account.mfa_disabled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(RATE_LIMITS.mfaAccount)
  @UseGuards(RateLimitGuard)
  async disable(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(disableMfaRequestSchema)) body: DisableMfaRequest): Promise<void> {
    await this.account.disable(principal, body);
  }

  @Post('backup-codes')
  @Audited('account.mfa_backup_codes_regenerated')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.mfaAccount)
  @UseGuards(RateLimitGuard)
  regenerateBackupCodes(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCode): Promise<BackupCodesResponse> {
    return this.account.regenerateBackupCodes(principal, body.code);
  }
}
