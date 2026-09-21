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
  @IsString()
  @Length(1, 64)
  sku!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsInt()
  @Min(0)
  @Max(PG_INT4_MAX)
  unitPriceCents!: number;

  /** Initial on-hand quantity, established atomically with the product itself. Defaults to 0
   * (a product can be created before any stock physically arrives). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PG_INT4_MAX)
  initialOnHand?: number;
}
