export * from './user.entity';
export * from './session.entity';
export * from './cv.entity';
export * from './cv-question.entity';
export * from './cv-job.entity';

import { Cv } from './cv.entity';
import { CvJob } from './cv-job.entity';
import { CvQuestion } from './cv-question.entity';
import { Session } from './session.entity';
import { User } from './user.entity';

export const ENTITIES = [User, Session, Cv, CvQuestion, CvJob];
