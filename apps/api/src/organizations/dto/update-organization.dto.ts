import { IsString, Length } from 'class-validator';

/**
 * Deliberately has no `role` or membership-related field: combined with the global
 * ValidationPipe's `forbidNonWhitelisted: true`, a client that includes one in the request
 * body gets a 400, not a silently-ignored field — there is no way to self-elevate a role
 * through this endpoint.
 */
export class UpdateOrganizationDto {
  @IsString()
  @Length(1, 200)
  name!: string;
}
