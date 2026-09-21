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
})
export class OrganizationsModule {}
