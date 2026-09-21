import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(320) // RFC 5321 max mailbox length
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;

  @IsString()
  @Length(1, 200)
  displayName!: string;

  /** Name of the new organization this registration bootstraps. Registration always creates
   * a new organization — it never joins an existing one (see auth.service.ts). */
  @IsString()
  @Length(1, 200)
  organizationName!: string;
}
