import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from './database.constants';
import * as schema from './schema';
import type { EnvConfig } from '../config/env.validation';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

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
