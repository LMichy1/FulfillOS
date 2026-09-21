import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PG_INT4_MAX } from '../../common/postgres-int.util';

/**
 * Deliberately has no `available`/`reserved` field: initial inventory is always created with
 * `reserved = 0` — a brand-new product cannot already have reservations against it. `sku` is
 * validated for shape only here; organization-scoped uniqueness (case/whitespace-insensitive)
 * is enforced by the existing `products_org_sku_normalized_key` database constraint.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'WIDGET-1', maxLength: 64 })
  @IsString()
  @Length(1, 64)
  sku!: string;

  @ApiProperty({ example: 'Widget', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 500, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(PG_INT4_MAX)
  unitPriceCents!: number;

  @ApiPropertyOptional({
    description:
      'Initial on-hand quantity, established atomically with the product itself. Defaults ' +
      'to 0 (a product can be created before any stock physically arrives).',
    example: 20,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PG_INT4_MAX)
  initialOnHand?: number;
}
