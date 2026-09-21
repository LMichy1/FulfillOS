import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { EnvConfig } from '../config/env.validation';
import type { User } from '../database/schema';
import { omitPasswordHash } from '../common/user.util';
import { AuthService } from './auth.service';
import {
  clearCsrfCookie,
  clearSessionCookie,
  resolveCookieNames,
  setCsrfCookie,
  setSessionCookie,
} from './cookie.util';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import type { AuthenticatedRequest } from './guards/session-auth.guard';
import { SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  private get isProduction(): boolean {
    return this.configService.get('NODE_ENV', { infer: true }) === 'production';
  }

  private get cookieNames() {
    return resolveCookieNames(
      {
        session: this.configService.get('SESSION_COOKIE_NAME', { infer: true }),
        csrf: this.configService.get('CSRF_COOKIE_NAME', { infer: true }),
      },
      this.isProduction,
    );
  }

  @Public()
  @RateLimit({ limit: 5, windowSeconds: 15 * 60 })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Deliberately does not issue a session — registration and login are separate operations
   * (see docs/architecture/authentication.md). The client calls POST /auth/login immediately
   * afterward if it wants to sign the new user in.
   */
  @Public()
  @RateLimit({ limit: 10, windowSeconds: 15 * 60 })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.authService.login(dto);
    const names = this.cookieNames;
    setSessionCookie(res, names.session, session.token, this.isProduction);
    setCsrfCookie(res, names.csrf, session.csrfToken, this.isProduction);
    return { user, csrfToken: session.csrfToken };
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const names = this.cookieNames;
    const token = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[names.session];
    if (token) {
      await this.authService.logout(token);
    }
    clearSessionCookie(res, names.session, this.isProduction);
    clearCsrfCookie(res, names.csrf, this.isProduction);
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return { user: omitPasswordHash(user) };
  }

  @Get('csrf')
  async csrf(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csrfToken = await this.sessionService.rotateCsrfToken(
      req.authSession,
    );
    setCsrfCookie(res, this.cookieNames.csrf, csrfToken, this.isProduction);
    return { csrfToken };
  }
}
