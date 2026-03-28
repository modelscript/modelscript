// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Real-time pacing for co-simulation.
 *
 * Throttles the simulation step loop to match wall-clock time,
 * with a configurable speedup factor.
 */

/**
 * Real-time pacer that controls the simulation step rate.
 */
export class RealtimePacer {
  private readonly realtimeFactor: number;
  private wallClockStart = 0;
  private simTimeStart = 0;

  /**
   * @param realtimeFactor  Speedup factor: 1.0 = real-time, 2.0 = 2× speed, 0 = as-fast-as-possible
   */
  constructor(realtimeFactor: number) {
    this.realtimeFactor = realtimeFactor;
  }

  /** Start the pacer (call at simulation start). */
  start(simStartTime: number): void {
    this.wallClockStart = performance.now();
    this.simTimeStart = simStartTime;
  }

  /**
   * Wait until it's time for the next simulation step.
   *
   * @param currentSimTime  Current simulation time
   * @returns Promise that resolves when it's time to proceed
   */
  async pace(currentSimTime: number): Promise<void> {
    if (this.realtimeFactor <= 0) return; // As fast as possible

    const simElapsed = currentSimTime - this.simTimeStart;
    const wallTargetMs = (simElapsed / this.realtimeFactor) * 1000;
    const wallElapsedMs = performance.now() - this.wallClockStart;
    const waitMs = wallTargetMs - wallElapsedMs;

    if (waitMs > 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /** Get the current wall-clock simulation speed. */
  getActualSpeed(currentSimTime: number): number {
    const simElapsed = currentSimTime - this.simTimeStart;
    const wallElapsedMs = performance.now() - this.wallClockStart;
    if (wallElapsedMs <= 0) return 0;
    return simElapsed / (wallElapsedMs / 1000);
  }
}
