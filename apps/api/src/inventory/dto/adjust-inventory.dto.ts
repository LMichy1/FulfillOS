import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { PG_INT4_MAX, PG_INT4_MIN } from '../../common/postgres-int.util';

/**
 * A signed change to `on_hand` (restock, count correction, shrinkage) — never a client-supplied
 * absolute stock or "available" value. `reason` is required so every adjustment's movement
 * record is explainable (see docs/architecture/inventory.md#data-model).
 */
export class AdjustInventoryDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(PG_INT4_MIN)
  @Max(PG_INT4_MAX)
  @NotEquals(0)
  delta!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
