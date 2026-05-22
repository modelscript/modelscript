// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-Native Surrogate Modeling Pipeline.
 *
 * End-to-end API that chains:
 *   ArenaDoE sampling → ROM training → (optional) FMU registration
 *
 * Works directly from an `ArenaDAEBuilder` model without requiring
 * an external FMU subsystem. Uses the high-performance `simulateArena`
 * pipeline for data generation.
 */

import { ArenaDAEBuilder } from "@modelscript/compiler";
import { FmuSubsystemRegistry } from "../discrete/fmu-subsystem.js";
import { NeuralNetFmuSubsystem } from "../discrete/nn-fmu-subsystem.js";
import type { ArenaDoEConfig, ArenaDoEResult } from "../uq/doe.js";
import { runArenaDoE, runArenaDoEAsync } from "../uq/doe.js";
import type { ROMTrainConfig, TrainedROM } from "./rom-trainer.js";
import { trainROM } from "./rom-trainer.js";

// ─────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────

/** Configuration for the arena surrogate pipeline. */
export interface ArenaSurrogatePipelineConfig {
  /** DoE configuration (inputs, outputs, strategy, etc.). */
  doe: ArenaDoEConfig;
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

/** Result of the arena surrogate pipeline. */
export interface ArenaSurrogatePipelineResult {
  /** The DoE dataset. */
  doeResult: ArenaDoEResult;
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
export type ArenaSurrogatePhase = "doe" | "training" | "registration";

/** Progress callback for the pipeline. */
export type ArenaSurrogateProgressCallback = (phase: ArenaSurrogatePhase, progress: number, detail?: string) => void;

// ─────────────────────────────────────────────────────────────────────
// Pipeline Entry Points
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a fast surrogate model from an arena DAE model.
 *
 * @param arena    The compiled arena DAE.
 * @param config   Pipeline configuration.
 * @param onProgress Optional progress callback.
 * @returns        The trained ROM, its FmuSubsystem wrapper, and metrics.
 *
 * @example
 * ```typescript
 * const result = buildArenaSurrogate(arena, {
 *   doe: {
 *     inputs: new Map([["resistor1.R", { min: 10, max: 1000 }]]),
 *     outputs: ["resistor1.v"],
 *     strategy: "sobol",
 *     numSamples: 200,
 *   },
 *   rom: {
 *     architecture: "mlp",
 *     hiddenLayers: [64, 32],
 *     epochs: 1000,
 *   },
 *   registerAs: "circuitRom",
 * });
 * console.log(`R² = ${result.metrics.r2}`);
 * ```
 */
export function buildArenaSurrogate(
  arena: ArenaDAEBuilder,
  config: ArenaSurrogatePipelineConfig,
  onProgress?: ArenaSurrogateProgressCallback,
): ArenaSurrogatePipelineResult {
  const totalStart = performance.now();

  // ── Phase 1: Design of Experiments ──
  onProgress?.("doe", 0, "Starting arena DoE sampling...");

  const doeConfig: ArenaDoEConfig = {
    ...config.doe,
    onProgress: (done, total) => {
      onProgress?.("doe", done / total, `Sample ${done}/${total}`);
    },
  };

  const doeResult = runArenaDoE(arena, doeConfig);
  onProgress?.("doe", 1, `DoE complete: ${doeResult.inputs.length} samples, ${doeResult.failedSamples} failed`);

  if (doeResult.inputs.length === 0) {
    throw new Error("DoE produced no valid samples. Check model and input ranges.");
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

  const modelName = arena.interner.resolve(arena.getVarNameId(0)) ?? "model";
  const subsystem = new NeuralNetFmuSubsystem(modelName + "_surrogate", trainedROM);

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
 * Async variant of `buildArenaSurrogate()` with abort support.
 */
export async function buildArenaSurrogateAsync(
  arena: ArenaDAEBuilder,
  config: ArenaSurrogatePipelineConfig & { signal?: AbortSignal },
  onProgress?: ArenaSurrogateProgressCallback,
): Promise<ArenaSurrogatePipelineResult> {
  const totalStart = performance.now();

  // ── Phase 1: Async DoE ──
  onProgress?.("doe", 0, "Starting arena DoE sampling...");

  const doeConfig: ArenaDoEConfig = {
    ...config.doe,
    onProgress: (done, total) => {
      onProgress?.("doe", done / total, `Sample ${done}/${total}`);
    },
  };

  const asyncDoeConfig: ArenaDoEConfig & { signal?: AbortSignal } = { ...doeConfig };
  if (config.signal) asyncDoeConfig.signal = config.signal;
  const doeResult = await runArenaDoEAsync(arena, asyncDoeConfig);

  if (config.signal?.aborted) {
    throw new Error("Pipeline aborted during DoE phase.");
  }

  onProgress?.("doe", 1, `DoE complete: ${doeResult.inputs.length} samples, ${doeResult.failedSamples} failed`);

  if (doeResult.inputs.length === 0) {
    throw new Error("DoE produced no valid samples. Check model and input ranges.");
  }

  // ── Phase 2: ROM Training (CPU-bound, no yielding) ──
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

  const modelName = arena.interner.resolve(arena.getVarNameId(0)) ?? "model";
  const subsystem = new NeuralNetFmuSubsystem(modelName + "_surrogate", trainedROM);

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
