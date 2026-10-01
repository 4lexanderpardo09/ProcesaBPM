import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { SUBJECT_REGISTRY } from '../application/ability.service.js';
import { SubjectRegistry } from '../domain/subject-registry.js';

/**
 * Reports at startup the catalog actions that need a built-in condition and have none registered.
 * Their rules are refused (fail closed) until the owning module registers its subject, so the
 * members of roles that hold them (e.g. `read_created`) see nothing: better noticed here than in production.
 */
@Injectable()
export class ScopedActionsAuditor implements OnApplicationBootstrap {
  constructor(
    @Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    for (const { subject, action } of this.registry.unregisteredScopedActions()) {
      this.logger.warn('Scoped action without a registered built-in condition: its rules are refused', {
        event: 'authorization.scoped_action_unregistered',
        subject,
        action,
      });
    }
  }
}
