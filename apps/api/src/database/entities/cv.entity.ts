import { Entity, OptionalProps, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { CvDocument, CvStatus, RemovedClaimDto } from '@cvb/shared';
import { randomUUID } from 'node:crypto';
import { User } from './user.entity';

@Entity({ tableName: 'cvs' })
@Index({ properties: ['owner', 'updatedAt'] })
export class Cv {
  [OptionalProps]?: 'status' | 'sourceFileName' | 'document' | 'removedClaims' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  owner!: User;

  @Property({ type: 'string', length: 120 })
  title!: string;

  @Property({ type: 'string', length: 120 })
  targetRole!: string;

  @Enum({ items: ['generating', 'ready', 'failed'], type: 'string' })
  status: CvStatus = 'generating';

  @Enum({ items: ['pdf', 'text'], type: 'string' })
  sourceType!: 'pdf' | 'text';

  @Property({ type: 'string', length: 255, nullable: true })
  sourceFileName: string | null = null;

  /** Extracted plain text of the user's input — the grounding corpus. The PDF itself is not kept. */
  @Property({ type: 'text', lazy: true })
  sourceText!: string;

  @Property({ type: 'json', nullable: true })
  document: CvDocument | null = null;

  @Property({ type: 'json' })
  removedClaims: RemovedClaimDto[] = [];

  /**
   * Bumped on every document write. Clients send it back on save and the
   * worker re-checks it before merging, so concurrent writers never silently
   * overwrite each other.
   */
  @Property({ type: 'integer' })
  version: number = 0;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
