import type { User } from '../database/schema';

/** Never return a password hash from any API response. */
export function omitPasswordHash(user: User): Omit<User, 'passwordHash'> {
  return {
    id: user.id,
    email: user.email,
    emailNormalized: user.emailNormalized,
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
