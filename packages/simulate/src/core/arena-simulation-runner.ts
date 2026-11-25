// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DAEBuilder,
  VarAttrKind,
  Variability,
  causalizeVectorArena,
  convertArenaToMicroModelica,
  eliminateVectorArenaAliases,
  evaluateArenaExpression,
  expandSetBasedConnectionsArena,
  type ArenaBltBlock,
} from "@modelscript/runtime";
import type {
  FmuInstanceMetadata,
  FmuSubsystem,
  FmuSubsystemRegistry,
} from "@modelscript/runtime/wasm_fmu_subsystem.js";
import { solveInitialEquationsArena } from "@modelscript/runtime/wasm_init.js";
import type {
  ArenaCpuSolver,
  ArenaSimulateOptions,
  ArenaSimulationResult,
  SafetyViolationRecord,
  SimDAEBuilder,
  WasmArenaExports,
} from "./arena-sim-types.js";
import type { IntegratorCallback } from "./callbacks.js";
import type { SimulationDebugger } from "./simulation.js";
import type { OnlineSTLMonitor, STLStepResult } from "./stl_monitor.js";

/** Structural interface satisfied by `ArenaSimulator` (avoids circular module imports). */
export interface ArenaSimulatorRunnerTarget {
  arena: DAEBuilder;
  parameters: Map<string, number>;
  parameterVars: Set<number>;
  stateVars: Set<number>;
  blocks: ArenaBltBlock[];
  sortedEquations: number[];
  isVectorMode: boolean;
  skipPantelides: boolean;
  fmuRegistry?: FmuSubsystemRegistry | undefined;
  fmuLoader?: ((fmuPath: string, instance: FmuInstanceMetadata) => FmuSubsystem) | undefined;
  debuggerHook?: SimulationDebugger | undefined;
  prepare(): void;
  simulateVector(options?: ArenaSimulateOptions): ArenaSimulationResult;
  initializeFmuSubsystems(startTime: number, stopTime: number, stepSize: number): void;
  terminateFmuSubsystems(): void;
  simulate(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      solver?: ArenaCpuSolver | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
      stlMonitors?: OnlineSTLMonitor[] | undefined;
      earlyTerminateOnViolation?: boolean | undefined;
      intervalBarrierCheck?: boolean | undefined;
      onStepViolation?:
        ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void) | undefined;
      callbacks?: IntegratorCallback[] | undefined;
    },
  ): {
    t: number[];
    y: Float64Array[];
    terminatedEarly: boolean;
    safetyViolations: SafetyViolationRecord[];
    intervalIssues: string[];
  };
  simulateAsync(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      signal?: AbortSignal | undefined;
      solver?: ArenaCpuSolver | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
    },
  ): Promise<{
    t: number[];
    y: Float64Array[] | number[][];
  }>;
}

function allocateArenaEnvBuffer(arena: DAEBuilder, useWasmLinearMemory: boolean): Float64Array {
  const envSize = Math.max(arena.interner.size + 256, 4096);
  if (useWasmLinearMemory) {
    const wasmExports = (arena as unknown as { exports?: WasmArenaExports }).exports;
    if (typeof wasmExports?.atomicChunkAlloc === "function" && wasmExports?.memory instanceof WebAssembly.Memory) {
      const ptr = wasmExports.atomicChunkAlloc(envSize * 8);
      return new Float64Array(wasmExports.memory.buffer, ptr, envSize);
    }
  }
  return new Float64Array(envSize);
}

