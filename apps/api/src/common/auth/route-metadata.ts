import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import type { ModulesContainer } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { AUTHENTICATED_ONLY_KEY, PLATFORM_ADMIN_ONLY_KEY, type PermissionRequirement, REQUIRED_PERMISSIONS_KEY } from './route-access.js';

export type RouteAccess = 'public' | 'authenticated-only' | 'platform' | 'permission' | 'undeclared' | 'conflict';

export interface RouteInfo {
  readonly method: string;
  readonly path: string;
  readonly access: RouteAccess;
  readonly requirement: PermissionRequirement | undefined;
}

export interface AccessMetadata {
  readonly isPublic: boolean;
  readonly authenticatedOnly: boolean;
  readonly platformOnly: boolean;
  readonly requirement: PermissionRequirement | undefined;
}

export function classifyAccess({ isPublic, authenticatedOnly, platformOnly, requirement }: AccessMetadata): RouteAccess {
  const declared = [isPublic, authenticatedOnly, platformOnly, requirement !== undefined].filter(Boolean).length;
  if (declared > 1) return 'conflict';
  if (isPublic) return 'public';
  if (authenticatedOnly) return 'authenticated-only';
  if (platformOnly) return 'platform';
  return requirement === undefined ? 'undeclared' : 'permission';
}

const normalize = (...parts: unknown[]) =>
  `/${parts.flatMap((part) => (typeof part === 'string' ? part.split('/') : [])).filter(Boolean).join('/')}`;

/**
 * Reads the access declaration of every route from the Nest metadata. `@Public`, `@AuthenticatedOnly`,
 * `@PlatformAdminOnly` and a permission requirement are mutually exclusive, whether they sit on the method or on the
 * class: mixing them is a conflict, never a silent choice (a class-level `@Public` must not
 * override a method-level permission). A requirement on the method replaces the one of the class.
 */
export function collectRoutes(modules: ModulesContainer): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (controller === null) continue;
      const prefix: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler: unknown = controller.prototype[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (path === undefined || typeof method !== 'number') continue;
        const metadata = accessMetadataOf(controller, handler);
        routes.push({
          method: RequestMethod[method]!,
          path: normalize(prefix, path),
          access: classifyAccess(metadata),
          requirement: metadata.requirement,
        });
      }
    }
  }
  return routes;
}

/** Access declarations of a route handler and its controller class. */
export function accessMetadataOf(controller: object, handler: object): AccessMetadata {
  const read = <T>(key: string): [T | undefined, T | undefined] => [
    Reflect.getMetadata(key, handler) as T | undefined,
    Reflect.getMetadata(key, controller) as T | undefined,
  ];
  const [publicOnMethod, publicOnClass] = read<boolean>(IS_PUBLIC_KEY);
  const [onlyOnMethod, onlyOnClass] = read<boolean>(AUTHENTICATED_ONLY_KEY);
  const [platformOnMethod, platformOnClass] = read<boolean>(PLATFORM_ADMIN_ONLY_KEY);
  const [requirementOnMethod, requirementOnClass] = read<PermissionRequirement>(REQUIRED_PERMISSIONS_KEY);
  return {
    isPublic: publicOnMethod === true || publicOnClass === true,
    authenticatedOnly: onlyOnMethod === true || onlyOnClass === true,
    platformOnly: platformOnMethod === true || platformOnClass === true,
    requirement: requirementOnMethod ?? requirementOnClass,
  };
}
