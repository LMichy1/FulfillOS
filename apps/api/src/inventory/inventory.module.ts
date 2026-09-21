import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  // AuthModule for CsrfGuard; OrganizationsModule for MembershipGuard/RolesGuard — reusing
  // Milestone 2's tenancy/CSRF enforcement rather than a parallel mechanism.
  imports: [AuthModule, OrganizationsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
