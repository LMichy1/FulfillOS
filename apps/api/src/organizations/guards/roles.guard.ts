import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '../../database/schema';
import type { MembershipRequest } from './membership.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Must run after MembershipGuard (so `request.membership` is populated). Deny-by-default: a
 * route with no @Roles() decorator is allowed for any active member; a route with @Roles(...)
 * requires the caller's membership role to be one of the listed ones. The role checked is
 * always the one just re-established by MembershipGuard from the database for this specific
 * request — never anything cached from the session or supplied by the client.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      MembershipRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<MembershipRequest>();
    if (!requiredRoles.includes(request.membership.role)) {
      throw new ForbiddenException('Your role does not permit this action.');
    }

    return true;
  }
}
