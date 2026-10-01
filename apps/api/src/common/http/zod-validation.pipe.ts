import { Injectable, type PipeTransform } from '@nestjs/common';
import { ValidationFailedError } from '@procesabpm/shared';
import type { z } from 'zod';

/** Validates and normalizes a request part with a schema from `@procesabpm/shared` contracts. */
@Injectable()
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<unknown, z.output<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationFailedError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
}
