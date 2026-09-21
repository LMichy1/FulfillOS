import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../../redis/redis.constants';
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from '../decorators/rate-limit.decorator';

/**
 * Fixed-window rate limiter backed by Redis, so the limit is consistent across multiple API
 * instances rather than a per-process counter that resets whenever an instance restarts or
 * only limits requests that happen to land on the same instance.
 *
 * Keys on `request.ip` — Express's own resolution of the direct socket address. This
 * deliberately does NOT trust `X-Forwarded-For` unless the app explicitly enables Express's
 * `trust proxy` setting (not done in this project's current deployment — see
 * docs/architecture/authentication.md for what a reverse-proxy deployment would need to
 * change here).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clientKey = request.ip ?? 'unknown';
    const routeKey = `${request.method}:${request.route?.path ?? request.path}`;
    const redisKey = `ratelimit:${routeKey}:${clientKey}`;

    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, options.windowSeconds);
    }

    if (count > options.limit) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
