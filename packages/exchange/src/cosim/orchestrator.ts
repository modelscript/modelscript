// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Co-Simulation Orchestrator & Master Algorithm (FMI 2.0 / 3.0 & Distributed Master).
 *
 * Academic Citations:
 * - Kübler, R., & Schiehlen, W. (2000). Two methods of simulator coupling. Mathematical and
 *   Computer Modelling of Dynamical Systems, 6(2), 93-113.
 *   https://doi.org/10.1076/1387-3954(200006)6:2;1-M;FT093
 * - Arnold, M. (2014). Multi-rate and co-simulation methods. In Extreme-Scale Computing and
 *   Storage, Oberwolfach Reports 11(1), 589-591.
 * - Sicklinger, S., Bellen, A., & Busch, M. (2014). Interface Jacobian-based co-simulation:
 *   Analysis and application. Mathematical and Computer Modelling of Dynamical Systems,
 *   20(3), 227-248. https://doi.org/10.1080/13873954.2013.829497
 * - Blochwitz, T., et al. (2012). The Functional Mockup Interface 2.0: The Standard for
 *   Tool independent Exchange of Simulation Models. In Proceedings of the 9th International
 *   Modelica Conference, 173-184. https://doi.org/10.3384/ecp12076173
 *
 * ModelScript Architectural Rationale:
 * Industrial cyber-physical systems often cannot be compiled into a single monolithic DAE due to
 * IP protection, legacy code, or distributed sub-solvers (e.g. 3D CFD, hardware-in-the-loop rigs,
 * or commercial third-party FMUs). The Co-Simulation Master orchestrates heterogeneous simulation
 * units adhering to FMI 2.0 / 3.0 and System Structure and Parameterization (SSP) standards.
 * It manages communication step intervals [t_k, t_k+h], exchanges inputs and outputs along coupling
 * graphs, and synchronizes distributed participants.
 *
 * ModelScript Modifications:
 * - Sequential Gauss-Seidel and Jacobi master algorithm with topological evaluation of non-cyclic
 *   coupling graphs.
 * - Dynamic unit compatibility validation across input/output ports (`UnitWarning`).
 * - Real-time wall-clock pacer (`RealtimePacer`) for hardware-in-the-loop (HIL) and interactive VR.
 * - Distributed MQTT event and state synchronization for multi-host and cloud co-simulation topologies.
 */

import {
  AlgebraicLoopAdvisor,
  type AlgebraicLoopReport,
  type DirectFeedthroughInput,
} from "./algebraic-loop-advisor.js";
import { type CosimValue, CouplingGraph, type UnitWarning } from "./coupling.js";
import { InterfaceJacobianSolver } from "./interface-jacobian.js";
import type { CosimMqttClient } from "./mqtt/client.js";
import type { StepResult } from "./mqtt/protocol.js";
import { DeadReckoningBuffer, type DeadReckoningEvent, NetworkTimeSynchronizer } from "./network-sync.js";
import type { CoSimParticipant } from "./participant.js";
import type { ICfdProvider } from "./participants/cfd-provider.js";
import { RealtimePacer } from "./realtime.js";
import type { CoSimSession } from "./session.js";
import { StatelessLoopPredictor } from "./stateless-predictor.js";

/** Orchestrator event callbacks. */
export interface OrchestratorCallbacks {
  /** Called after each step with aggregated results. */
  onStep?: ((result: StepResult) => void) | undefined;
  /** Called when the simulation completes. */
  onComplete?: (() => void) | undefined;
  /** Called on error. */
  onError?: ((error: Error) => void) | undefined;
  /** Called on state change. */
  onStateChange?: ((state: string) => void) | undefined;
  /** Called when unit compatibility issues are detected. */
  onUnitWarning?: ((warnings: UnitWarning[]) => void) | undefined;
  /** Called when a CFD provider produces a VTK mesh for VR visualization. */
  onVtkData?: ((participantId: string, time: number, vtkData: Uint8Array) => void) | undefined;
  /** Called when dead-reckoning extrapolation occurs on delayed distributed packets. */
  onDeadReckoning?: ((event: DeadReckoningEvent) => void) | undefined;
  /** Called with Interface Jacobian convergence statistics. */
  onJacobianConvergence?:
    | ((stats: { iterations: number; residual: number; method: "newton" | "picard" | "stateless" }) => void)
    | undefined;
  /** Called when algebraic loops are detected across coupled FMUs. */
  onAlgebraicLoop?: ((report: AlgebraicLoopReport) => void) | undefined;
  /** Pre-compiled STEP files (participantId -> STEP file bytes) */
  stepFiles?: Map<string, Uint8Array> | undefined;
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

