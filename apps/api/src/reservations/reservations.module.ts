import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  // Exported so OrdersModule can delegate fulfillment/cancellation to the same service and
  // methods this module's own routes use — see docs/architecture/order-lifecycle.md for why
  // there is deliberately no second implementation of either transition.
  exports: [ReservationsService],
})
export class ReservationsModule {}
