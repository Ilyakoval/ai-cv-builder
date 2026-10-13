import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { Credentials, CredentialsSchema, UserDto } from '@cvb/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, AppConfig } from '../config/config';
import { User } from '../database/entities';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { CurrentUser, SESSION_COOKIE, SessionGuard } from './session.guard';

const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

const toDto = (u: User): UserDto => ({ id: u.id, email: u.email });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('signup')
  @RouteConfig(AUTH_RATE_LIMIT)
  async signup(
    @Body(new ZodPipe(CredentialsSchema)) body: Credentials,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserDto> {
    const { user, token } = await this.auth.signup(body);
    this.setCookie(reply, token);
    return toDto(user);
  }

  @Post('login')
  @HttpCode(200)
  @RouteConfig(AUTH_RATE_LIMIT)
  async login(
    @Body(new ZodPipe(CredentialsSchema)) body: Credentials,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserDto> {
    const { user, token } = await this.auth.login(body);
    this.setCookie(reply, token);
    return toDto(user);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: User): UserDto {
    return toDto(user);
  }

  private setCookie(reply: FastifyReply, token: string) {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      // Lax blocks the cookie on cross-site POSTs, which is our CSRF defence
      // (the API has no state-changing GETs).
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE,
      path: '/',
      maxAge: Math.floor(this.auth.sessionTtlMs / 1000),
    });
  }
}
