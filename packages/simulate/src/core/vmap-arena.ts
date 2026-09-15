// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JAX-Grade First-Class `vmap` (Batched Vectorized Simulation) for DAE Arenas.
 *
 * Transforms scalar simulation into batched execution across parameter spaces
 * and initial conditions in contiguous linear memory without intermediate wrapper allocations.
 */

import { compileFusedArenaKernel, createPackedBuffer, DAEBuilder, planStaticArenaMemory } from "@modelscript/runtime";
import { ArenaSimulator } from "./simulate-arena.js";

export interface VmapBatchConfig {
  /** Array of parameter maps or row-major parameter matrix [batchSize][numParams]. */
  parameters: Map<string, number>[] | number[][];
  /** Parameter names if parameters is a number[][] matrix. */
  parameterNames?: string[];
  /** Initial states overrides per batch instance (optional). */
  initialStates?: (Map<string, number> | number[])[];
  /** Simulation start time (default: 0). */
  startTime?: number;
  /** Simulation stop time (default: 1). */
  stopTime?: number;
  /** Step size (default: 0.01). */
  step?: number;
}

export interface VmapBatchResult {
  /** Number of batch instances. */
  batchSize: number;
  /** Number of time steps. */
  numSteps: number;
  /** Array of time points. */
  times: Float64Array;
  /** State variable names in order. */
  stateNames: string[];
  /**
   * Contiguous 3D trajectory tensor flattened into Float64Array:
   * [batchIdx * numSteps * numStates + stepIdx * numStates + stateIdx]
   */
  data: Float64Array;
  /** Retrieves a 1D trajectory for a specific batch index and state. */
  getTrajectory(batchIdx: number, stateName: string): Float64Array;
  /** Execution wall-clock time in ms. */
  elapsedMs: number;
}

/**
 * Executes a batched vectorized simulation across M parameter instances simultaneously.
 */
