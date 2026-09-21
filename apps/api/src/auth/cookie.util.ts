import type { Response } from 'express';
import { ABSOLUTE_TIMEOUT_MS } from './session.constants';

export interface CookieNames {
  session: string;
  csrf: string;
}

/**
 * In production, the session cookie name is prefixed with `__Host-`, which the browser
 * itself enforces (rejecting the Set-Cookie entirely) unless the cookie also has `Secure`,
 * `Path=/`, and no `Domain` attribute — all three of which we set anyway. This makes cookie
 * substitution/injection from a sibling subdomain structurally harder, at the cost of only
 * working over HTTPS, which is why it's production-only: local development runs over plain
 * HTTP (see docs/architecture/authentication.md for the full dev-vs-prod cookie table).
 */
export function resolveCookieNames(
  names: CookieNames,
  isProduction: boolean,
): CookieNames {
  if (!isProduction) {
    return names;
  }
  return { session: `__Host-${names.session}`, csrf: `__Host-${names.csrf}` };
}

export function setSessionCookie(
  res: Response,
  cookieName: string,
  token: string,
  isProduction: boolean,
): void {
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TIMEOUT_MS,
  });
}

export function clearSessionCookie(
  res: Response,
  cookieName: string,
  isProduction: boolean,
): void {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

/** The CSRF cookie is deliberately NOT HttpOnly — the client must be able to read it (see
 * ADR-004) — but is otherwise as restrictive as the session cookie. */
export function setCsrfCookie(
  res: Response,
  cookieName: string,
  token: string,
  isProduction: boolean,
): void {
  res.cookie(cookieName, token, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TIMEOUT_MS,
  });
}

export function clearCsrfCookie(
  res: Response,
  cookieName: string,
  isProduction: boolean,
): void {
  res.clearCookie(cookieName, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
}
