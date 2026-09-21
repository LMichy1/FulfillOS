import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MembershipGuard } from '../organizations/guards/membership.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiCookieAuth('fulfillos.sid')
@Controller('organizations/:organizationId/dashboard')
@UseGuards(MembershipGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Available to any active member (owner or staff) — an operational summary, not a
   * privileged action. */
  @Get('summary')
  @ApiOperation({
    summary:
      'Tenant-scoped operational summary (product/order counts, low-stock count)',
  })
  @ApiOkResponse({
    description: 'Database-aggregated counts for this organization.',
  })
  async getSummary(@Param('organizationId') organizationId: string) {
    const summary = await this.dashboardService.getSummary(organizationId);
    return { summary };
  }
}
