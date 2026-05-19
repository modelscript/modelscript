// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Top-level arena simulation pipeline.
 *
 * This module provides the integration bridge between the arena-based
 * compiler output (ArenaDAEBuilder) and the arena simulator, producing
 * results in the same { t, y, states } format as the legacy ModelicaSimulator.
 *
 * Usage:
 *   const arena = new ArenaDAEBuilder();
 *   // ... flatten model into arena ...
 *   const result = simulateArena(arena);
 *   // result.t: number[], result.y: number[][], result.states: string[]
 */

import { ArenaDAEBuilder, Variability, evaluateArenaExpression } from "@modelscript/compiler";
import { solveInitialEquationsArena } from "./arena-init-solver.js";
import { ArenaSimulator } from "./arena-simulator.js";

/** Result of an arena-path simulation. */
export interface ArenaSimulationResult {
  /** Time points. */
  t: number[];
  /** State variable values at each time point (row-major: y[timeIdx][varIdx]). */
  y: number[][];
  /** Names of state variables (column headers for y). */
  states: string[];
}

/** Options for `simulateArena()`. */
export interface ArenaSimulateOptions {
  startTime?: number;
  stopTime?: number;
  /** Output interval (step size). */
  step?: number;
  /** Number of output intervals (used if `step` is not given). */
  numberOfIntervals?: number;
  /** ODE solver selection. */
  solver?: "euler" | "rk4" | "dopri5" | "bdf" | "auto";
  /** Absolute tolerance for adaptive solvers (default: 1e-6). */
  atol?: number;
  /** Relative tolerance for adaptive solvers (default: 1e-6). */
  rtol?: number;
  /** Parameter overrides (name → value). */
  parameterOverrides?: Map<string, number>;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

/**
 * Run a complete simulation using the arena-only pipeline.
 *
 * Steps:
 *   1. Build the ArenaSimulator and run `prepare()` (Pantelides, BLT, isolation)
 *   2. Initialize the Float64Array environment with parameters and start values
 *   3. Run the arena init solver (Newton-Raphson + homotopy)
 *   4. Execute the simulation (RK4 or Euler)
 *   5. Transform output into the standard `{ t, y, states }` format
 */
export function simulateArena(arena: ArenaDAEBuilder, options?: ArenaSimulateOptions): ArenaSimulationResult {
  // ── Step 1: Prepare the simulator ──
  const sim = new ArenaSimulator(arena);
  sim.prepare();

  // ── Step 2: Resolve experiment annotation defaults ──
  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const step =
    options?.step ??
    (options?.numberOfIntervals
      ? (stopTime - startTime) / options.numberOfIntervals
      : (exp.interval ?? (stopTime - startTime) / 500));

  // ── Step 3: Build the environment (Float64Array indexed by StringId) ──
  const envSize = Math.max(arena.interner.size + 256, 4096);
  const valuesByStringId = new Float64Array(envSize);

  // Set time
  const timeId = arena.interner.intern("time");
  valuesByStringId[timeId] = startTime;

  // Set parameters from the simulator's resolved parameters
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
    if (v === Variability.Parameter || v === Variability.Constant) continue;

    const nameId = arena.getVarNameId(i);
    const startVal = arena.getVarStartValue(i);
    if (startVal !== 0 || valuesByStringId[nameId] === 0) {
      valuesByStringId[nameId] = startVal;
    }

    // Evaluate start expression if present
    const exprId = arena.getVarExpression(i) as number | undefined;
    if (typeof exprId === "number" && exprId !== -1) {
      const val = evaluateArenaExpression(arena, exprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
  }

  // ── Step 4: Solve initial equations ──
  const initResult = solveInitialEquationsArena(arena, valuesByStringId);
  // Copy initial solution back
  valuesByStringId.set(initResult.valuesByStringId);

  // ── Step 5: Identify state/derivative StringIds ──
  const stateNameIds: number[] = [];
  const derivNameIds: number[] = [];
  const stateNames: string[] = [];

  for (const varIdx of sim.stateVars) {
    const name = arena.getVarName(varIdx);
    const nameId = arena.getVarNameId(varIdx);
    const derName = `der(${name})`;
    const derNameId = arena.interner.intern(derName);

    stateNameIds.push(nameId);
    derivNameIds.push(derNameId);
    stateNames.push(name);
  }

  // ── Step 6: Run simulation ──
  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);

  const rawResult = sim.simulate(steps, step, valuesByStringId, stateNameIds, derivNameIds, {
    solver: options?.solver ?? "rk4",
    ...(options?.atol !== undefined && { atol: options.atol }),
    ...(options?.rtol !== undefined && { rtol: options.rtol }),
  });

  // ── Step 7: Transform to row-major output ──
  const t = rawResult.t;
  const y: number[][] = rawResult.y.map((row) => Array.from(row));

  return { t, y, states: stateNames };
}

/**
 * Async variant of `simulateArena()` with cooperative yielding and abort support.
 */
export async function simulateArenaAsync(
  arena: ArenaDAEBuilder,
  options?: ArenaSimulateOptions,
): Promise<ArenaSimulationResult> {
  const sim = new ArenaSimulator(arena);
  sim.prepare();

  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const step =
    options?.step ??
    (options?.numberOfIntervals
      ? (stopTime - startTime) / options.numberOfIntervals
      : (exp.interval ?? (stopTime - startTime) / 500));

  const envSize = Math.max(arena.interner.size + 256, 4096);
  const valuesByStringId = new Float64Array(envSize);

  const timeId = arena.interner.intern("time");
  valuesByStringId[timeId] = startTime;

  for (const [name, val] of sim.parameters) {
    const nameId = arena.interner.intern(name);
    valuesByStringId[nameId] = val;
  }

  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;

    const nameId = arena.getVarNameId(i);
    const startVal = arena.getVarStartValue(i);
    if (startVal !== 0 || valuesByStringId[nameId] === 0) {
      valuesByStringId[nameId] = startVal;
    }

    const exprId = arena.getVarExpression(i) as number | undefined;
    if (typeof exprId === "number" && exprId !== -1) {
      const val = evaluateArenaExpression(arena, exprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
  }

  const initResult = solveInitialEquationsArena(arena, valuesByStringId);
  valuesByStringId.set(initResult.valuesByStringId);

  const stateNameIds: number[] = [];
  const derivNameIds: number[] = [];
  const stateNames: string[] = [];

  for (const varIdx of sim.stateVars) {
    const name = arena.getVarName(varIdx);
    const nameId = arena.getVarNameId(varIdx);
    const derName = `der(${name})`;
    const derNameId = arena.interner.intern(derName);

    stateNameIds.push(nameId);
    derivNameIds.push(derNameId);
    stateNames.push(name);
  }

  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);

  const rawResult = await sim.simulateAsync(steps, step, valuesByStringId, stateNameIds, derivNameIds, {
    solver: options?.solver ?? "rk4",
    ...(options?.signal !== undefined && { signal: options.signal }),
    ...(options?.atol !== undefined && { atol: options.atol }),
    ...(options?.rtol !== undefined && { rtol: options.rtol }),
  });

  const t = rawResult.t;
  const y: number[][] = rawResult.y.map((row) => Array.from(row));

  return { t, y, states: stateNames };
}
