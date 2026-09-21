import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { Roles } from '../organizations/decorators/roles.decorator';
import { MembershipGuard } from '../organizations/guards/membership.guard';
import { RolesGuard } from '../organizations/guards/roles.guard';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiCookieAuth('fulfillos.sid')
@Controller('organizations/:organizationId/inventory')
@UseGuards(MembershipGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** Available to any active member (owner or staff) — reading stock levels is routine
   * operational work, not a privileged action. */
  @Get()
  async list(@Param('organizationId') organizationId: string) {
    const inventory = await this.inventoryService.listInventory(organizationId);
    return { inventory };
  }

  /**
   * Restricted to `owner`: an arbitrary on-hand adjustment overrides the system-derived stock
   * count (restock, shrinkage, count correction) and is a higher-trust action than the
   * routine reservation flow — see docs/architecture/inventory.md#tenant-authorization.
   */
  @Post('adjustments')
  @HttpCode(200)
  @UseGuards(RolesGuard, CsrfGuard)
  @Roles('owner')
  async adjust(
    @Param('organizationId') organizationId: string,
    @Body() dto: AdjustInventoryDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const line = await this.inventoryService.adjustStock(
      organizationId,
      dto,
      idempotencyKey,
    );
    return { inventory: line };
  }
}
