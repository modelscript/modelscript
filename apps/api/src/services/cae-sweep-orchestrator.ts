// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeSu2Config } from "@modelscript/cfd";
import { materializeCalculixDeck } from "@modelscript/fea";
import {
  CaeSnapshotExtractor,
  CaeSurrogateBridge,
  ModelicaSurrogateEmitter,
  type CaeRunResult,
  type CaeSurrogateBridgeConfig,
  type SnapshotMatrixDataset,
} from "@modelscript/simulate";
import type { Response } from "express";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { CaeDoeSampler, type DoEStrategy, type ParametricSweepVariable } from "./cae-doe-sampler.js";
import type { CaeScalarSummary, FeaMeshPayload } from "./cae-result-processor.js";
import { CaeSolverRunner, type CaeJobSpec } from "./cae-solver-runner.js";
import { CaeTelemetryStreamer, type CaeSolverType } from "./cae-telemetry-streamer.js";

export interface CaeSweepSpec {
  title?: string;
  solver: CaeSolverType;
  templateDeck: string;
  deckFormat: "inp" | "cfg";
  geometry?: {
    casHash?: string;
    filename?: string;
  };
  sampling: {
    strategy: DoEStrategy;
    sampleCount: number;
    concurrency?: number;
    parameters: ParametricSweepVariable[];
  };
  options?: {
    cores?: number;
    timeoutSeconds?: number;
    runner?: "auto" | "docker" | "host" | "fallback";
  };
}

export interface CaeSweepRun {
  runIndex: number;
  jobId: string;
  parameters: Record<string, number>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startTime?: number;
  completedTime?: number;
  durationMs?: number;
  scalars?: CaeScalarSummary;
  resultDir: string;
  error?: string;
}

export interface CaeSweepState {
  sweepId: string;
  title: string;
  solver: CaeSolverType;
  strategy: DoEStrategy;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  progressPercent: number;
  status: "queued" | "running" | "completed" | "partial_success" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string | undefined;
  runs: CaeSweepRun[];
  meshCasHash?: string | undefined;
  resultDir: string;
}

export interface SweepSurrogateTrainOptions extends CaeSurrogateBridgeConfig {
  targetField?: string;
  modelName?: string;
  packageName?: string;
  description?: string;
}

export interface SweepSurrogateTrainResult {
  success: boolean;
  metrics: {
    capturedEnergy: number;
    numModes: number;
    r2: Record<string, number>;
    fieldRrmse: number;
    maxPointwiseError: number;
  };
  modelicaCode: string;
}

function sanitizeHash(hash: string): string {
  const safe = path.basename(hash).replace(/[^a-f0-9]/gi, "");
  if (!safe || safe.length < 8) {
    throw new Error("Invalid hash identifier");
  }
  return safe;
}

/**
 * Automated Parametric DoE Sweep Orchestrator.
 * Manages parallel cloud solver sweeps, shared-mesh CAS deduplication,
 * real-time SSE progress telemetry, and instant snapshot dataset compilation.
 */
export class CaeSweepOrchestrator {
  private sweeps = new Map<string, CaeSweepState>();
  private streamers = new Map<string, EventEmitter>();
  private activeRunners = new Map<string, Set<string>>(); // sweepId -> Set of active jobIds

  constructor(
    private runner: CaeSolverRunner,
    private cacheDir: string,
  ) {}

  /**
   * Submits and begins execution of a multi-job parametric DoE sweep.
   */
  public submitSweep(spec: CaeSweepSpec): CaeSweepState {
    const sweepId = `sweep_${crypto.randomBytes(6).toString("hex")}`;
    const sweepDir = path.join(this.cacheDir, "sweeps", sweepId);
    fs.mkdirSync(sweepDir, { recursive: true });

    // Generate samples via DoE sampler
    const sampleResult = CaeDoeSampler.generateSamples(
      spec.sampling.parameters,
      spec.sampling.strategy,
      spec.sampling.sampleCount,
    );

    const runs: CaeSweepRun[] = sampleResult.samples.map((sample, idx) => {
      const runDir = path.join(sweepDir, `run_${idx}`);
      return {
        runIndex: idx,
        jobId: `${sweepId}_r${idx}`,
        parameters: sample,
        status: "pending",
        resultDir: runDir,
      };
    });

    const state: CaeSweepState = {
      sweepId,
      title: spec.title || `DoE Sweep (${spec.solver.toUpperCase()})`,
      solver: spec.solver,
      strategy: spec.sampling.strategy,
      totalRuns: runs.length,
      completedRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      progressPercent: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
      runs,
      meshCasHash: spec.geometry?.casHash,
      resultDir: sweepDir,
    };

    this.sweeps.set(sweepId, state);
    const emitter = new EventEmitter();
    this.streamers.set(sweepId, emitter);
    this.activeRunners.set(sweepId, new Set());

    // Asynchronously begin execution pool
    void this.executeSweep(sweepId, spec);

    return state;
  }

