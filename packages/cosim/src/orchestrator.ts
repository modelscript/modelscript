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

import { type UnitWarning, CouplingGraph } from "./coupling.js";
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
  /** Called when unit compatibility issues are detected. */
  onUnitWarning?: (warnings: UnitWarning[]) => void;
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

      // ── Unit validation ──
      const unitWarnings = coupling.validateUnits();
      if (unitWarnings.length > 0) {
        this.callbacks.onUnitWarning?.(unitWarnings);
        const errors = unitWarnings.filter((w) => w.severity === "error");
        if (errors.length > 0) {
          throw new Error(`Unit incompatibilities detected:\n${errors.map((e) => `  ${e.message}`).join("\n")}`);
        }
      }

      // ── Phase 2: Step loop ──
      this.session.transition("running");
      this.callbacks.onStateChange?.("running");

      if (realtimeFactor > 0) {
        this.pacer = new RealtimePacer(realtimeFactor);
        this.pacer.start(experiment.startTime);
      }

      let t = experiment.startTime;
      let h = experiment.stepSize;

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

        // ── Dispatch to master algorithm ──
        if (this.session.masterAlgorithm === "jacobi") {
          await this.stepJacobi(participants, coupling, t, effectiveH);
        } else if (this.session.masterAlgorithm === "richardson") {
          const newH = await this.stepRichardson(participants, coupling, t, effectiveH);
          // Richardson may adjust step size for next iteration
          if (newH !== effectiveH) h = Math.min(newH, experiment.stepSize * 4);
        } else {
          // Default: Gauss-Seidel (sequential)
          await this.stepGaussSeidel(participants, coupling, t, effectiveH);
        }

        // ── Collect outputs and publish results ──
        const stepOutputs: Record<string, Record<string, number | string | boolean>> = {};
        for (const p of participants) {
          const outputs = await p.getOutputs();
          const map: Record<string, number | string | boolean> = {};
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

  // ── Master algorithm strategies ──

  /**
   * Gauss-Seidel (sequential): collect outputs → apply couplings → set inputs → step each sequentially.
   * Most stable for tightly-coupled systems.
   */
  private async stepGaussSeidel(
    participants: CoSimParticipant[],
    coupling: CouplingGraph,
    t: number,
    h: number,
  ): Promise<void> {
    // Collect all current outputs
    const allOutputs = new Map<string, Map<string, number | string | boolean>>();
    for (const p of participants) {
      const outputs = await p.getOutputs();
      allOutputs.set(p.id, outputs);
    }

    // Apply couplings
    const inputSets = coupling.applyCouplings(allOutputs);

    // Set inputs
    for (const p of participants) {
      const inputs = inputSets.get(p.id);
      if (inputs && inputs.size > 0) {
        await p.setInputs(inputs);
      }
    }

    // Step each participant sequentially
    for (const p of participants) {
      await p.doStep(t, h);
    }
  }

  /**
   * Jacobi (parallel): all participants step simultaneously using the outputs
   * from the previous time step. Better performance for loosely-coupled systems.
   */
  private async stepJacobi(
    participants: CoSimParticipant[],
    coupling: CouplingGraph,
    t: number,
    h: number,
  ): Promise<void> {
    // Collect all outputs from previous step (before any stepping)
    const allOutputs = new Map<string, Map<string, number | string | boolean>>();
    for (const p of participants) {
      const outputs = await p.getOutputs();
      allOutputs.set(p.id, outputs);
    }

    // Apply couplings using previous-step outputs
    const inputSets = coupling.applyCouplings(allOutputs);

    // Set inputs on all participants
    for (const p of participants) {
      const inputs = inputSets.get(p.id);
      if (inputs && inputs.size > 0) {
        await p.setInputs(inputs);
      }
    }

    // Step all participants in parallel
    await Promise.all(participants.map((p) => p.doStep(t, h)));
  }

  /**
   * Richardson extrapolation: take one full step of size h and two half-steps
   * of size h/2, compare results, and suggest adaptive step size.
   *
   * Returns the suggested step size for the next iteration.
   * Requires participants to support state save/restore (getState/setState).
   */
  private async stepRichardson(
    participants: CoSimParticipant[],
    coupling: CouplingGraph,
    t: number,
    h: number,
  ): Promise<number> {
    const tol = this.session.richardsonTolerance;

    // Check if all participants support state management
    const supportsState = participants.every((p) => p.getState && p.setState);

    if (!supportsState) {
      // Fall back to Gauss-Seidel if state management not available
      await this.stepGaussSeidel(participants, coupling, t, h);
      return h;
    }

    // Save states of all participants
    const savedStates = new Map<string, unknown>();
    for (const p of participants) {
      if (p.getState) {
        savedStates.set(p.id, await p.getState());
      }
    }

    // ── Full step: one step of size h ──
    await this.stepGaussSeidel(participants, coupling, t, h);

    // Collect full-step outputs
    const fullStepOutputs = new Map<string, Map<string, number | string | boolean>>();
    for (const p of participants) {
      fullStepOutputs.set(p.id, await p.getOutputs());
    }

    // ── Restore states ──
    for (const p of participants) {
      const state = savedStates.get(p.id);
      if (p.setState && state !== undefined) {
        await p.setState(state);
      }
    }

    // ── Two half-steps: step h/2 twice ──
    const halfH = h / 2;
    await this.stepGaussSeidel(participants, coupling, t, halfH);
    await this.stepGaussSeidel(participants, coupling, t + halfH, halfH);

    // Collect half-step outputs
    const halfStepOutputs = new Map<string, Map<string, number | string | boolean>>();
    for (const p of participants) {
      halfStepOutputs.set(p.id, await p.getOutputs());
    }

    // ── Compute error estimate ──
    let maxError = 0;
    for (const [pid, halfOutputs] of halfStepOutputs) {
      const fullOutputs = fullStepOutputs.get(pid);
      if (!fullOutputs) continue;

      for (const [varName, halfVal] of halfOutputs) {
        if (typeof halfVal !== "number") continue;
        const fullVal = fullOutputs.get(varName);
        if (typeof fullVal !== "number") continue;

        // Richardson error estimate: |y_half - y_full| / 3 (for order-1 method)
        const err = Math.abs(halfVal - fullVal) / 3;
        const scale = Math.max(Math.abs(halfVal), 1e-10);
        maxError = Math.max(maxError, err / scale);
      }
    }

    // ── Adaptive step size ──
    // Safety factor of 0.9, increase at most 2x, decrease at most 0.25x
    if (maxError < 1e-15) {
      // Error is essentially zero — double the step
      return Math.min(h * 2, this.session.experiment.stepSize * 4);
    }

    const factor = 0.9 * Math.pow(tol / maxError, 0.5);
    const newH = h * Math.max(0.25, Math.min(factor, 2.0));
    return newH;
  }
}
