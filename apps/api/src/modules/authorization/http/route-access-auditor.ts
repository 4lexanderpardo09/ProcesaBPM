import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { collectRoutes } from '../../../common/auth/route-metadata.js';

/**
 * At startup, reports the routes that would be refused at runtime: those that declare no access, and
 * those that mix declarations. Conflicts stop the application from starting; undeclared routes stay
 * denied (403) and are logged so they are noticed in development.
 */
@Injectable()
export class RouteAccessAuditor implements OnApplicationBootstrap {
  constructor(
    @Inject(ModulesContainer) private readonly modules: ModulesContainer,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    const routes = collectRoutes(this.modules);
    const conflicts = routes.filter((route) => route.access === 'conflict').map((route) => `${route.method} ${route.path}`);
    if (conflicts.length > 0) throw new Error(`Routes with conflicting access declarations: ${conflicts.join(', ')}`);
    for (const route of routes.filter((candidate) => candidate.access === 'undeclared')) {
      this.logger.warn('Route without a declared permission: it answers 403', { event: 'authorization.undeclared_route', route: `${route.method} ${route.path}` });
    }
  }
}
