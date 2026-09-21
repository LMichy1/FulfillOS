import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/** Never log a raw connection string — it may contain a password. */
function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set to run migrations.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log(
    `Applying migrations to ${redactConnectionString(databaseUrl)} ...`,
  );
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied successfully.');

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(
    'Migration failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
