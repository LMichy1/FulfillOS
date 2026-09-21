import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SessionService } from '../session.service';
import type { AuthenticatedRequest } from './session-auth.guard';

const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces the session-bound synchronizer token described in ADR-004. Must run after
 * SessionAuthGuard (so `request.authSession` is populated) — applied together via
 * @UseGuards(SessionAuthGuard, CsrfGuard) on mutating, authenticated routes.
 *
 * Deliberately does not protect unauthenticated routes (login, register): there is no session
 * yet to bind a CSRF secret to. Those rely on rate limiting and narrow CORS instead — see
 * docs/architecture/authentication.md.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    if (!request.authSession) {
      throw new ForbiddenException(
        'CSRF validation requires an authenticated session.',
      );
    }

    const header = request.headers[CSRF_HEADER];
    const candidate = Array.isArray(header) ? header[0] : header;

    if (
      !candidate ||
      !this.sessionService.verifyCsrfToken(request.authSession, candidate)
    ) {
      throw new ForbiddenException('Missing or invalid CSRF token.');
    }

    return true;
  }
}
