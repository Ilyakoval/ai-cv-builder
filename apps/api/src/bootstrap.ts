import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PDF_MAX_BYTES } from '@cvb/shared';
import { AppModule } from './app.module';
import { hashToken } from './auth/auth.service';
import { SESSION_COOKIE } from './auth/session.guard';

/** Shared by main.ts and the e2e tests so tests exercise the real HTTP stack. */
export async function createApp(opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // The API sits behind the Next.js proxy; trust X-Forwarded-For for rate limiting.
    trustProxy: true,
    bodyLimit: 256 * 1024,
    logger: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: opts.logger === false ? false : ['log', 'warn', 'error'],
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    // Signed-in users are limited per session (many users can share one office IP);
    // anonymous requests (login/signup) per client IP.
    keyGenerator: (req) => {
      const token = req.cookies?.[SESSION_COOKIE];
      return token ? `s:${hashToken(token)}` : `ip:${req.ip}`;
    },
  });
  await app.register(multipart, {
    limits: { fileSize: PDF_MAX_BYTES, files: 1, fields: 5, fieldSize: 64 * 1024, parts: 6 },
  });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}

export type App = INestApplication;