  public getSweep(sweepId: string): CaeSweepState | undefined {
    return this.sweeps.get(sweepId);
  }

  public getAllSweeps(): CaeSweepState[] {
    return Array.from(this.sweeps.values());
  }

  public cancelSweep(sweepId: string): boolean {
    const state = this.sweeps.get(sweepId);
    if (!state) return false;

    state.status = "cancelled";
    state.completedAt = new Date().toISOString();

    const activeJobs = this.activeRunners.get(sweepId);
    if (activeJobs) {
      for (const jobId of activeJobs) {
        this.runner.cancelJob(jobId);
      }
      activeJobs.clear();
    }

    for (const run of state.runs) {
      if (run.status === "pending" || run.status === "running") {
        run.status = "cancelled";
      }
    }

    this.emitEvent(sweepId, "sweep_progress", {
      status: "cancelled",
      completedRuns: state.completedRuns,
      totalRuns: state.totalRuns,
      progressPercent: state.progressPercent,
    });

    return true;
  }

  /**
   * Attaches an Express response to real-time Server-Sent Events (SSE) for the sweep.
   */
  public attachSseStream(sweepId: string, res: Response): () => void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const emitter = this.streamers.get(sweepId);
    const state = this.sweeps.get(sweepId);

    // Initial snapshot event
    if (state) {
      res.write(
        `data: ${JSON.stringify({
          type: "sweep_progress",
          status: state.status,
          totalRuns: state.totalRuns,
          completedRuns: state.completedRuns,
          failedRuns: state.failedRuns,
          runningRuns: state.runningRuns,
          progressPercent: state.progressPercent,
        })}\n\n`,
      );
    }

    if (!emitter || state?.status === "completed" || state?.status === "failed" || state?.status === "cancelled") {
      res.write(`data: ${JSON.stringify({ type: "phase", phase: "Sweep Execution Finished" })}\n\n`);
      res.end();
      return () => {};
    }

