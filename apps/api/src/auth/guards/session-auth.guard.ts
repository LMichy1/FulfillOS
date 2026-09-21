import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SessionService } from '../session.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { EnvConfig } from '../../config/env.validation';
import type { Session, User } from '../../database/schema';

export interface AuthenticatedRequest extends Request {
  authSession: Session;
  authUser: User;
}

/**
 * Applied globally (see auth.module.ts) — deny-by-default. A route or controller must opt
 * out explicitly with @Public() (health checks, registration, login) rather than protected
 * routes having to opt in.
 *
 * Failure modes are deliberately indistinguishable to the caller: "no cookie", "cookie
 * doesn't match any session", "session expired", and "session revoked" all produce the same
 * 401 with the same generic message. Distinguishing them in the response would leak
 * information about session/account state to an attacker probing with stolen or guessed
 * cookies.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const cookieName = this.configService.get('SESSION_COOKIE_NAME', {
      infer: true,
    });
    const token: unknown = (
      request.cookies as Record<string, unknown> | undefined
    )?.[cookieName];

    if (typeof token !== 'string' || token.length === 0) {
      if (isPublic) {
        return true;
      }
      throw new UnauthorizedException('Authentication required.');
    }

    const result = await this.sessionService.validateToken(token);
    if (!result) {
      if (isPublic) {
        return true;
      }
      throw new UnauthorizedException('Session is invalid or has expired.');
    }

    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.authSession = result.session;
    authenticatedRequest.authUser = result.user;
    return true;
  }
}
