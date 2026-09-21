import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../database/schema';
import type { AuthenticatedRequest } from '../../auth/guards/session-auth.guard';
import { OrganizationsService } from '../organizations.service';

export interface MembershipRequest extends AuthenticatedRequest {
  membership: Membership;
}

/**
 * Establishes that the caller has an active membership in the organization named by the
 * `:organizationId` route param — runs after SessionAuthGuard (global), so
 * `request.authUser` is already populated.
 *
 * A request must independently establish: valid session (SessionAuthGuard) -> the target
 * organization exists -> the caller has an active membership in it. The organization id in
 * the URL is never trusted by itself — it only becomes meaningful once this guard confirms a
 * membership row exists for (this user, this org).
 *
 * "Organization doesn't exist" and "organization exists but you're not a member of it" both
 * produce the same 404 — distinguishing them would let a caller enumerate which organization
 * ids exist by probing this endpoint.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(private readonly organizationsService: OrganizationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.params.organizationId;
    if (typeof organizationId !== 'string') {
      throw new BadRequestException(
        'organizationId route parameter is required.',
      );
    }

    const membership = await this.organizationsService.getMembership(
      request.authUser.id,
      organizationId,
    );

    if (!membership) {
      throw new NotFoundException('Organization not found.');
    }

    (request as MembershipRequest).membership = membership;
    return true;
  }
}
