import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReservationsModule } from './reservations/reservations.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    OrganizationsModule,
    InventoryModule,
    ReservationsModule,
    ProductsModule,
    OrdersModule,
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule {}
