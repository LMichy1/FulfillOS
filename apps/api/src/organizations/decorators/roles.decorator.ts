import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '../../database/schema';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to callers whose membership role (established by MembershipGuard, which
 * must run first) is in the given list. See docs/architecture/authentication.md for the full
 * permission matrix — this is intentionally the only place role names are spelled out in
 * route decorators, so the matrix in the docs stays the single source of truth to check
 * against.
 */
export const Roles = (...roles: MembershipRole[]) =>
  SetMetadata(ROLES_KEY, roles);
