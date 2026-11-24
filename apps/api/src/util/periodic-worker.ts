// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PeriodicWorkerOptions {
  /** Human-readable name for structured error logs. */
  name: string;
  /** Interval in milliseconds between runs. */
  intervalMs: number;
  /** Optional predicate; if it returns true, the tick is skipped (e.g., maintenanceMode). */
  shouldSkip?: (() => boolean) | undefined;
  /** Run immediately upon start() in addition to periodic ticks. */
  runImmediately?: boolean | undefined;
  /** Worker body. May be synchronous or asynchronous. */
  task: () => void | Promise<void>;
}

/**
 * Unified periodic background worker with re-entrancy protection, `.unref()`'d timers,
 * maintenance-mode awareness, and deterministic graceful shutdown via `stop()`.
 */
export class PeriodicWorker {
  readonly #options: PeriodicWorkerOptions;
  #timer: NodeJS.Timeout | null = null;
  #isRunning = false;

  constructor(options: PeriodicWorkerOptions) {
    this.#options = options;
  }

  public start(): void {
    if (this.#timer) return;
    if (this.#options.runImmediately) {
      void this.tick();
    }
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#options.intervalMs);
    this.#timer.unref?.();
  }

  public stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  public get isActive(): boolean {
    return this.#timer !== null;
  }

  public async tick(): Promise<void> {
    if (this.#isRunning) return;
    try {
      if (this.#options.shouldSkip?.()) return;
    } catch {
      // Proceed if skip predicate itself cannot evaluate
    }
    this.#isRunning = true;
    try {
      await this.#options.task();
    } catch (err) {
      console.error(`[${this.#options.name}] Worker tick failed:`, err);
    } finally {
      this.#isRunning = false;
    }
  }
}
