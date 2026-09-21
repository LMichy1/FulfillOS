import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS } from './redis.constants';
import type { EnvConfig } from '../config/env.validation';

/**
 * Used for rate limiting (see auth/rate-limit.guard.ts). Not used for session storage —
 * sessions are Postgres rows (ADR-003), not cached here.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>): Redis => {
        return new Redis(configService.get('REDIS_URL', { infer: true }));
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
