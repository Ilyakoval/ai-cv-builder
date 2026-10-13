import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { User } from './user.entity';

/**
 * Opaque server-side session. Only the SHA-256 of the token is stored, so a
 * database leak does not hand out live sessions; sessions are revocable
 * (logout deletes the row), unlike stateless JWTs.
 */
@Entity({ tableName: 'sessions' })
export class Session {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ type: 'string', length: 64 })
  @Unique()
  tokenHash!: string;

  @Property({ type: 'datetime' })
  @Index()
  expiresAt!: Date;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
