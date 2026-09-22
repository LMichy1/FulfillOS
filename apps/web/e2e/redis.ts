// Same problem the Jest security suite already solved (see
// apps/api/test/security/setup/redis.ts's flushTestRedis, used in a beforeEach in every
// *.security-spec.ts file): "one test's login/register attempts must not exhaust another
// test's rate-limit quota." This suite hits the same `RateLimitGuard` (register: 5/15min/IP,
// login: 10/15min/IP — see docs/architecture/authentication.md#rate-limiting-and-failure-handling)
// from every spec file that registers a fresh account, and 14 tests across 6 files easily
// exceeds 5 in a single run. Flushing this logical Redis database before every test (not just
// once per run) is the fix, mirroring the Jest suite's own approach.
import net from 'node:net';

// Must match playwright.config.ts's PLAYWRIGHT_REDIS_URL — isolated from dev (db 0) and the
// Jest security suite (db 1).
const RATE_LIMIT_REDIS_URL = process.env.PLAYWRIGHT_REDIS_URL ?? 'redis://localhost:6379/2';

/** Flushes only the one logical Redis database this suite's rate limiter uses — never the
 * whole Redis instance, which dev and the Jest security suite also share. Speaks the Redis
 * inline-command protocol directly over a plain TCP socket rather than adding a Redis client
 * dependency to apps/web for this one setup step. */
export async function flushRateLimitRedisDb(): Promise<void> {
  const url = new URL(RATE_LIMIT_REDIS_URL);
  const dbIndex = url.pathname.replace(/^\//, '') || '0';
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(
      { host: url.hostname || '127.0.0.1', port: Number(url.port) || 6379 },
      () => {
        socket.write(`SELECT ${dbIndex}\r\nFLUSHDB\r\n`);
      },
    );
    let replies = 0;
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Timed out flushing Redis db ${dbIndex} for the Playwright suite.`));
    });
    socket.on('data', (chunk) => {
      replies += (chunk.toString().match(/\+OK/g) ?? []).length;
      if (replies >= 2) {
        socket.end();
      }
    });
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}
