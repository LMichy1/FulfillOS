/**
 * Application policy, not a universal security standard — see
 * docs/architecture/authentication.md for the reasoning. Adjust here if the policy changes.
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

/** A session's lastActivityAt is only rewritten if at least this much time has passed since
 * the last write, so an active user doesn't cause a database write on every single request. */
export const ACTIVITY_TOUCH_THROTTLE_MS = 60 * 1000; // 1 minute