export function simulateVmap(arena: DAEBuilder, config: VmapBatchConfig): VmapBatchResult {
  const startTime = config.startTime ?? 0.0;
  const stopTime = config.stopTime ?? 1.0;
  const dt = config.step ?? (stopTime - startTime) / 100;
  const numSteps = Math.ceil((stopTime - startTime) / dt) + 1;

  const tStart = performance.now();

  const sim = new ArenaSimulator(arena);
  sim.prepare();

  const stateVarsList = Array.from(sim.stateVars);
  const numStates = stateVarsList.length;
  const stateNames = stateVarsList.map((v) => arena.getVarName(v));

  // Determine batch size and normalized parameter array
  let batchSize = 0;
  const paramNames: string[] = [];
  const batchMatrix: number[][] = [];

  if (Array.isArray(config.parameters) && config.parameters.length > 0) {
    batchSize = config.parameters.length;
    const first = config.parameters[0]!;

    if (first instanceof Map) {
      for (const k of first.keys()) paramNames.push(k);
      for (let b = 0; b < batchSize; b++) {
        const m = config.parameters[b] as Map<string, number>;
        batchMatrix.push(paramNames.map((k) => m.get(k) ?? arena.getVarStartValue(arena.getVarIdxByName(k))));
      }
    } else if (Array.isArray(first)) {
      if (!config.parameterNames) throw new Error("parameterNames required when parameters is a 2D array");
      paramNames.push(...config.parameterNames);
      for (let b = 0; b < batchSize; b++) {
        batchMatrix.push([...(config.parameters[b] as number[])]);
      }
    }
  }

  if (batchSize === 0) {
    throw new Error("vmap requires at least 1 batch parameter instance");
  }

  // Precompute static memory plan & compile fused kernel
  const blt = { sortedEquations: sim.sortedEquations, blocks: sim.blocks };
  const plan = planStaticArenaMemory(arena, blt, sim.stateVars);

  const executionBlocks = sim.executionBlocks
    .filter((blk): blk is { type: "single"; varIdx: number; exprId: number } => blk.type === "single")
    .map((blk) => ({
      type: "single" as const,
      varIdx: blk.varIdx,
      exprId: blk.exprId,
    }));
  const fused = compileFusedArenaKernel(arena, executionBlocks, { layout: plan, cse: true });

  // Precompute packed offsets for states and parameters
  const statePackedOffsets = stateVarsList.map((v) => plan.varIdxToOffset[v]!);
  const paramPackedOffsets = paramNames.map((n) => {
    const vIdx = arena.getVarIdxByName(n);
    return plan.varIdxToOffset[vIdx]!;
  });

  // Output 3D tensor: [batchSize * numSteps * numStates]
  const totalFloats = batchSize * numSteps * numStates;
  const outData = new Float64Array(totalFloats);
  const times = new Float64Array(numSteps);
  for (let s = 0; s < numSteps; s++) {
    times[s] = startTime + s * dt;
  }

  // Per-instance packed state buffer
  const packed = createPackedBuffer(plan);

  // Batched RK2 (Heun) integration loop
  for (let inst = 0; inst < batchSize; inst++) {
    // 1. Initialize packed buffer from DAE start values
    for (let v = 0; v < arena.varCount; v++) {
      if (!arena.isVarRemoved(v)) {
        const off = plan.varIdxToOffset[v]!;
        packed[off] = arena.getVarStartValue(v);
      }
    }

    // 2. Inject instance parameters
    const pVals = batchMatrix[inst]!;
    for (let p = 0; p < paramNames.length; p++) {
      packed[paramPackedOffsets[p]!] = pVals[p]!;
    }

    // 3. Inject initial states overrides if provided
    if (config.initialStates && config.initialStates[inst]) {
      const initS = config.initialStates[inst]!;
      if (initS instanceof Map) {
        for (let s = 0; s < numStates; s++) {
          const val = initS.get(stateNames[s]!);
          if (val !== undefined) packed[statePackedOffsets[s]!] = val;
        }
      } else {
        for (let s = 0; s < numStates; s++) {
          if (initS[s] !== undefined) packed[statePackedOffsets[s]!] = initS[s]!;
        }
      }
    }

    // Instance output slice offset
    const instOffset = inst * numSteps * numStates;

    // Record t = 0
    for (let s = 0; s < numStates; s++) {
      outData[instOffset + s] = packed[statePackedOffsets[s]!]!;
    }

    // Temporary derivative buffers for RK2
    const k1 = new Float64Array(numStates);
    const k2 = new Float64Array(numStates);
    const x0 = new Float64Array(numStates);

    // Step across time grid
    for (let step = 1; step < numSteps; step++) {
      // Save current states
      for (let s = 0; s < numStates; s++) {
        x0[s] = packed[statePackedOffsets[s]!]!;
      }

      // 1. Evaluate k1 derivatives at x0
      fused.evaluate(packed);
      for (let s = 0; s < numStates; s++) {
        const name = stateNames[s]!;
        const derIdx = arena.getVarIdxByName(`der(${name})`);
        const derOff = plan.varIdxToOffset[derIdx]!;
        k1[s] = packed[derOff]!;
      }

      // 2. Predictor: x_pred = x0 + dt * k1
      for (let s = 0; s < numStates; s++) {
        packed[statePackedOffsets[s]!] = x0[s]! + dt * k1[s]!;
      }

      // 3. Evaluate k2 derivatives at x_pred
      fused.evaluate(packed);
      for (let s = 0; s < numStates; s++) {
        const name = stateNames[s]!;
        const derIdx = arena.getVarIdxByName(`der(${name})`);
        const derOff = plan.varIdxToOffset[derIdx]!;
        k2[s] = packed[derOff]!;
      }

      // 4. Corrector: x_{n+1} = x0 + 0.5 * dt * (k1 + k2)
      const stepOffset = instOffset + step * numStates;
      for (let s = 0; s < numStates; s++) {
        const xNext = x0[s]! + 0.5 * dt * (k1[s]! + k2[s]!);
        packed[statePackedOffsets[s]!] = xNext;
        outData[stepOffset + s] = xNext;
      }
    }
  }

  const elapsedMs = performance.now() - tStart;

  return {
    batchSize,
    numSteps,
    times,
    stateNames,
    data: outData,
    getTrajectory(batchIdx: number, stateName: string): Float64Array {
      const stateIdx = stateNames.indexOf(stateName);
      if (stateIdx === -1) throw new Error(`State '${stateName}' not found in [${stateNames.join(", ")}]`);
      if (batchIdx < 0 || batchIdx >= batchSize)
        throw new Error(`batchIdx ${batchIdx} out of bounds [0, ${batchSize})`);

      const traj = new Float64Array(numSteps);
      const bOffset = batchIdx * numSteps * numStates;
      for (let s = 0; s < numSteps; s++) {
        traj[s] = outData[bOffset + s * numStates + stateIdx]!;
      }
      return traj;
    },
    elapsedMs,
  };
}
