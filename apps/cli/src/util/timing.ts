// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI stage profiler.
 *
 * Records wall-clock time for named compilation/simulation stages
 * and emits a JSON timing report.
 */

export class Profiler {
  private marks = new Map<string, { start: number; end?: number }>();

  /** Begin timing a named stage. */
  start(stage: string): void {
    this.marks.set(stage, { start: performance.now() });
  }

  /** End timing a named stage. */
  end(stage: string): void {
    const m = this.marks.get(stage);
    if (m) m.end = performance.now();
  }

  /** Return elapsed milliseconds per stage (rounded to 2 decimal places). */
  toJSON(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this.marks) {
      result[`${k}_ms`] = v.end ? +(v.end - v.start).toFixed(2) : -1;
    }
    return result;
  }

  /** Write timing report to stderr as JSON. */
  report(): void {
    console.error(JSON.stringify(this.toJSON()));
  }
}
