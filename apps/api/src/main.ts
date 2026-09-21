import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Deliberately not part of configureApp(): that function also runs for every test that
  // boots the full app (test/security/setup/app.ts), and generating the OpenAPI document on
  // every one of those boots would slow the test suite for no benefit — this is served only
  // by the real running server.
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FulfillOS API')
      .setDescription(
        'Multi-tenant inventory and order management API. Session-cookie authenticated; ' +
          'mutating requests also require the X-CSRF-Token and Idempotency-Key headers ' +
          'documented per-route below — see docs/architecture/authentication.md and ' +
          'docs/architecture/order-lifecycle.md.',
      )
      .setVersion('1.0')
      .addCookieAuth('fulfillos.sid')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}
bootstrap();
