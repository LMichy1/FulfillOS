import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { MembershipGuard } from './guards/membership.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  // AuthModule is imported for CsrfGuard/SessionService — the rename endpoint below reuses
  // the same CSRF enforcement as auth's own mutating routes rather than a second mechanism.
  imports: [AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, MembershipGuard, RolesGuard],
  // Exported so other feature modules (inventory, reservations) can reuse the same
  // membership/role enforcement on their own organization-scoped routes instead of
  // re-implementing tenancy checks.
  exports: [OrganizationsService, MembershipGuard, RolesGuard],
})
export class OrganizationsModule {}
