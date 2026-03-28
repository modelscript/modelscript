// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation orchestrator (master algorithm).
 *
 * Implements a sequential Gauss-Seidel co-simulation master:
 * 1. Initialize all participants
 * 2. For each communication step [t, t+h]:
 *    a. Apply couplings (output → input)
 *    b. Set inputs on each participant
 *    c. Call doStep() on each participant
 *    d. Collect outputs
 *    e. Publish aggregated results via MQTT
 * 3. Terminate all participants
 *
 * Supports real-time pacing via the RealtimePacer.
 */

import type { CosimMqttClient } from "./mqtt/client.js";
import type { StepResult } from "./mqtt/protocol.js";
import type { CoSimParticipant } from "./participant.js";
import { RealtimePacer } from "./realtime.js";
import type { CoSimSession } from "./session.js";

/** Orchestrator event callbacks. */
export interface OrchestratorCallbacks {
  /** Called after each step with aggregated results. */
  onStep?: (result: StepResult) => void;
  /** Called when the simulation completes. */
  onComplete?: () => void;
  /** Called on error. */
  onError?: (error: Error) => void;
  /** Called on state change. */
  onStateChange?: (state: string) => void;
}

/**
 * Co-simulation orchestrator (Gauss-Seidel master).
 */
export class Orchestrator {
  private readonly session: CoSimSession;
  private readonly mqttClient: CosimMqttClient | null;
  private readonly callbacks: OrchestratorCallbacks;
  private pacer: RealtimePacer | null = null;
  private aborted = false;
  private paused = false;

  constructor(session: CoSimSession, mqttClient: CosimMqttClient | null, callbacks: OrchestratorCallbacks = {}) {
    this.session = session;
    this.mqttClient = mqttClient;
    this.callbacks = callbacks;
  }

  /**
   * Run the co-simulation from start to completion.
   */
  async run(): Promise<void> {
    const { experiment, coupling, realtimeFactor } = this.session;
    const participants = Array.from(this.session.participants.values());

    if (participants.length === 0) {
      throw new Error("No participants in session");
    }

    try {
      // ── Phase 1: Initialize ──
      this.session.transition("initializing");
      this.callbacks.onStateChange?.("initializing");

      await Promise.all(
        participants.map((p) => p.initialize(experiment.startTime, experiment.stopTime, experiment.stepSize)),
      );

      // ── Phase 2: Step loop ──
      this.session.transition("running");
      this.callbacks.onStateChange?.("running");

      if (realtimeFactor > 0) {
        this.pacer = new RealtimePacer(realtimeFactor);
        this.pacer.start(experiment.startTime);
      }

      let t = experiment.startTime;
      const h = experiment.stepSize;

      while (t < experiment.stopTime - 1e-15 && !this.aborted) {
        // Handle pause
        while (this.paused && !this.aborted) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        if (this.aborted) break;

        // Real-time pacing
        if (this.pacer) {
          await this.pacer.pace(t);
        }

        const effectiveH = Math.min(h, experiment.stopTime - t);

        // ── Step 2a: Collect all current outputs ──
        const allOutputs = new Map<string, Map<string, number>>();
        for (const p of participants) {
          const outputs = await p.getOutputs();
          allOutputs.set(p.id, outputs);
        }

        // ── Step 2b: Apply couplings (output → input) ──
        const inputSets = coupling.applyCouplings(allOutputs);

        // ── Step 2c: Set inputs on each participant ──
        for (const p of participants) {
          const inputs = inputSets.get(p.id);
          if (inputs && inputs.size > 0) {
            await p.setInputs(inputs);
          }
        }

        // ── Step 2d: Execute step on each participant (sequential Gauss-Seidel) ──
        for (const p of participants) {
          await p.doStep(t, effectiveH);
        }

        // ── Step 2e: Collect outputs and publish results ──
        const stepOutputs: Record<string, Record<string, number>> = {};
        for (const p of participants) {
          const outputs = await p.getOutputs();
          const map: Record<string, number> = {};
          outputs.forEach((value, key) => {
            map[key] = value;
          });
          stepOutputs[p.id] = map;
        }

        const result: StepResult = {
          time: t + effectiveH,
          participants: stepOutputs,
        };

        // Publish to MQTT
        if (this.mqttClient) {
          this.mqttClient.publishResults(this.session.sessionId, result);

          // Publish individual variable values for each participant
          for (const p of participants) {
            const outputs = await p.getOutputs();
            this.mqttClient.publishVariableBatch(this.session.sessionId, p.id, {
              time: t + effectiveH,
              values: Object.fromEntries(outputs),
            });
          }
        }

        // Notify callback
        this.callbacks.onStep?.(result);

        t += effectiveH;
      }

      // ── Phase 3: Terminate ──
      await this.terminateAll(participants);

      if (this.aborted) {
        this.session.transition("failed", "Simulation aborted");
        this.callbacks.onStateChange?.("failed");
      } else {
        this.session.transition("completed");
        this.callbacks.onStateChange?.("completed");
        this.callbacks.onComplete?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.session.transition("failed", message);
      this.callbacks.onError?.(err instanceof Error ? err : new Error(message));

      // Best-effort terminate all participants
      await this.terminateAll(participants).catch(() => {
        /* best-effort cleanup */
      });
    }
  }

  /** Pause the simulation. */
  pause(): void {
    if (this.session.state === "running") {
      this.paused = true;
      this.session.transition("paused");
      this.callbacks.onStateChange?.("paused");
    }
  }

  /** Resume the simulation. */
  resume(): void {
    if (this.session.state === "paused") {
      this.paused = false;
      this.session.transition("running");
      this.callbacks.onStateChange?.("running");
    }
  }

  /** Abort the simulation. */
  abort(): void {
    this.aborted = true;
    this.paused = false;
  }

  /** Terminate all participants. */
  private async terminateAll(participants: CoSimParticipant[]): Promise<void> {
    await Promise.allSettled(participants.map((p) => p.terminate()));
  }
}
