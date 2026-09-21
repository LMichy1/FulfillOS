import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id parameters below match a configuration OWASP's Password Storage Cheat Sheet lists
 * as an acceptable minimum (m=19 MiB, t=2, p=1) as of this writing. Revisit these if OWASP's
 * guidance changes — they are a documented, deliberate choice, not an arbitrary default.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Bytes, not characters — bcrypt-style silent truncation bugs are an Argon2id non-issue,
 * but an unbounded input still lets a caller force excessive CPU/memory cost per hash. */
const MAX_PASSWORD_BYTES = 1024;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    this.assertLength(password);
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed/foreign hash format — treat as a failed verification, not a crash.
      return false;
    }
  }

  private assertLength(password: string): void {
    const bytes = Buffer.byteLength(password, 'utf8');
    if (bytes === 0 || bytes > MAX_PASSWORD_BYTES) {
      throw new RangeError(
        `Password must be between 1 and ${MAX_PASSWORD_BYTES} bytes.`,
      );
    }
  }
}
