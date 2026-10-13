import '@fastify/cookie';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { User } from '../database/entities';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'cvb_session';

type AuthedRequest = FastifyRequest & { user?: User };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.resolve(req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new UnauthorizedException('Please sign in');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException('Please sign in');
  return user;
});
