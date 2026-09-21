import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '../database/database.module';
import {
  organizations,
  memberships,
  type Organization,
  type Membership,
} from '../database/schema';

export interface MembershipWithOrganization {
  membership: Membership;
  organization: Organization;
}

@Injectable()
export class OrganizationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every organization the given user has an active membership in. This is the only
   * source of truth for "which organizations can this user see" — never a client-supplied
   * list. */
  async listForUser(userId: string): Promise<MembershipWithOrganization[]> {
    const rows = await this.db
      .select({ membership: memberships, organization: organizations })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .where(eq(memberships.userId, userId));
    return rows;
  }

  /** Returns the caller's membership in a specific organization, or null if either the
   * organization doesn't exist or the caller isn't a member of it — callers must not
   * distinguish these two cases in their response (see MembershipGuard). */
  async getMembership(
    userId: string,
    organizationId: string,
  ): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
        ),
      );
    return row ?? null;
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    return row ?? null;
  }

  async renameOrganization(
    organizationId: string,
    name: string,
  ): Promise<Organization> {
    const [row] = await this.db
      .update(organizations)
      .set({ name, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId))
      .returning();
    return row;
  }
}