    const onEvent = (data: { eventType: string; payload: unknown }) => {
      const payloadObj =
        typeof data.payload === "object" && data.payload !== null ? data.payload : { value: data.payload };
      res.write(`data: ${JSON.stringify({ type: data.eventType, ...payloadObj })}\n\n`);
    };

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);

    emitter.on("sweep_event", onEvent);

    const cleanup = () => {
      clearInterval(heartbeat);
      emitter.off("sweep_event", onEvent);
    };

    res.on("close", cleanup);
    return cleanup;
  }

  /**
   * Compiles finished simulation runs into a high-dimensional SnapshotMatrixDataset
   * for POD-Galerkin reduction.
   */
  public extractDataset(sweepId: string, targetField: string = "vonMisesStress"): SnapshotMatrixDataset {
    const state = this.sweeps.get(sweepId);
    if (!state) {
      throw new Error(`Sweep '${sweepId}' not found.`);
    }

    const runResults = this.compileRunResults(state);
    if (runResults.length < 2) {
      throw new Error(`Sweep '${sweepId}' has only ${runResults.length} successful run(s). At least 2 are required.`);
    }

    return CaeSnapshotExtractor.extractFromRuns(runResults, {
      targetField,
      normalizeParameters: false,
    });
  }

  /**
   * 1-Click POD-Galerkin Surrogate Model training directly from completed sweep results.
   */
  public async trainSurrogate(
    sweepId: string,
    options: SweepSurrogateTrainOptions = {},
  ): Promise<SweepSurrogateTrainResult> {
    const state = this.sweeps.get(sweepId);
    if (!state) {
      throw new Error(`Sweep '${sweepId}' not found.`);
    }

    const targetField = options.targetField || (state.solver === "su2" ? "pressure" : "vonMisesStress");
    const dataset = this.extractDataset(sweepId, targetField);

    const trainedSurrogate = CaeSurrogateBridge.train(dataset, {
      energyThreshold: options.energyThreshold ?? 0.999,
      maxModes: options.maxModes ?? 8,
      polynomialDegree: options.polynomialDegree ?? 2,
    });

    const modelName = options.modelName || `Surrogate_${state.solver.toUpperCase()}_${sweepId.slice(0, 8)}`;
    const packageName = options.packageName || "ModelScript.Surrogates";

    const modelicaCode = ModelicaSurrogateEmitter.emitModelica(trainedSurrogate, {
      modelName,
      packageName,
      description: options.description || `Surrogate ROM trained from DoE sweep ${sweepId} (${state.solver})`,
    });

    return {
      success: true,
      metrics: {
        capturedEnergy: trainedSurrogate.metrics.capturedEnergy,
        numModes: trainedSurrogate.metrics.numModes,
        r2: trainedSurrogate.metrics.r2,
        fieldRrmse: trainedSurrogate.metrics.fieldRrmse,
        maxPointwiseError: trainedSurrogate.metrics.maxPointwiseError,
      },
      modelicaCode,
    };
  }

  private emitEvent(sweepId: string, eventType: string, payload: unknown): void {
    const emitter = this.streamers.get(sweepId);
    if (emitter) {
      emitter.emit("sweep_event", { eventType, payload });
    }
  }

  private compileRunResults(state: CaeSweepState): CaeRunResult[] {
    const results: CaeRunResult[] = [];

    for (const run of state.runs) {
      if (run.status !== "completed") continue;

      const scalarsPath = path.join(run.resultDir, "scalars.json");
      const meshPayloadPath = path.join(run.resultDir, "mesh_payload.json");

      if (!fs.existsSync(scalarsPath) || !fs.existsSync(meshPayloadPath)) {
        continue;
      }

      try {
        const scalars = JSON.parse(fs.readFileSync(scalarsPath, "utf8")) as CaeScalarSummary;
        const meshPayload = JSON.parse(fs.readFileSync(meshPayloadPath, "utf8")) as FeaMeshPayload;

        const scalarOutputs: Record<string, number> = {};
        if (scalars.maxVonMisesStressPa !== undefined) {
          scalarOutputs["maxVonMisesStressPa"] = scalars.maxVonMisesStressPa;
        }
        if (scalars.maxDisplacementMeters !== undefined) {
          scalarOutputs["maxDisplacementMeters"] = scalars.maxDisplacementMeters;
        }
        if (scalars.liftCoefficient !== undefined) {
          scalarOutputs["liftCoefficient"] = scalars.liftCoefficient;
        }
        if (scalars.dragCoefficient !== undefined) {
          scalarOutputs["dragCoefficient"] = scalars.dragCoefficient;
        }
        if (scalars.liftToDragRatio !== undefined) {
          scalarOutputs["liftToDragRatio"] = scalars.liftToDragRatio;
        }
        if (scalars.customMetrics) {
          Object.assign(scalarOutputs, scalars.customMetrics);
        }

        const fields: Record<string, Float32Array | number[]> = {};
        if (meshPayload.fields) {
          if (meshPayload.fields.vonMisesStress) {
            fields["vonMisesStress"] = meshPayload.fields.vonMisesStress;
          }
          if (meshPayload.fields.displacements) {
            fields["displacements"] = meshPayload.fields.displacements;
          }
        }

        results.push({
          runId: run.runIndex,
          parameters: run.parameters,
          scalarOutputs,
          fields,
          nodeCoordinates: meshPayload.geometry.positions,
        });
      } catch (err: any) {
        console.warn(`[CaeSweepOrchestrator] Failed to parse result files for run #${run.runIndex}:`, err.message);
      }
    }

    return results;
  }

  private async executeSweep(sweepId: string, spec: CaeSweepSpec): Promise<void> {
    const state = this.sweeps.get(sweepId);
    if (!state) return;

    state.status = "running";
    this.emitEvent(sweepId, "sweep_progress", {
      status: "running",
      totalRuns: state.totalRuns,
      completedRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      progressPercent: 0,
    });

    // Locate shared geometry in CAS if specified
    let sharedGeomPath: string | undefined;
    if (spec.geometry?.casHash) {
      const safe = sanitizeHash(spec.geometry.casHash);
      const geomDir = path.join(this.cacheDir, safe);
      if (fs.existsSync(geomDir)) {
        const files = fs.readdirSync(geomDir);
        const first = files[0];
        if (first) {
          sharedGeomPath = path.join(geomDir, first);
        }
      }
    }

    const concurrency = Math.max(1, Math.min(16, spec.sampling.concurrency || 4));
    let nextRunIndex = 0;
    const activeJobs = this.activeRunners.get(sweepId) || new Set<string>();

    const dispatchNext = async (): Promise<void> => {
      if (state.status === "cancelled") return;
      if (nextRunIndex >= state.runs.length) return;

      const run = state.runs[nextRunIndex++]!;
      run.status = "running";
      run.startTime = Date.now();
      state.runningRuns++;

      activeJobs.add(run.jobId);
      this.emitEvent(sweepId, "run_started", {
        runIndex: run.runIndex,
        jobId: run.jobId,
        parameters: run.parameters,
      });

      // Materialize deck with sample parameters
      let materializedDeck = spec.templateDeck;
      try {
        if (spec.solver === "su2") {
          materializedDeck = materializeSu2Config(spec.templateDeck, { evaluator: run.parameters });
        } else {
          materializedDeck = materializeCalculixDeck(spec.templateDeck, { evaluator: run.parameters });
        }
      } catch (err: any) {
        console.warn(`[CaeSweepOrchestrator] Deck materialization error for run #${run.runIndex}:`, err.message);
      }

      fs.mkdirSync(run.resultDir, { recursive: true });

      const jobSpec: CaeJobSpec = {
        jobId: run.jobId,
        solver: spec.solver,
        deckContent: materializedDeck,
        deckFormat: spec.deckFormat,
        geometryPath: sharedGeomPath,
        cores: spec.options?.cores || 2,
        timeoutSeconds: spec.options?.timeoutSeconds || 300,
        runner: spec.options?.runner || "auto",
        resultDir: run.resultDir,
      };

      const streamer = new CaeTelemetryStreamer(spec.solver);

      try {
        const execRes = await this.runner.executeJob(jobSpec, streamer);
        run.completedTime = Date.now();
        run.durationMs = run.completedTime - (run.startTime || run.completedTime);

        if (execRes.status === "completed") {
          run.status = "completed";
          state.completedRuns++;

          // Read scalars.json
          const scalarsFile = path.join(run.resultDir, "scalars.json");
          if (fs.existsSync(scalarsFile)) {
            run.scalars = JSON.parse(fs.readFileSync(scalarsFile, "utf8"));
          }

          this.emitEvent(sweepId, "run_completed", {
            runIndex: run.runIndex,
            jobId: run.jobId,
            parameters: run.parameters,
            scalars: run.scalars,
            durationMs: run.durationMs,
          });
        } else {
          run.status = "failed";
          run.error = execRes.error || "Solver execution failed";
          state.failedRuns++;
          this.emitEvent(sweepId, "run_failed", {
            runIndex: run.runIndex,
            jobId: run.jobId,
            error: run.error,
          });
        }
      } catch (err: any) {
        run.status = "failed";
        run.error = err.message || "Execution exception";
        state.failedRuns++;
        this.emitEvent(sweepId, "run_failed", {
          runIndex: run.runIndex,
          jobId: run.jobId,
          error: run.error,
        });
      } finally {
        state.runningRuns--;
        activeJobs.delete(run.jobId);
        state.progressPercent = Number((((state.completedRuns + state.failedRuns) / state.totalRuns) * 100).toFixed(1));

        this.emitEvent(sweepId, "sweep_progress", {
          status: state.status,
          totalRuns: state.totalRuns,
          completedRuns: state.completedRuns,
          failedRuns: state.failedRuns,
          runningRuns: state.runningRuns,
          progressPercent: state.progressPercent,
        });

        // Trigger next run in pool
        if ((state.status as string) !== "cancelled" && nextRunIndex < state.runs.length) {
          await dispatchNext();
        }
      }
    };

    // Launch initial concurrent workers
    const initialWorkers: Promise<void>[] = [];
    const poolSize = Math.min(concurrency, state.runs.length);
    for (let i = 0; i < poolSize; i++) {
      initialWorkers.push(dispatchNext());
    }

    await Promise.all(initialWorkers);

    // Finalize sweep status
    if ((state.status as string) !== "cancelled") {
      state.completedAt = new Date().toISOString();
      if (state.completedRuns === state.totalRuns) {
        state.status = "completed";
      } else if (state.completedRuns > 0 && state.completedRuns / state.totalRuns >= 0.8) {
        state.status = "partial_success";
      } else {
        state.status = state.completedRuns > 0 ? "partial_success" : "failed";
      }

      this.emitEvent(sweepId, "sweep_completed", {
        sweepId,
        status: state.status,
        totalRuns: state.totalRuns,
        completedRuns: state.completedRuns,
        failedRuns: state.failedRuns,
        progressPercent: 100,
      });
    }
  }
}
