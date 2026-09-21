import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { Database } from '../database/database.module';

function fakeDatabase(execute: () => Promise<unknown>): Database {
  return { execute } as unknown as Database;
}

describe('HealthController', () => {
  it('reports liveness as ok', () => {
    const controller = new HealthController(
      fakeDatabase(() => Promise.resolve()),
    );
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });

  it('reports readiness as ok when the database responds', async () => {
    const controller = new HealthController(
      fakeDatabase(() => Promise.resolve()),
    );
    await expect(controller.readiness()).resolves.toEqual({ status: 'ok' });
  });

  it('reports readiness as unavailable when the database is unreachable', async () => {
    const controller = new HealthController(
      fakeDatabase(() => Promise.reject(new Error('connection refused'))),
    );
    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
