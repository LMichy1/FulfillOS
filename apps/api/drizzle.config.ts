import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is only required for drizzle-kit commands that actually connect to a
// database (e.g. `introspect`, `push`); `generate` only diffs the TS schema against the
// committed migration history and needs no connection, so we don't hard-require it here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
