import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  // ReservationsModule for ReservationsService — fulfillment/cancellation are delegated to
  // it, not reimplemented here.
  imports: [AuthModule, OrganizationsModule, ReservationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
