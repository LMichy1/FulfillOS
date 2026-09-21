import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/**
 * Application wiring shared between the real server (main.ts) and tests that need a fully
 * bootstrapped app (test/app.e2e-spec.ts, test/security/*) — kept in one place so tests
 * exercise the exact same prefix/validation/cookie/CORS configuration production runs with,
 * rather than a hand-rolled approximation that could silently drift from it.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(cookieParser());
  // Credentialed CORS requires an explicit trusted origin — never combined with a wildcard.
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
  });
}
