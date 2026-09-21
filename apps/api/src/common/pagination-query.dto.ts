import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Opaque cursor from a previous page's `nextCursor` — never constructed by the client. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
