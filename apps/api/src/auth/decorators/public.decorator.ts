import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route (or a whole controller) as not requiring an authenticated session. Used
 * sparingly — health checks, registration, login. Everything else is protected by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