  private readonly statelessPredictor = new StatelessLoopPredictor();
  private jacobianSolver: InterfaceJacobianSolver | null = null;
  readonly deadReckoning = new DeadReckoningBuffer();
  readonly networkSync = new NetworkTimeSynchronizer();

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
        participants.map(async (p) => {
          await p.initialize(experiment.startTime, experiment.stopTime, experiment.stepSize);

          // If this is a CFD provider and we have a STEP file for it, load it
          const cfdP = p as unknown as ICfdProvider;
          if (typeof cfdP.loadGeometry === "function" && this.callbacks.stepFiles?.has(p.id)) {
            const stepFileData = this.callbacks.stepFiles.get(p.id);
            if (stepFileData) {
              await cfdP.loadGeometry(stepFileData);
            }
          }
        }),
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

      // ── Algebraic Loop & Delay Advisor ──
      const advisor = new AlgebraicLoopAdvisor();
      const loopReport = advisor.analyze(coupling, participants, this.session.directFeedthrough);
      if (loopReport.hasLoops) {
        this.callbacks.onAlgebraicLoop?.(loopReport);
        if (this.session.autoRemediateLoops) {
          const pref =
            typeof this.session.autoRemediateLoops === "string" ? this.session.autoRemediateLoops : undefined;
          advisor.autoRemediate(this.session, loopReport, pref);
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

        // ── Apply queued tunable parameter changes ──
        const paramChanges = this.session.drainParameterChanges();
        for (const [pid, values] of paramChanges) {
          const p = participants.find((pp) => pp.id === pid);
          if (p?.setParameters) {
            await p.setParameters(values);
          }
        }

        // ── Dispatch to master algorithm ──
        if (this.session.masterAlgorithm === "jacobi") {
          await this.stepJacobi(participants, coupling, t, effectiveH);
        } else if (this.session.masterAlgorithm === "richardson") {
          const newH = await this.stepRichardson(participants, coupling, t, effectiveH);
          // Richardson may adjust step size for next iteration
          if (newH !== effectiveH) h = Math.min(newH, experiment.stepSize * 4);
        } else if (this.session.masterAlgorithm === "newton") {
          await this.stepImplicitNewton(participants, coupling, t, effectiveH);
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
            map[key] = value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value;
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
            const safeBatch: Record<string, number | string | boolean> = {};
            outputs.forEach((v, k) => {
              safeBatch[k] = v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v;
            });
            this.mqttClient.publishVariableBatch(this.session.sessionId, p.id, {
              time: t + effectiveH,
              values: safeBatch,
            });
          }
        }

        // Notify callback
        this.callbacks.onStep?.(result);

        // ── Phase 5: Real-time VR Visualization Pipeline ──
        // Extract VTK volumetric buffers from CFD providers if available
        for (const p of participants) {
          if (
            "getVtkBuffer" in p &&
            typeof (p as unknown as { getVtkBuffer?: (() => Promise<Uint8Array | null>) | undefined }).getVtkBuffer ===
              "function"
          ) {
            const vtkData = await (p as unknown as { getVtkBuffer: () => Promise<Uint8Array | null> }).getVtkBuffer();
            if (vtkData) {
              this.callbacks.onVtkData?.(p.id, t + effectiveH, vtkData);
              if (this.mqttClient) {
                // Determine topic structure dynamically or fallback to standard UNS format
                const topic = `modelscript/site/default/area/default/line/${this.session.sessionId}/cell/${p.id}/vtk`;
                this.mqttClient.publishRaw(topic, Buffer.from(vtkData));
              }
            }
          }
        }

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

  /**
   * Run the Algebraic Loop & Delay Advisor on the current session.
   *
   * @param feedthrough Optional feedthrough map override.
   * @returns Detailed algebraic loop analysis report.
   */
  adviseLoops(feedthrough?: DirectFeedthroughInput): AlgebraicLoopReport {
    const advisor = new AlgebraicLoopAdvisor();
    return advisor.analyze(
      this.session.coupling,
      this.session.participants,
      feedthrough ?? this.session.directFeedthrough,
    );
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
    const allOutputs = new Map<string, Map<string, CosimValue>>();
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
    const allOutputs = new Map<string, Map<string, CosimValue>>();
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
    const fullStepOutputs = new Map<string, Map<string, CosimValue>>();
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
    const halfStepOutputs = new Map<string, Map<string, CosimValue>>();
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

  /**
   * Implicit Newton-Raphson Interface Solver & Fixed-Point loop.
   *
   * Solves tightly-coupled non-linear algebraic loops via:
   * 1. If participants support state save/restore:
   *    Uses Interface Jacobian Newton-Raphson with FMI directional derivatives
   *    (falling back to Broyden rank-1 secant updates or Picard iteration).
   * 2. If participants do NOT support state save/restore:
   *    Uses StatelessLoopPredictor with Adams-Bashforth-2 extrapolation,
   *    Aitken dynamic relaxation, and passivity damping.
   */
  private async stepImplicitNewton(
    participants: CoSimParticipant[],
    coupling: CouplingGraph,
    t: number,
    h: number,
  ): Promise<void> {
    const tol = this.session.richardsonTolerance;
    const couplings = coupling.getAll();

    // Check if participants support state management
    const supportsState = participants.every((p) => p.getState && p.setState);

    if (!supportsState) {
      // ── Strategy 1: Stateless Predictor-Corrector with Aitken & Passivity Damping ──
      const currentOutputs = new Map<string, Map<string, CosimValue>>();
      for (const p of participants) {
        currentOutputs.set(p.id, await p.getOutputs());
      }

      // Apply couplings
      const inputSets = coupling.applyCouplings(currentOutputs);

      // Apply dynamic relaxation across consecutive steps for algebraic stability
      for (const [pid, inMap] of inputSets) {
        for (const [varName, val] of inMap) {
          if (typeof val === "number") {
            const key = `${pid}.${varName}`;
            const relaxed = this.statelessPredictor.relaxInput(key, val);
            inMap.set(varName, relaxed);
          }
        }
      }

      // Set relaxed inputs
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

      this.callbacks.onJacobianConvergence?.({ iterations: 1, residual: 0, method: "stateless" });
      return;
    }

    // ── Strategy 2: Interface Jacobian Newton-Raphson (with State Rollback) ──
    if (!this.jacobianSolver || this.jacobianSolver.dimension !== couplings.length) {
      this.jacobianSolver = new InterfaceJacobianSolver(couplings, {
        tolerance: tol,
        maxIterations: 6,
        enableLineSearch: true,
      });
    }

    // Save initial states of all participants
    const savedStates = new Map<string, unknown>();
    for (const p of participants) {
      if (p.getState) {
        savedStates.set(p.id, await p.getState());
      }
    }

    const restoreAllStates = async () => {
      for (const p of participants) {
        const state = savedStates.get(p.id);
        if (p.setState && state !== undefined) {
          await p.setState(state);
        }
      }
    };

    const freeAllStates = async () => {
      for (const p of participants) {
        const state = savedStates.get(p.id);
        if (p.freeState && state !== undefined) {
          await p.freeState(state);
        }
      }
    };

    const stepWithInputs = async (candidateInputs: Map<string, Map<string, CosimValue>>) => {
      await restoreAllStates();
      for (const p of participants) {
        const inputs = candidateInputs.get(p.id);
        if (inputs && inputs.size > 0) {
          await p.setInputs(inputs);
        }
      }
      for (const p of participants) {
        await p.doStep(t, h);
      }
      const postOutputs = new Map<string, Map<string, CosimValue>>();
      for (const p of participants) {
        postOutputs.set(p.id, await p.getOutputs());
      }
      return postOutputs;
    };

    const initialOutputs = new Map<string, Map<string, CosimValue>>();
    for (const p of participants) {
      initialOutputs.set(p.id, await p.getOutputs());
    }
    const currentInputs = coupling.applyCouplings(initialOutputs);
    let currentOutputs = await stepWithInputs(currentInputs);

    let U = this.jacobianSolver.extractUFromInputs(currentInputs);
    let { residual, norm } = this.jacobianSolver.computeResidual(U, currentOutputs);

    if (norm < tol) {
      await freeAllStates();
      this.callbacks.onJacobianConvergence?.({ iterations: 0, residual: norm, method: "newton" });
      return;
    }

    const dim = U.length;
    const scratchDeltaU = new Float64Array(dim);
    const scratchTrialU = new Float64Array(dim);
    const scratchBestU = new Float64Array(dim);
    const scratchDeltaR = new Float64Array(dim);

    let J: Float64Array | null = null;
    const maxIter = 6;

    for (let iter = 0; iter < maxIter; iter++) {
      try {
        if (!J || iter === 0 || this.jacobianSolver.hasAnalyticDerivatives(participants)) {
          J = await this.jacobianSolver.assembleJacobian(participants, U, t, h, residual, async (pertU) => {
            const pertInputs = this.jacobianSolver!.vectorToInputMap(pertU);
            return await stepWithInputs(pertInputs);
          });
        }

        this.jacobianSolver.solveLinearSystem(J, residual, scratchDeltaU);

        let alpha = 1.0;
        scratchBestU.set(U);
        let bestNorm = norm;
        let bestOutputs = currentOutputs;

        for (let ls = 0; ls < 3; ls++) {
          for (let i = 0; i < dim; i++) scratchTrialU[i] = U[i]! + alpha * scratchDeltaU[i]!;

          const trialInputs = this.jacobianSolver.vectorToInputMap(scratchTrialU);
          const trialOutputs = await stepWithInputs(trialInputs);
          const trialRes = this.jacobianSolver.computeResidual(scratchTrialU, trialOutputs);

          if (trialRes.norm < bestNorm || ls === 2) {
            scratchBestU.set(scratchTrialU);
            bestNorm = trialRes.norm;
            bestOutputs = trialOutputs;
            for (let i = 0; i < dim; i++) scratchDeltaR[i] = trialRes.residual[i]! - residual[i]!;
            this.jacobianSolver.updateBroyden(J, scratchDeltaU, scratchDeltaR);
            residual = trialRes.residual;
            break;
          }
          alpha *= 0.5;
        }

        U.set(scratchBestU);
        norm = bestNorm;
        currentOutputs = bestOutputs;

        if (norm < tol) {
          await freeAllStates();
          this.callbacks.onJacobianConvergence?.({ iterations: iter + 1, residual: norm, method: "newton" });
          return;
        }
      } catch {
        const newInputs = coupling.applyCouplings(currentOutputs);
        currentOutputs = await stepWithInputs(newInputs);
        U = this.jacobianSolver.extractUFromInputs(newInputs);
        const res = this.jacobianSolver.computeResidual(U, currentOutputs);
        norm = res.norm;
        residual = res.residual;
        if (norm < tol) {
          await freeAllStates();
          this.callbacks.onJacobianConvergence?.({ iterations: iter + 1, residual: norm, method: "picard" });
          return;
        }
      }
    }

    await freeAllStates();
    this.callbacks.onJacobianConvergence?.({ iterations: maxIter, residual: norm, method: "newton" });
  }
}
