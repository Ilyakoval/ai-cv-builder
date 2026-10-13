import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { CvSection, QuestionStatus } from '@cvb/shared';
import { randomUUID } from 'node:crypto';
import { Cv } from './cv.entity';

@Entity({ tableName: 'cv_questions' })
export class CvQuestion {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => Cv, { deleteRule: 'cascade', index: true })
  cv!: Cv;

  @Enum({ items: ['contact', 'summary', 'experience', 'education', 'skills'], type: 'string' })
  section!: CvSection;

  /** Id of the experience/education item the question is about, if any. */
  @Property({ type: 'string', length: 40, nullable: true })
  itemId: string | null = null;

  @Property({ type: 'text' })
  question!: string;

  @Enum({ items: ['open', 'applying', 'answered', 'dismissed'], type: 'string' })
  status: QuestionStatus = 'open';

  @Property({ type: 'text', nullable: true })
  answer: string | null = null;

  /** `model` — asked by the LLM; `verifier` — raised because a claim was removed as unsupported. */
  @Enum({ items: ['model', 'verifier'], type: 'string' })
  origin: 'model' | 'verifier' = 'model';

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
