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
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { Roles } from '../organizations/decorators/roles.decorator';
import { MembershipGuard } from '../organizations/guards/membership.guard';
import { RolesGuard } from '../organizations/guards/roles.guard';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiCookieAuth('fulfillos.sid')
@Controller('organizations/:organizationId/products')
@UseGuards(MembershipGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /** Available to any active member (owner or staff) — reading the catalog is routine. */
  @Get()
  @ApiOperation({ summary: 'List the organization’s products (paginated)' })
  @ApiOkResponse({
    description:
      'A page of products, newest first, with an opaque next-page cursor.',
  })
  async list(
    @Param('organizationId') organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.productsService.listProducts(organizationId, query);
  }

  @Get(':productId')
  @ApiOperation({
    summary: 'Get a single product, including current inventory',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    description: 'The product and its current on_hand/reserved/available.',
  })
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
  @ApiOperation({
    summary:
      'Create a product and initialize its inventory atomically (owner only)',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({
    description: 'The created product, including its initial inventory.',
  })
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
