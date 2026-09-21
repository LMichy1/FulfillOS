import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { MembershipGuard } from '../organizations/guards/membership.guard';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import type { User } from '../database/schema';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationsService } from './reservations.service';

/**
 * Reservation creation and release are routine operational work, available to any active
 * member (`owner` or `staff`) — unlike inventory adjustments, which are restricted to `owner`
 * (see InventoryController). No `@Roles()` decorator is applied here: MembershipGuard already
 * establishes active membership, and RolesGuard treats a route with no required roles as
 * allowed for any member — see docs/architecture/inventory.md#tenant-authorization.
 */
@Controller('organizations/:organizationId/reservations')
@UseGuards(MembershipGuard, CsrfGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  async create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateReservationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const reservation = await this.reservationsService.createReservation(
      organizationId,
      user.id,
      dto,
      idempotencyKey,
    );
    return { reservation };
  }

  @Post(':id/release')
  async release(
    @Param('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const reservation = await this.reservationsService.releaseReservation(
      organizationId,
      user.id,
      id,
      idempotencyKey,
    );
    return { reservation };
  }
}
