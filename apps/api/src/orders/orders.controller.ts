import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { MembershipGuard } from '../organizations/guards/membership.guard';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import type { User } from '../database/schema';
import { OrdersService } from './orders.service';

/**
 * `CsrfGuard` is applied at the class level even though this controller has read routes:
 * `CsrfGuard` itself no-ops for safe methods (GET/HEAD/OPTIONS — see auth/guards/csrf.guard.ts),
 * so this is equivalent to applying it only to the mutating routes but with one guard list to
 * maintain. Fulfillment and cancellation are available to both `owner` and `staff` — the same
 * permission level as reservation creation/release, since fulfilling or cancelling an order is
 * routine operational work, not a catalog- or pricing-defining action (contrast
 * ProductsController.create and InventoryController.adjust, both `owner`-only).
 */
@ApiTags('orders')
@ApiCookieAuth('fulfillos.sid')
@Controller('organizations/:organizationId/orders')
@UseGuards(MembershipGuard, CsrfGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List the organization’s orders (paginated)' })
  @ApiOkResponse({
    description:
      'A page of orders, newest first, with an opaque next-page cursor.',
  })
  async list(
    @Param('organizationId') organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.ordersService.listOrders(organizationId, query);
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Get a single order, including its line items and status',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ description: 'The order and its order_items.' })
  async getOne(
    @Param('organizationId') organizationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const order = await this.ordersService.getOrder(organizationId, orderId);
    return { order };
  }

  @Post(':orderId/fulfill')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Fulfill a pending order: consumes the reservation, decreasing on_hand and reserved',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'See docs/architecture/order-lifecycle.md#idempotency.',
  })
  @ApiOkResponse({ description: 'The now-fulfilled order.' })
  async fulfill(
    @Param('organizationId') organizationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: User,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const order = await this.ordersService.fulfillOrder(
      organizationId,
      user.id,
      orderId,
      idempotencyKey,
    );
    return { order };
  }

  /**
   * Delegates to the exact same `ReservationsService.releaseReservation` that
   * `POST /reservations/:id/release` uses — deliberately not a second cancellation
   * implementation. See docs/architecture/order-lifecycle.md#fulfillment-vs-cancellation.
   */
  @Post(':orderId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a pending order, releasing its reservation',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'See docs/architecture/order-lifecycle.md#idempotency.',
  })
  @ApiOkResponse({ description: 'The now-cancelled order.' })
  async cancel(
    @Param('organizationId') organizationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: User,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const order = await this.ordersService.cancelOrder(
      organizationId,
      user.id,
      orderId,
      idempotencyKey,
    );
    return { order };
  }
}
