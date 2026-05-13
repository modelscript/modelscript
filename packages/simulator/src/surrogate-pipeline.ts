// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Surrogate Modeling Pipeline.
 *
 * End-to-end API that chains:
 *   DoE sampling → ROM training → (optional) WASM codegen → Runtime registration
 *
 * Single entry point for building fast surrogate models from
 * high-fidelity FMU subsystems.
 */

import type { DoEConfig, DoEResult } from "./doe.js";
import { runDoE } from "./doe.js";
import type { FmuSubsystem } from "./fmu-subsystem.js";
import { FmuSubsystemRegistry } from "./fmu-subsystem.js";
import { NeuralNetFmuSubsystem } from "./nn-fmu-subsystem.js";
import type { ROMTrainConfig, TrainedROM } from "./rom-trainer.js";
import { trainROM } from "./rom-trainer.js";

// ─────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────

/** Configuration for the full surrogate pipeline. */
export interface SurrogatePipelineConfig {
  /** DoE configuration (inputs, outputs, strategy, etc.). */
  doe: DoEConfig;
  /** ROM training configuration (architecture, hyperparameters). */
  rom: Omit<ROMTrainConfig, "data">;
  /**
   * Instance name for the surrogate in the FmuSubsystemRegistry.
   * If provided, the trained ROM is automatically registered.
   */
  registerAs?: string;
  /** Optional registry to register into (default: creates new). */
  registry?: FmuSubsystemRegistry;
}

/** Result of the full surrogate pipeline. */
export interface SurrogatePipelineResult {
  /** The DoE dataset. */
  doeResult: DoEResult;
  /** The trained ROM. */
  trainedROM: TrainedROM;
  /** The FmuSubsystem wrapping the ROM. */
  subsystem: NeuralNetFmuSubsystem;
  /** Training metrics summary. */
  metrics: { trainMSE: number; valMSE: number; r2: number };
  /** Total wall-clock time in ms. */
  totalWallClockMs: number;
}

/** Progress phases reported by the pipeline. */
export type SurrogatePhase = "doe" | "training" | "registration";

/** Progress callback for the pipeline. */
export type SurrogateProgressCallback = (phase: SurrogatePhase, progress: number, detail?: string) => void;

// ─────────────────────────────────────────────────────────────────────
// Pipeline Entry Point
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a fast surrogate model from a high-fidelity FMU.
 *
 * @param fmu        The source FMU subsystem to sample.
 * @param config     Pipeline configuration.
 * @param onProgress Optional progress callback.
 * @returns          The trained ROM, its FmuSubsystem wrapper, and metrics.
 *
 * @example
 * ```typescript
 * const result = buildSurrogate(cfdFmu, {
 *   doe: {
 *     inputs: new Map([["flowRate", { min: 0.1, max: 10 }]]),
 *     outputs: ["temperature", "pressure"],
 *     strategy: "latin-hypercube",
 *     numSamples: 200,
 *     startTime: 0, stopTime: 100, stepSize: 0.1,
 *   },
 *   rom: {
 *     architecture: "mlp",
 *     hiddenLayers: [64, 32],
 *     epochs: 1000,
 *   },
 *   registerAs: "cfdRom",
 * });
 * console.log(`R² = ${result.metrics.r2}`);
 * ```
 */
export function buildSurrogate(
  fmu: FmuSubsystem,
  config: SurrogatePipelineConfig,
  onProgress?: SurrogateProgressCallback,
): SurrogatePipelineResult {
  const totalStart = performance.now();

  // ── Phase 1: Design of Experiments ──
  onProgress?.("doe", 0, "Starting DoE sampling...");

  const doeConfig: DoEConfig = {
    ...config.doe,
    onProgress: (done, total) => {
      onProgress?.("doe", done / total, `Sample ${done}/${total}`);
    },
  };

  const doeResult = runDoE(fmu, doeConfig);
  onProgress?.("doe", 1, `DoE complete: ${doeResult.inputs.length} samples, ${doeResult.failedSamples} failed`);

  if (doeResult.inputs.length === 0) {
    throw new Error("DoE produced no valid samples. Check FMU and input ranges.");
  }

  // ── Phase 2: ROM Training ──
  onProgress?.("training", 0, "Training ROM...");

  const romConfig: ROMTrainConfig = {
    ...config.rom,
    data: doeResult,
    onProgress: (epoch, trainLoss, valLoss) => {
      const totalEpochs = config.rom.epochs ?? 500;
      onProgress?.(
        "training",
        epoch / totalEpochs,
        `Epoch ${epoch}: train=${trainLoss.toExponential(3)}, val=${valLoss.toExponential(3)}`,
      );
    },
  };

  const trainedROM = trainROM(romConfig);
  onProgress?.("training", 1, `Training complete: R²=${trainedROM.metrics.r2.toFixed(4)}`);

  // ── Phase 3: Create FmuSubsystem ──
  onProgress?.("registration", 0, "Creating surrogate subsystem...");

  const subsystem = new NeuralNetFmuSubsystem(fmu.modelName + "_surrogate", trainedROM);

  // Register if requested
  if (config.registerAs) {
    const registry = config.registry ?? new FmuSubsystemRegistry();
    registry.register(config.registerAs, subsystem);
  }

  onProgress?.("registration", 1, "Surrogate ready");

  const totalWallClockMs = performance.now() - totalStart;

  return {
    doeResult,
    trainedROM,
    subsystem,
    metrics: trainedROM.metrics,
    totalWallClockMs,
  };
}

/**
 * Serialize a TrainedROM to a JSON-compatible object.
 * Useful for persisting ROMs to disk or transmitting over the network.
 */
export function serializeROM(rom: TrainedROM): string {
  return JSON.stringify(rom);
}

/**
 * Deserialize a TrainedROM from a JSON string.
 */
export function deserializeROM(json: string): TrainedROM {
  return JSON.parse(json) as TrainedROM;
}
