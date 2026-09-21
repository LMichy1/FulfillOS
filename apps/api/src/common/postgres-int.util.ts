/** Bounds of a PostgreSQL `integer` (4-byte) column — `inventory.on_hand`/`reserved` and
 * `inventory_movements`'s delta columns are all this type. Used to reject a value or a
 * computed result before it reaches the database, rather than letting Postgres's own overflow
 * check surface as an opaque 500. */
export const PG_INT4_MAX = 2147483647;
export const PG_INT4_MIN = -2147483648;
