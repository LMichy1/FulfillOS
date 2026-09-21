import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import type { User } from '../database/schema';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Roles } from './decorators/roles.decorator';
import {
  MembershipGuard,
  type MembershipRequest,
} from './guards/membership.guard';
import { RolesGuard } from './guards/roles.guard';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiCookieAuth('fulfillos.sid')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /** Organizations the caller actually belongs to — derived from their own memberships,
   * never from a client-supplied list. */
  @Get()
  async list(@CurrentUser() user: User) {
    const memberships = await this.organizationsService.listForUser(user.id);
    return {
      organizations: memberships.map(({ membership, organization }) => ({
        id: organization.id,
        name: organization.name,
        role: membership.role,
      })),
    };
  }

  @Get(':organizationId')
  @UseGuards(MembershipGuard)
  async getOne(
    @Param('organizationId') organizationId: string,
    @Req() req: MembershipRequest,
  ) {
    const organization =
      await this.organizationsService.getOrganization(organizationId);
    // MembershipGuard already confirmed the membership row exists, which itself guarantees
    // the organization row exists (a foreign key requires it) — this is defensive, not a
    // second authorization check.
    if (!organization) {
      throw new Error(
        'Invariant violated: membership exists without its organization.',
      );
    }
    return { organization, role: req.membership.role };
  }

  @Patch(':organizationId')
  @UseGuards(MembershipGuard, RolesGuard, CsrfGuard)
  @Roles('owner')
  async rename(
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    const organization = await this.organizationsService.renameOrganization(
      organizationId,
      dto.name,
    );
    return { organization };
  }
}
