import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    CsrfGuard,
    RateLimitGuard,
    // Global, deny-by-default: every route requires a valid session unless marked @Public().
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  // CsrfGuard is exported so other feature modules can reuse it on their own mutating
  // routes (see OrganizationsModule) instead of re-implementing CSRF enforcement.
  exports: [SessionService, CsrfGuard],
})
export class AuthModule {}
