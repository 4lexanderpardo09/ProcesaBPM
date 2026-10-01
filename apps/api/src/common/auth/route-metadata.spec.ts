import { describe, expect, it } from 'vitest';
import { accessMetadataOf, classifyAccess } from './route-metadata.js';
import { Public } from './public.decorator.js';
import { AuthenticatedOnly, RequireAnyPermission, RequirePermission } from './route-access.js';

const requirement = { actions: ['read'], subject: 'Company' };

describe('classifyAccess', () => {
  it.each([
    ['nothing declared', { isPublic: false, authenticatedOnly: false, requirement: undefined }, 'undeclared'],
    ['public', { isPublic: true, authenticatedOnly: false, requirement: undefined }, 'public'],
    ['authenticated only', { isPublic: false, authenticatedOnly: true, requirement: undefined }, 'authenticated-only'],
    ['a permission', { isPublic: false, authenticatedOnly: false, requirement }, 'permission'],
    ['public and a permission', { isPublic: true, authenticatedOnly: false, requirement }, 'conflict'],
    ['public and authenticated only', { isPublic: true, authenticatedOnly: true, requirement: undefined }, 'conflict'],
    ['authenticated only and a permission', { isPublic: false, authenticatedOnly: true, requirement }, 'conflict'],
  ] as const)('%s → %s', (_label, metadata, expected) => {
    expect(classifyAccess(metadata)).toBe(expected);
  });
});

describe('accessMetadataOf', () => {
  @Public()
  class OpenController {
    @RequirePermission('update', 'Company')
    guarded(): void {}
    plain(): void {}
  }

  @RequirePermission('read', 'Company')
  class GuardedController {
    @RequireAnyPermission(['read_own', 'read_all'], 'Ticket')
    override(): void {}
    inherits(): void {}
    @AuthenticatedOnly()
    profile(): void {}
  }

  const metadata = (controller: new () => object, method: string) =>
    accessMetadataOf(controller, (controller.prototype as Record<string, object>)[method]!);

  it('a class-level @Public together with a method-level permission is a conflict, not a public route', () => {
    expect(classifyAccess(metadata(OpenController, 'guarded'))).toBe('conflict');
  });

  it('a class-level @Public makes the other methods public', () => {
    expect(classifyAccess(metadata(OpenController, 'plain'))).toBe('public');
  });

  it('a class-level permission is inherited by the methods', () => {
    expect(metadata(GuardedController, 'inherits').requirement).toEqual({ actions: ['read'], subject: 'Company' });
  });

  it('a method-level permission replaces the one of the class', () => {
    expect(metadata(GuardedController, 'override').requirement).toEqual({ actions: ['read_own', 'read_all'], subject: 'Ticket' });
  });

  it('@AuthenticatedOnly on a method of a class that requires a permission is a conflict', () => {
    expect(classifyAccess(metadata(GuardedController, 'profile'))).toBe('conflict');
  });
});
