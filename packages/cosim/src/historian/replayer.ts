// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Historian replayer.
 *
 * Reads historical telemetry data from TimescaleDB and re-publishes it
 * to MQTT topics at the original (or scaled) playback speed.
 *
 * Used for replaying recorded co-simulation sessions in Morsel or the IDE.
 */

import type { Pool } from "pg";
import type { CosimMqttClient } from "../mqtt/client.js";

/** Replay configuration. */
export interface ReplayOptions {
  /** Session ID to replay. */
  sessionId: string;
  /** Start time of replay window. */
  from: Date;
  /** End time of replay window. */
  to: Date;
  /** Playback speed factor (1.0 = real-time, 2.0 = 2× speed). */
  speedFactor?: number | undefined;
  /** Step size in seconds for reading data chunks. */
  chunkSeconds?: number | undefined;
}

/** Replay state. */
export type ReplayState = "idle" | "playing" | "paused" | "completed" | "error";

/**
 * Historian replayer: reads recorded telemetry and publishes it as if it were live.
 */
export class HistorianReplayer {
  private readonly pool: Pool;
  private readonly mqttClient: CosimMqttClient;
  private _state: ReplayState = "idle";
  private aborted = false;
  private paused = false;
  private _error: string | null = null;

  constructor(pool: Pool, mqttClient: CosimMqttClient) {
    this.pool = pool;
    this.mqttClient = mqttClient;
  }

  /** Current replay state. */
  get state(): ReplayState {
    return this._state;
  }

  /** Error message (when state is 'error'). */
  get error(): string | null {
    return this._error;
  }

  /**
   * Start replaying a historical session.
   *
   * Reads telemetry in time-ordered chunks and publishes each data point
   * at the appropriate wall-clock time based on the speedFactor.
   */
  async replay(options: ReplayOptions): Promise<void> {
    const { sessionId, from, to, speedFactor = 1.0, chunkSeconds = 10 } = options;
    this._state = "playing";
    this.aborted = false;
    this.paused = false;
    this._error = null;

    try {
      const wallClockStart = performance.now();
      const simTimeStart = from.getTime();

      // Read data in time-ordered chunks to avoid loading everything into memory
      let chunkStart = from;

      while (chunkStart.getTime() < to.getTime() && !this.aborted) {
        // Handle pause
        while (this.paused && !this.aborted) {
          await new Promise<void>((r) => setTimeout(r, 100));
        }
        if (this.aborted) break;

        const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkSeconds * 1000, to.getTime()));

        // Query this time chunk
        const result = await this.pool.query(
          `SELECT time, participant_id, variable_name, value
           FROM telemetry
           WHERE session_id = $1 AND time >= $2 AND time < $3
           ORDER BY time`,
          [sessionId, chunkStart, chunkEnd],
        );

        // Publish each row at the appropriate wall-clock time
        for (const row of result.rows as {
          time: Date;
          participant_id: string;
          variable_name: string;
          value: number;
        }[]) {
          if (this.aborted) break;
          while (this.paused && !this.aborted) {
            await new Promise<void>((r) => setTimeout(r, 100));
          }
          if (this.aborted) break;

          // Calculate when this data point should be published
          const simElapsed = row.time.getTime() - simTimeStart;
          const wallTarget = simElapsed / speedFactor;
          const wallElapsed = performance.now() - wallClockStart;
          const waitMs = wallTarget - wallElapsed;

          if (waitMs > 1) {
            await new Promise<void>((r) => setTimeout(r, waitMs));
          }

          // Publish via MQTT (reuses the live variable topics)
          this.mqttClient.publishVariable(sessionId, row.participant_id, row.variable_name, row.value);
        }

        chunkStart = chunkEnd;
      }

      if (this.aborted) {
        this._state = "idle";
      } else {
        this._state = "completed";
      }
    } catch (err) {
      this._state = "error";
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Pause playback. */
  pause(): void {
    if (this._state === "playing") {
      this.paused = true;
      this._state = "paused";
    }
  }

  /** Resume playback. */
  resume(): void {
    if (this._state === "paused") {
      this.paused = false;
      this._state = "playing";
    }
  }

  /** Stop playback. */
  stop(): void {
    this.aborted = true;
    this.paused = false;
  }
}
