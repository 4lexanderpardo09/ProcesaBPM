import { Clock } from '../../src/infrastructure/clock.js';

/**
 * A clock the test moves by hand. Authentication also reads the time, so tests that move it far use the
 * services directly (no tokens) and pick instants in the past: a real-time token never looks expired by it.
 */
export class TestClock extends Clock {
  private current: Date;

  constructor(start: Date | string) {
    super();
    this.current = new Date(start);
  }

  override now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
