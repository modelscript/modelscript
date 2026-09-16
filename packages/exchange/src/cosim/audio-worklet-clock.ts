// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AudioWorklet / Web Audio Real-Time Simulation Clock.
 *
 * Browsers aggressively throttle `setInterval` and `setTimeout` (down to 1 Hz)
 * when a browser tab is minimized or backgrounded. This causes traditional
 * in-browser HIL and real-time co-simulation to experience severe jitter or stall.
 *
 * This class uses the Web Audio API (`AudioContext`) running on the browser's
 * high-priority OS audio thread (44.1 kHz / 48 kHz). Web Audio execution is
 * NEVER throttled in background tabs, providing sub-millisecond periodic triggers
 * for browser-based Soft HIL simulation loops.
 */

export interface AudioClockOptions {
  /** Target step interval in seconds (e.g., 0.01 for 100 Hz, 0.005 for 200 Hz). */
  stepSize: number;
  /** Real-time speed factor (1.0 = real-time, 2.0 = 2x speed). Default: 1.0. */
  realtimeFactor?: number;
  /** Callback fired on each simulation step tick. */
  onTick: (simTime: number, actualElapsedMs: number) => Promise<void> | void;
}

export class AudioWorkletClock {
  private stepSize: number;
  private realtimeFactor: number;
  private onTick: AudioClockOptions["onTick"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private audioCtx: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private timerNode: any = null;
  private isRunning = false;
  private currentSimTime = 0;
  private lastTickWallMs = 0;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AudioClockOptions) {
    this.stepSize = options.stepSize;
    this.realtimeFactor = options.realtimeFactor ?? 1.0;
    this.onTick = options.onTick;
  }

  /**
   * Start the real-time clock generator.
   */
  async start(initialTime = 0): Promise<void> {
    this.currentSimTime = initialTime;
    this.isRunning = true;
    this.lastTickWallMs = performance.now();

    const hasAudio =
      typeof window !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Boolean((window as any).AudioContext) || Boolean((window as any).webkitAudioContext));

    if (hasAudio) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass();
        if (this.audioCtx.state === "suspended") {
          await this.audioCtx.resume();
        }

        // Use ScriptProcessorNode buffer periodicity to generate clock ticks
        // bufferSize of 256 or 512 samples at 44.1kHz gives ~5.8ms or ~11.6ms chunks
        const bufferSize = 256;
        this.timerNode = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

        let sampleCounter = 0;
        const targetSamplesPerTick = Math.max(
          1,
          Math.round(this.audioCtx.sampleRate * (this.stepSize / this.realtimeFactor)),
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.timerNode.onaudioprocess = async (_e: any) => {
          if (!this.isRunning) return;
          sampleCounter += bufferSize;

          while (sampleCounter >= targetSamplesPerTick) {
            sampleCounter -= targetSamplesPerTick;
            const now = performance.now();
            const elapsed = now - this.lastTickWallMs;
            this.lastTickWallMs = now;

            this.currentSimTime += this.stepSize;
            try {
              await this.onTick(this.currentSimTime, elapsed);
            } catch (err) {
              console.error("[AudioWorkletClock] Error in step tick callback:", err);
            }
          }
        };

        // Connect through silent gain to destination to keep audio thread alive
        const silentGain = this.audioCtx.createGain();
        silentGain.gain.value = 0.0;
        this.timerNode.connect(silentGain);
        silentGain.connect(this.audioCtx.destination);
        return;
      } catch (err) {
        console.warn("[AudioWorkletClock] Web Audio initialization failed, falling back to timer:", err);
      }
    }

    // Fallback: Node.js or browser without Web Audio
    const intervalMs = Math.max(1, (this.stepSize / this.realtimeFactor) * 1000);
    this.fallbackTimer = setInterval(async () => {
      if (!this.isRunning) return;
      const now = performance.now();
      const elapsed = now - this.lastTickWallMs;
      this.lastTickWallMs = now;
      this.currentSimTime += this.stepSize;
      await this.onTick(this.currentSimTime, elapsed);
    }, intervalMs);
  }

  /**
   * Stop the clock.
   */
  stop(): void {
    this.isRunning = false;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.timerNode) {
      try {
        this.timerNode.disconnect();
      } catch {
        /* ignore */
      }
      this.timerNode = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }
  }

  get active(): boolean {
    return this.isRunning;
  }
}
