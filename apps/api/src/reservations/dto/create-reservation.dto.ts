import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PG_INT4_MAX } from '../../common/postgres-int.util';

export class ReservationItemDto {
  @IsUUID()
  productId!: string;

  /** Quantity to reserve. Always at least 1 — there is no such thing as reserving zero or a
   * negative quantity of a product. */
  @IsInt()
  @Min(1)
  @Max(PG_INT4_MAX)
  quantity!: number;
}

/**
 * Deliberately has no `unitPriceCents` field: the price snapshot stored on each order item
 * always comes from the product's current price at reservation time, read server-side inside
 * the same transaction that locks inventory — never a client-supplied value.
 */
export class CreateReservationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReservationItemDto)
  items!: ReservationItemDto[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
