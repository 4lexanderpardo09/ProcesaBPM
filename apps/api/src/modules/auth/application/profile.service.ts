import { Inject, Injectable } from '@nestjs/common';
import { type MeResponse, UnauthenticatedError } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ProfileRepository } from '../data/profile.repository.js';

@Injectable()
export class ProfileService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(ProfileRepository) private readonly profiles: ProfileRepository,
  ) {}

  async me(principal: Principal): Promise<MeResponse> {
    const profile = await this.runner.withTenantTransaction((tx) =>
      this.profiles.findProfile(tx, principal.tenantId, principal.userId),
    );
    if (profile === undefined) throw new UnauthenticatedError();
    return profile;
  }
}
