import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Keyset (cursor) pagination, not offset pagination: a page is defined by "rows strictly after
 * this (created_at, id) position", not "skip N rows". This is what makes listing stable under
 * concurrent inserts — a new row created between two page fetches can never cause an
 * already-returned row to be skipped or repeated, the way it can with `OFFSET`.
 *
 * Ordering is always (created_at DESC, id DESC): newest first, with `id` as a deterministic
 * tiebreaker for rows that share a `created_at` timestamp.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorFields {
  createdAt: Date;
  id: string;
}

export function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function encodeCursor(fields: CursorFields): string {
  return Buffer.from(
    JSON.stringify({ c: fields.createdAt.toISOString(), i: fields.id }),
  ).toString('base64url');
}

/** Returns null for a missing cursor, and also for one that fails to decode — callers should
 * treat a present-but-invalid cursor as a 400, not silently fall back to the first page. */
export function decodeCursor(cursor: string | undefined): CursorFields | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
      return null;
    }
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}

/** The WHERE fragment for "strictly after this cursor" in a (created_at DESC, id DESC)
 * listing: an earlier created_at, or the same created_at with a strictly smaller id. */
export function keysetBefore(
  createdAtColumn: PgColumn,
  idColumn: PgColumn,
  cursor: CursorFields,
): SQL {
  return or(
    lt(createdAtColumn, cursor.createdAt),
    and(eq(createdAtColumn, cursor.createdAt), lt(idColumn, cursor.id)),
  )!;
}

/** Given `limit + 1` rows fetched in (created_at DESC, id DESC) order, splits them into the
 * page to return and the next cursor (or null if that extra row didn't exist, i.e. this was
 * the last page). The caller fetches `limit + 1` rows precisely so this never needs a separate
 * COUNT query to know whether another page exists. */
export function paginate<T extends CursorFields>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
