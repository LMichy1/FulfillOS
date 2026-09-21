import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  drizzle,
  type NodePgDatabase,
  type NodePgTransaction,
} from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { DRIZZLE } from './database.constants';
import * as schema from './schema';
import type { EnvConfig } from '../config/env.validation';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/** The `tx` parameter type inside a `db.transaction(async (tx) => ...)` callback — used by
 * service methods that need to accept an already-open transaction (e.g. a shared idempotency
 * helper that must run its own writes on the same connection/transaction as the caller's
 * business logic, never a separate one). */
export type DbTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>): Database => {
        const pool = new Pool({
          connectionString: configService.get('DATABASE_URL', { infer: true }),
        });
        return drizzle(pool, { schema }) as Database;
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async onModuleDestroy(): Promise<void> {
    await this.db.$client.end();
  }
}
