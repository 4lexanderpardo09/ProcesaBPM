import { Injectable } from '@nestjs/common';

/** Source of the current time; tests replace it to move time forward. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
