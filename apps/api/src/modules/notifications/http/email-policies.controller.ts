import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { type EmailPolicyTypeValue, emailPolicyTypeSchema, type NotificationEmailPolicyResponse, type UpdateNotificationEmailPolicy, updateNotificationEmailPolicySchema } from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { EmailPoliciesService } from '../application/email-policies.service.js';

@Controller('settings/notification-emails')
export class EmailPoliciesController {
  constructor(@Inject(EmailPoliciesService) private readonly policies: EmailPoliciesService) {}

  @Get()
  @RequirePermission('update', 'Setting')
  list(@CurrentPrincipal() principal: Principal): Promise<NotificationEmailPolicyResponse[]> {
    return this.policies.list(principal);
  }

  @Put(':type')
  @Audited('tenant.notification_email_policy_updated')
  @RequirePermission('update', 'Setting')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('type', new ZodValidationPipe(emailPolicyTypeSchema)) type: EmailPolicyTypeValue,
    @Body(new ZodValidationPipe(updateNotificationEmailPolicySchema)) body: UpdateNotificationEmailPolicy,
  ): Promise<NotificationEmailPolicyResponse> {
    return this.policies.update(principal, type, body);
  }
}
