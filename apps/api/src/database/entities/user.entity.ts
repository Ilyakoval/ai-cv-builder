import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

@Entity({ tableName: 'users' })
export class User {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 254 })
  @Unique()
  email!: string;

  @Property({ type: 'string', hidden: true, lazy: true })
  passwordHash!: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
