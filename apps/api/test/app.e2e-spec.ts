import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/health/ready (GET) reports a structured status either way', async () => {
    // This smoke test only proves the route is wired up; it does not require a reachable
    // database. Real database-reachability behavior is covered by the integration suite.
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toEqual({ status: 'ok' });
    } else {
      expect(response.body).toMatchObject({ status: 'error' });
    }
  });
});
