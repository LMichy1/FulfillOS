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

// Loose (any-version) UUID format check. Guards run before Nest's parameter-binding pipes
// (e.g. ParseUUIDPipe), so a malformed id must be rejected here — otherwise it reaches
// Postgres as a raw query parameter for a uuid column and Postgres itself throws an
// invalid_text_representation error, which is a client input mistake, not a server fault, and
// should never surface as a 500.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (
      typeof organizationId !== 'string' ||
      !UUID_PATTERN.test(organizationId)
    ) {
      throw new BadRequestException(
        'organizationId route parameter must be a valid UUID.',
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
