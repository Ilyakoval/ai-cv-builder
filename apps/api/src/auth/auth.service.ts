import { EntityManager, UniqueConstraintViolationException } from '@mikro-orm/postgresql';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Credentials } from '@cvb/shared';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Session, User } from '../database/entities';

// Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Pre-computed hash used to equalise timing when the email does not exist,
// so login latency does not reveal which emails are registered.
let dummyHash: Promise<string> | undefined;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async signup({ email, password }: Credentials): Promise<{ user: User; token: string }> {
    const user = this.em.create(User, { email, passwordHash: await hash(password, ARGON2_OPTIONS) });
    try {
      await this.em.persistAndFlush(user);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
    return { user, token: await this.createSession(user) };
  }

  async login({ email, password }: Credentials): Promise<{ user: User; token: string }> {
    const user = await this.em.findOne(User, { email }, { populate: ['passwordHash'] });
    if (!user) {
      dummyHash ??= hash('timing-equaliser', ARGON2_OPTIONS);
      await verify(await dummyHash, password).catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return { user, token: await this.createSession(user) };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.em.nativeDelete(Session, { tokenHash: hashToken(token) });
  }

  /** Resolves a session cookie to a user, or null if missing/expired. */
  async resolve(token: string | undefined): Promise<User | null> {
    if (!token || token.length > 128) return null;
    const session = await this.em.findOne(
      Session,
      { tokenHash: hashToken(token), expiresAt: { $gt: new Date() } },
      { populate: ['user'] },
    );
    return session?.user ?? null;
  }

  get sessionTtlMs() {
    return this.config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  private async createSession(user: User): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    this.em.create(Session, {
      user,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.sessionTtlMs),
    });
    // Opportunistic cleanup keeps the table small without a cron job.
    await this.em.nativeDelete(Session, { user, expiresAt: { $lt: new Date() } });
    await this.em.flush();
    return token;
  }
}
