import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '../database/database.module';
import { sessions, users, type Session, type User } from '../database/schema';
import {
  ABSOLUTE_TIMEOUT_MS,
  ACTIVITY_TOUCH_THROTTLE_MS,
  IDLE_TIMEOUT_MS,
} from './session.constants';

export interface CreatedSession {
  session: Session;
  /** The raw, unhashed session token. Only ever available at creation time — never stored. */
  token: string;
  /** The raw, unhashed CSRF secret. Only ever available at creation time — never stored. */
  csrfToken: string;
}

export interface AuthenticatedSession {
  session: Session;
  user: User;
}

function randomToken(): string {
  // 32 bytes = 256 bits of entropy, base64url-encoded (URL/cookie-safe, no padding).
  return randomBytes(32).toString('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Always issues a brand-new token — the caller (auth.service) must never pass through a
   * pre-authentication identifier here, which is what prevents session fixation.
   */
  async createSession(userId: string): Promise<CreatedSession> {
    const token = randomToken();
    const csrfToken = randomToken();
    const now = new Date();

    const [session] = await this.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: sha256Hex(token),
        csrfSecretHash: sha256Hex(csrfToken),
        createdAt: now,
        lastActivityAt: now,
        idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS),
        absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS),
      })
      .returning();

    return { session, token, csrfToken };
  }

  /**
   * Looks up a session by its raw token, rejecting it (returning null) unless it is
   * un-revoked and within both its idle and absolute windows. Rejection happens the same way
   * for "no such session", "expired", and "revoked" — the guard using this never needs to
   * distinguish them for the caller, which avoids leaking which case applied.
   */
  async validateToken(rawToken: string): Promise<AuthenticatedSession | null> {
    const tokenHash = sha256Hex(rawToken);
    const now = new Date();

    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.idleExpiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    await this.touch(row.session, now);
    return row;
  }

  /** Validates a caller-supplied CSRF token against the session it claims to belong to. */
  verifyCsrfToken(session: Session, candidateToken: string): boolean {
    const expected = Buffer.from(session.csrfSecretHash, 'hex');
    const actual = Buffer.from(sha256Hex(candidateToken), 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  /**
   * Issues a fresh CSRF secret for an already-authenticated session and returns the raw
   * value. Used by GET /auth/csrf: since only the hash is ever persisted, there is no way to
   * "retrieve" the original raw secret handed out at login — rotating it is how the client
   * recovers a usable token if it lost the one it was given (e.g. after a hard reload).
   * Rotating does not affect the session's own validity, only its CSRF pairing; a concurrent
   * tab holding the previous CSRF token will need to re-fetch after a 403.
   */
  async rotateCsrfToken(session: Session): Promise<string> {
    const csrfToken = randomToken();
    await this.db
      .update(sessions)
      .set({ csrfSecretHash: sha256Hex(csrfToken) })
      .where(eq(sessions.id, session.id));
    return csrfToken;
  }

  async revokeByToken(rawToken: string): Promise<void> {
    const tokenHash = sha256Hex(rawToken);
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)),
      );
  }

  /** Extends the idle window, throttled so an active user doesn't write to the sessions
   * table on every single request. */
  private async touch(session: Session, now: Date): Promise<void> {
    const elapsedSinceLastActivity =
      now.getTime() - session.lastActivityAt.getTime();
    if (elapsedSinceLastActivity < ACTIVITY_TOUCH_THROTTLE_MS) {
      return;
    }
    await this.db
      .update(sessions)
      .set({
        lastActivityAt: now,
        idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS),
      })
      .where(eq(sessions.id, session.id));
  }
}
