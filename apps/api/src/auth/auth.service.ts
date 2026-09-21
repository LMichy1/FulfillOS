import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '../database/database.module';
import {
  users,
  organizations,
  memberships,
  type User,
} from '../database/schema';
import { PasswordService } from './password.service';
import { SessionService, type CreatedSession } from './session.service';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from '../common/pg-error.util';
import { omitPasswordHash } from '../common/user.util';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

export interface RegisteredIdentity {
  user: Omit<User, 'passwordHash'>;
  organizationId: string;
}

const GENERIC_INVALID_CREDENTIALS = 'Invalid email or password.';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Registration bootstrap: creates a new user, a brand-new organization, and an owner
   * membership tying them together, all in one transaction. The caller can never join an
   * existing organization this way and can never choose their own role — both are enforced
   * here, not left to the client.
   */
  async register(dto: RegisterDto): Promise<RegisteredIdentity> {
    const passwordHash = await this.passwordService.hash(dto.password);

    try {
      return await this.db.transaction(async (tx) => {
        const [organization] = await tx
          .insert(organizations)
          .values({ name: dto.organizationName })
          .returning();

        const [user] = await tx
          .insert(users)
          .values({
            email: dto.email,
            displayName: dto.displayName,
            passwordHash,
          })
          .returning();

        await tx.insert(memberships).values({
          organizationId: organization.id,
          userId: user.id,
          role: 'owner',
        });

        return {
          user: omitPasswordHash(user),
          organizationId: organization.id,
        };
      });
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  }

  /**
   * Verifies credentials and, on success, issues a brand-new session. Never reuses any
   * pre-authentication identifier (there isn't one — unauthenticated requests carry no
   * session cookie at all in this design), which is what rules out session fixation here.
   *
   * Unknown account and wrong password both produce the exact same error, at as close to the
   * same cost as practical, so a caller can't distinguish "no such account" from "wrong
   * password" by response content. (Timing-based account enumeration via response latency is
   * a known residual risk of any password-hashing scheme and is not fully eliminated here —
   * see docs/architecture/authentication.md.)
   */
  async login(
    dto: LoginDto,
  ): Promise<{ user: Omit<User, 'passwordHash'>; session: CreatedSession }> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, dto.email.toLowerCase().trim()));

    // Always run a hash verification, even for a nonexistent account, against a fixed dummy
    // hash — so the response time for "unknown account" doesn't trivially differ from "wrong
    // password" by skipping the (deliberately expensive) Argon2id step.
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await this.passwordService.verify(
      hashToVerify,
      dto.password,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    const session = await this.sessionService.createSession(user.id);
    return { user: omitPasswordHash(user), session };
  }

  async logout(rawToken: string): Promise<void> {
    await this.sessionService.revokeByToken(rawToken);
  }
}

/**
 * A real Argon2id hash (generated once, offline, with the same parameters PasswordService
 * uses) of an arbitrary, unused value — never a valid password's hash, but a genuinely
 * well-formed PHC string, so `argon2.verify()` performs a real, full-cost verification
 * against it instead of failing fast on a malformed/unparseable input. There is nothing
 * secret about this value; it doesn't correspond to any real account.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$HhS+qQVbkuUI7gjNQjqwwQ$P/NZnHkiAvmheb1z51Ucw8KaySjIhoTX/DoQAbo3/GE';