function populateAndSolveInitialArenaEnv(
  arena: DAEBuilder,
  sim: Pick<ArenaSimulatorRunnerTarget, "parameters" | "parameterVars" | "stateVars">,
  valuesByStringId: Float64Array,
  startTime: number,
  options?: {
    parameterOverrides?: Map<string, number> | undefined;
    initialStateOverrides?: Map<string, number> | undefined;
  },
): {
  stateStringIds: number[];
  derivStringIds: number[];
  stateNames: string[];
} {
  // Set time
  const timeId = arena.interner.intern("time");
  valuesByStringId[timeId] = startTime;

  // Set parameters from the simulator's resolved parameters and arena start values
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      const name = arena.getVarName(i);
      const nameId = arena.getVarNameId(i);
      const val = sim.parameters.get(name) ?? arena.getVarStartValue(i);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }
  for (const [name, val] of sim.parameters) {
    const nameId = arena.interner.intern(name);
    valuesByStringId[nameId] = val;
  }

  // Apply parameter overrides
  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }

  // Set start values for all non-parameter variables
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant || sim.parameterVars.has(i)) continue;

    const nameId = arena.getVarNameId(i);
    const startVal = arena.getVarStartValue(i);
    if (startVal !== 0 || valuesByStringId[nameId] === 0) {
      valuesByStringId[nameId] = startVal;
    }

    // Evaluate start expression or start attribute if present
    const exprId = arena.getVarExpression(i) as number | undefined;
    if (typeof exprId === "number" && exprId !== -1) {
      const val = evaluateArenaExpression(arena, exprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startAttrId = arena.getVarAttrExprId(i, "start");
    if (typeof startAttrId === "number" && startAttrId !== -1) {
      const val = evaluateArenaExpression(arena, startAttrId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startWasmExprId = arena.getVarAttrExpr(i, VarAttrKind.Start);
    if (typeof startWasmExprId === "number" && startWasmExprId > 0) {
      const val = evaluateArenaExpression(arena, startWasmExprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
  }

  // Solve initial equations
  const initResult = solveInitialEquationsArena(arena, valuesByStringId);
  valuesByStringId.set(initResult.valuesByStringId);
  (arena as SimDAEBuilder)._initialAlgorithmsExecuted = true;

  // Apply initial state overrides (for MHE, Kalman filtering, or state re-initialization)
  if (options?.initialStateOverrides) {
    for (const [name, val] of options.initialStateOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
    }
  }

  // Identify state/derivative StringIds
  const stateStringIds: number[] = [];
  const derivStringIds: number[] = [];
  const stateNames: string[] = [];

  for (const varIdx of sim.stateVars) {
    const name = arena.getVarName(varIdx);
    const nameId = arena.getVarNameId(varIdx);
    const derName = `der(${name})`;
    const derNameId = arena.interner.intern(derName);

    stateStringIds.push(nameId);
    derivStringIds.push(derNameId);
    stateNames.push(name);
  }

  return { stateStringIds, derivStringIds, stateNames };
}

function resolveEffectiveOutputIds(
  arena: DAEBuilder,
  stateNameIds: number[],
  requestedOutputIds: number[] | undefined,
): number[] | undefined {
  if (requestedOutputIds && requestedOutputIds.length > 0) {
    return requestedOutputIds;
  }
  if (stateNameIds.length === 0) {
    const defaultIds: number[] = [];
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      if (arena.hiddenVarIndices?.has(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Parameter || v === Variability.Constant) continue;
      if (arena.getVarShape(i).length > 0) continue;
      defaultIds.push(arena.getVarNameId(i));
    }
    if (defaultIds.length > 0) {
      return defaultIds;
    }
  }
  return requestedOutputIds;
}

function filterHiddenOutputStates(
  arena: DAEBuilder,
  stateVars: Set<number>,
  stateNames: string[],
  y: number[][],
  effectiveOutputIds: number[] | undefined,
  debug: boolean | undefined,
): { outNames: string[]; outY: number[][] } {
  let outNames = stateNames;
  let outY = y;
  if (effectiveOutputIds) {
    outNames = effectiveOutputIds.map((id) => arena.interner.resolve(id) ?? "unknown");
  } else if (arena.hiddenVarIndices && arena.hiddenVarIndices.size > 0 && !debug) {
    const keepIndices: number[] = [];
    const filteredNames: string[] = [];
    const stateVarsArr = Array.from(stateVars);
    for (let idx = 0; idx < stateNames.length; idx++) {
      const varIdx = stateVarsArr[idx];
      if (varIdx === undefined || !arena.hiddenVarIndices.has(varIdx)) {
        keepIndices.push(idx);
        filteredNames.push(stateNames[idx]!);
      }
    }
    if (keepIndices.length < stateNames.length) {
      outNames = filteredNames;
      outY = y.map((row) => keepIndices.map((idx) => row[idx]!));
    }
  }
  return { outNames, outY };
}

/**
 * Initializes the simulation environment Float64Array with parameter bindings,
 * evaluated start values, and solved initial equations. Returns the initialized
 * state vector, state IDs, derivative IDs, and variable names.
 */
export function initializeArenaEnvironment(
  arena: DAEBuilder,
  sim: Pick<ArenaSimulatorRunnerTarget, "parameters" | "parameterVars" | "stateVars">,
  options?: {
    startTime?: number | undefined;
    parameterOverrides?: Map<string, number> | undefined;
    initialStateOverrides?: Map<string, number> | undefined;
  },
): {
  valuesByStringId: Float64Array;
  stateStringIds: number[];
  derivStringIds: number[];
  stateNames: string[];
} {
  const startTime = options?.startTime ?? arena.experiment.startTime ?? 0;
  const valuesByStringId = allocateArenaEnvBuffer(arena, true);
  const { stateStringIds, derivStringIds, stateNames } = populateAndSolveInitialArenaEnv(
    arena,
    sim,
    valuesByStringId,
    startTime,
    options,
  );
  return { valuesByStringId, stateStringIds, derivStringIds, stateNames };
}

/**
 * Orchestrates the synchronous arena-only simulation pipeline (`simulateArena`).
 */
export function executeArenaSimulation(
  arena: DAEBuilder,
  createSimulator: (dae: DAEBuilder) => ArenaSimulatorRunnerTarget,
  options?: ArenaSimulateOptions,
): ArenaSimulationResult {
  if (options?.passManager) {
    options.passManager.run(arena);
  }
  if (options?.vectorCausalize) {
    expandSetBasedConnectionsArena(arena);
    eliminateVectorArenaAliases(arena);
    causalizeVectorArena(arena);
  }
  if (options?.microModelica) {
    convertArenaToMicroModelica(arena);
  }

  // ── Step 1: Prepare the simulator ──
  const sim = createSimulator(arena);
  if (options?.skipPantelides) {
    sim.skipPantelides = true;
  }
  if (options?.fmuRegistry) {
    sim.fmuRegistry = options.fmuRegistry;
  }
  if (options?.fmuLoader) {
    sim.fmuLoader = options.fmuLoader;
  }
  if (options?.debuggerHook) {
    sim.debuggerHook = options.debuggerHook;
  }
  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      sim.parameters.set(name, val);
      const varIdx = arena.getVarIdxByName(name);
      if (varIdx >= 0) {
        arena.setVarStartValue(varIdx, val);
      }
    }
  }
  sim.prepare();
  arena = sim.arena;
  if (sim.isVectorMode) {
    return sim.simulateVector(options);
  }

  // ── Step 2: Resolve experiment annotation defaults ──
  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const numIntervals = options?.numberOfIntervals ?? exp.numberOfIntervals;
  const step =
    options?.step ??
    (numIntervals ? (stopTime - startTime) / numIntervals : (exp.interval ?? (stopTime - startTime) / 500));

  // ── Step 3-5: Build environment, solve initial equations, identify states ──
  const valuesByStringId = allocateArenaEnvBuffer(arena, false);
  const {
    stateStringIds: stateNameIds,
    derivStringIds: derivNameIds,
    stateNames,
  } = populateAndSolveInitialArenaEnv(arena, sim, valuesByStringId, startTime, {
    parameterOverrides: options?.parameterOverrides,
    initialStateOverrides: options?.initialStateOverrides,
  });

  // If no dynamic state variables and no explicit outputStringIds, collect all non-parameter, non-constant scalar variables
  const effectiveOutputIds = resolveEffectiveOutputIds(arena, stateNameIds, options?.outputStringIds);

  // ── Step 6: Run simulation ──
  if (options?.steadyStateOnly) {
    const t = [startTime];
    const initialRow: number[] = [];
    for (const nameId of stateNameIds) {
      initialRow.push(valuesByStringId[nameId] ?? 0);
    }
    let outNames = stateNames;
    let outY = [initialRow];
    if (effectiveOutputIds) {
      outNames = effectiveOutputIds.map((id) => sim.arena.interner.resolve(id) ?? "unknown");
      outY = [effectiveOutputIds.map((id) => valuesByStringId[id] ?? 0)];
    }
    return { t, y: outY, states: outNames };
  }

  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);

  // ── Step 5.5: Initialize FMU subsystems (if any) ──
  sim.initializeFmuSubsystems(startTime, stopTime, step);

  const defaultSolver: ArenaCpuSolver =
    exp.algorithm?.toLowerCase() === "cvode" ? "bdf" : ((exp.algorithm as ArenaCpuSolver | undefined) ?? "rk4");
  const chosenSolver: ArenaCpuSolver =
    options?.solver === "webgpu"
      ? "rk4"
      : options?.solver === "auto"
        ? ((exp.algorithm as ArenaCpuSolver | undefined) ?? "auto")
        : options?.solver
          ? options.solver
          : defaultSolver;

  const rawResult = sim.simulate(steps, step, valuesByStringId, stateNameIds, derivNameIds, {
    solver: chosenSolver,
    atol: options?.atol ?? exp.tolerance,
    rtol: options?.rtol ?? exp.tolerance,
    ...(effectiveOutputIds !== undefined && { outputStringIds: effectiveOutputIds }),
    ...(options?.stlMonitors !== undefined && { stlMonitors: options.stlMonitors }),
    ...(options?.earlyTerminateOnViolation !== undefined && {
      earlyTerminateOnViolation: options.earlyTerminateOnViolation,
    }),
    ...(options?.intervalBarrierCheck !== undefined && { intervalBarrierCheck: options.intervalBarrierCheck }),
    ...(options?.onStepViolation !== undefined && { onStepViolation: options.onStepViolation }),
    ...(options?.callbacks !== undefined && { callbacks: options.callbacks }),
  });

  // ── Step 7.5: Terminate FMU subsystems ──
  sim.terminateFmuSubsystems();

  // ── Step 7: Transform to row-major output ──
  const t = rawResult.t;
  const y: number[][] = (rawResult.y as ArrayLike<number>[]).map((row) => Array.from(row));
  const { outNames, outY } = filterHiddenOutputStates(
    sim.arena,
    sim.stateVars,
    stateNames,
    y,
    effectiveOutputIds,
    options?.debug,
  );

  return {
    t,
    y: outY,
    states: outNames,
    ...(rawResult.terminatedEarly ? { terminatedEarly: true } : {}),
    ...(rawResult.safetyViolations && rawResult.safetyViolations.length > 0
      ? { safetyViolations: rawResult.safetyViolations }
      : {}),
    ...(rawResult.intervalIssues && rawResult.intervalIssues.length > 0
      ? { intervalIssues: rawResult.intervalIssues }
      : {}),
  };
}

/**
 * Orchestrates the asynchronous arena simulation pipeline (`simulateArenaAsync`)
 * with WebGPU acceleration fallback, cooperative yielding, and abort support.
 */
export async function executeArenaSimulationAsync(
  arena: DAEBuilder,
  createSimulator: (dae: DAEBuilder) => ArenaSimulatorRunnerTarget,
  options?: ArenaSimulateOptions,
): Promise<ArenaSimulationResult> {
  if (options?.vectorCausalize) {
    expandSetBasedConnectionsArena(arena);
    eliminateVectorArenaAliases(arena);
    causalizeVectorArena(arena);
  }
  if (options?.microModelica) {
    convertArenaToMicroModelica(arena);
  }

  const sim = createSimulator(arena);
  if (options?.fmuRegistry) {
    sim.fmuRegistry = options.fmuRegistry;
  }
  if (options?.fmuLoader) {
    sim.fmuLoader = options.fmuLoader;
  }
  if (options?.debuggerHook) {
    sim.debuggerHook = options.debuggerHook;
  }
  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      sim.parameters.set(name, val);
      const varIdx = arena.getVarIdxByName(name);
      if (varIdx >= 0) {
        arena.setVarStartValue(varIdx, val);
      }
    }
  }
  sim.prepare();
  arena = sim.arena;
  if (sim.isVectorMode) {
    return sim.simulateVector(options);
  }

  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const numIntervals = options?.numberOfIntervals ?? exp.numberOfIntervals;
  const step =
    options?.step ??
    (numIntervals ? (stopTime - startTime) / numIntervals : (exp.interval ?? (stopTime - startTime) / 500));

  const valuesByStringId = allocateArenaEnvBuffer(arena, true);
  const {
    stateStringIds: stateNameIds,
    derivStringIds: derivNameIds,
    stateNames,
  } = populateAndSolveInitialArenaEnv(arena, sim, valuesByStringId, startTime, {
    parameterOverrides: options?.parameterOverrides,
    initialStateOverrides: options?.initialStateOverrides,
  });

  const effectiveOutputIds = resolveEffectiveOutputIds(arena, stateNameIds, options?.outputStringIds);

  if (options?.steadyStateOnly) {
    const t = [startTime];
    const initialRow: number[] = [];
    for (const nameId of stateNameIds) {
      initialRow.push(valuesByStringId[nameId] ?? 0);
    }
    let outNames = stateNames;
    let outY = [initialRow];
    if (effectiveOutputIds) {
      outNames = effectiveOutputIds.map((id) => sim.arena.interner.resolve(id) ?? "unknown");
      outY = [effectiveOutputIds.map((id) => valuesByStringId[id] ?? 0)];
    }
    return { t, y: outY, states: outNames };
  }

  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);

  sim.initializeFmuSubsystems(startTime, stopTime, step);

  if (options?.solver === "webgpu") {
    // ── Phase 5: WebGPU Execution with Fallback ──
    const { serializeArenaForGPU } = await import("./gpu-buffers.js");
    const { WebGPUSimulationRunner } = await import("./webgpu-simulation-runner.js");

    // Create the BLT result shape expected by serializeArenaForGPU
    const bltResult = {
      blocks: sim.blocks,
      sortedEquations: sim.sortedEquations,
    };

    const buffers = serializeArenaForGPU(arena, bltResult, sim.stateVars);
    const varOffsets = buffers.varOffsets ?? arena.getVarOffsets?.();

    // Copy the initialized values into the GPU state buffer using double-single [hi, lo] stride-2 packing
    for (let i = 0; i < arena.varCount; i++) {
      const nameId = arena.getVarNameId(i);
      const val = valuesByStringId[nameId] ?? 0;
      const offset = varOffsets ? (varOffsets[i] ?? i) : i;
      const hi = Math.fround(val);
      const lo = Math.fround(val - hi);
      buffers.stateBuffer[offset * 2] = hi;
      buffers.stateBuffer[offset * 2 + 1] = lo;
    }

    const runner = new WebGPUSimulationRunner(arena, buffers);
    const initialized = await runner.initialize();

    if (initialized) {
      console.log("WebGPU simulation backend initialized successfully.");
      // If tolerances are provided, use the adaptive DOPRI5 orchestrator
      const isAdaptive = options?.atol !== undefined || options?.rtol !== undefined;

      let t: number[];
      let y: number[][];

      if (isAdaptive) {
        const outputTimes: number[] = [];
        for (let s = 0; s <= steps; s++) {
          outputTimes.push(startTime + s * step);
        }

        const stateVarsArr = Array.from(sim.stateVars);
        const y0 = new Float32Array(stateVarsArr.length);
        for (let i = 0; i < stateVarsArr.length; i++) {
          const varIdx = stateVarsArr[i] ?? -1;
          const offset = varIdx !== -1 ? (varOffsets ? (varOffsets[varIdx] ?? varIdx) : varIdx) : -1;
          y0[i] =
            offset !== -1 ? (buffers.stateBuffer[offset * 2] ?? 0) + (buffers.stateBuffer[offset * 2 + 1] ?? 0) : 0;
        }

        const result = await runner.runSimulationAdaptive(startTime, y0, stopTime, outputTimes, {
          atol: options?.atol,
          rtol: options?.rtol,
        });

        t = result.t;
        y = new Array(result.t.length);
        for (let s = 0; s < result.t.length; s++) {
          const row = new Array(stateNames.length);
          for (let j = 0; j < stateNames.length; j++) {
            row[j] = result.y[s]?.[j] ?? 0;
          }
          y[s] = row;
        }
      } else {
        const gpuResultBuffer = await runner.runSimulation(steps, step, startTime);
        t = new Array(steps + 1);
        y = new Array(steps + 1);

        const stateVarsArr = Array.from(sim.stateVars);
        for (let s = 0; s <= steps; s++) {
          t[s] = startTime + s * step;
          const row = new Array(stateNames.length);
          for (let j = 0; j < stateNames.length; j++) {
            const varIdx = stateVarsArr[j] ?? -1;
            const offset = varIdx !== -1 ? (varOffsets ? (varOffsets[varIdx] ?? varIdx) : varIdx) : -1;
            row[j] = offset !== -1 ? (gpuResultBuffer[s * buffers.varCount + offset] ?? 0) : 0;
          }
          y[s] = row;
        }
      }

      sim.terminateFmuSubsystems();
      return { t, y, states: stateNames };
    } else {
      console.warn("WebGPU initialization failed. Falling back to CPU simulation.");
    }
  }

  const defaultSolver: ArenaCpuSolver = (exp.algorithm as ArenaCpuSolver | undefined) ?? "tsit5";
  const chosenSolver: ArenaCpuSolver =
    options?.solver === "webgpu"
      ? "rk4"
      : options?.solver === "auto"
        ? ((exp.algorithm as ArenaCpuSolver | undefined) ?? "auto")
        : options?.solver
          ? options.solver
          : defaultSolver;

  const rawResult = await sim.simulateAsync(steps, step, valuesByStringId, stateNameIds, derivNameIds, {
    solver: chosenSolver,
    ...(options?.signal !== undefined && { signal: options.signal }),
    atol: options?.atol ?? exp.tolerance,
    rtol: options?.rtol ?? exp.tolerance,
    ...(effectiveOutputIds !== undefined && { outputStringIds: effectiveOutputIds }),
  });

  sim.terminateFmuSubsystems();

  const t = rawResult.t;
  const y: number[][] = rawResult.y.map((row) => Array.from(row as ArrayLike<number>));
  const { outNames, outY } = filterHiddenOutputStates(
    sim.arena,
    sim.stateVars,
    stateNames,
    y,
    effectiveOutputIds,
    options?.debug,
  );
  return { t, y: outY, states: outNames };
}
