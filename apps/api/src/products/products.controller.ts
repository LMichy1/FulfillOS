import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { Roles } from '../organizations/decorators/roles.decorator';
import { MembershipGuard } from '../organizations/guards/membership.guard';
import { RolesGuard } from '../organizations/guards/roles.guard';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsService } from './products.service';

@Controller('organizations/:organizationId/products')
@UseGuards(MembershipGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /** Available to any active member (owner or staff) — reading the catalog is routine. */
  @Get()
  async list(
    @Param('organizationId') organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.productsService.listProducts(organizationId, query);
  }

  @Get(':productId')
  async getOne(
    @Param('organizationId') organizationId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const product = await this.productsService.getProduct(
      organizationId,
      productId,
    );
    return { product };
  }

  /**
   * Restricted to `owner`: defining catalog data and pricing is a higher-trust action than
   * the day-to-day reservation/fulfillment flow — see
   * docs/architecture/order-lifecycle.md#security-and-tenant-isolation.
   */
  @Post()
  @UseGuards(RolesGuard, CsrfGuard)
  @Roles('owner')
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateProductDto,
  ) {
    const product = await this.productsService.createProduct(
      organizationId,
      dto,
    );
    return { product };
  }
}
