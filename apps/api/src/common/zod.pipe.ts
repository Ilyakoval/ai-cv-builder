import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodError, ZodTypeAny, z } from 'zod';

export function zodDetails(error: ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Validates and *transforms* (sanitises) input with a shared zod schema. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: result.error.issues[0]?.message ?? 'Invalid request',
        details: zodDetails(result.error),
      });
    }
    return result.data;
  }
}

/** Route params are ids; reject anything that is not a UUID before it reaches the DB. */
export const UuidParam = new ZodPipe(z.string().uuid('Not found'));
