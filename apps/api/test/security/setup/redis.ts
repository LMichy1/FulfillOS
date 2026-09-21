import Redis from 'ioredis';

let client: Redis | undefined;

/** Same numbered Redis database createSecurityTestApp() points the app at (REDIS_URL_TEST),
 * so flushing here can't touch dev data. */
export function getTestRedis(): Redis {
  if (!client) {
    client = new Redis(
      process.env.REDIS_URL_TEST ?? 'redis://localhost:6379/1',
    );
  }
  return client;
}

/** Resets rate-limit counters between tests so one test's login/register attempts don't
 * exhaust another test's quota. */
export async function flushTestRedis(): Promise<void> {
  await getTestRedis().flushdb();
}

export async function closeTestRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
