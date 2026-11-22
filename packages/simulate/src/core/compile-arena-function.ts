// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Compiles a ModelScript `DAEBuilder` arena ONCE into a unified `@modelscript/solve`
 * `ModelFunction` carrying:
 *   - Out-of-place `f(t, u, p)` and allocation-free in-place `fInPlace(du, u, p, t)`
 *   - Analytical/AD Jacobian `jac(t, u, p)` via `buildAdJacobian(arena)` (when available)
 *   - Outward-rounded interval extension `fInterval(t, u, p)` via `compileArenaToDae(arena)`
 *   - State names and nominal initial state `u0`
 *
 * The exact same compiled `ModelFunction` feeds ODE/DAE simulation, Reachability,
 * Ensembles, and Optimization without duplicating compilation or losing AD/interval hooks.
 */

import { compileArenaToDae, Interval, type DAEBuilder } from "@modelscript/runtime";
import { buildAdJacobian } from "@modelscript/runtime/wasm_tape.js";
import {
  ODEProblem,
  OutwardInterval,
  ReachabilityProblem,
  type ModelFunction,
  type SafetyPropertySpec,
  type UnifiedODEProblem,
  type UnifiedReachabilityProblem,
} from "@modelscript/solve";

export interface CompiledArenaModel {
  readonly fn: ModelFunction;
  readonly u0: readonly number[];
  readonly stateNames: readonly string[];
  readonly tSpan: readonly [number, number];
}

/**
 * Compiles a `DAEBuilder` arena into a unified `ModelFunction` + initial state metadata.
 */
export function compileArenaFunction(arena: DAEBuilder): CompiledArenaModel {
  const compiled = compileArenaToDae(arena);
  if (!compiled.ok) {
    throw new Error(`compileArenaFunction: unable to compile arena to semi-explicit DAE: ${compiled.reason}`);
  }

  const { dae, stateNames, algebraicNames } = compiled.compiled;
  const n = stateNames.length;
  const nominalX = stateNames.map((name) => {
    const idx = arena.getVarIdxByName(name);
    return idx >= 0 ? (arena.getVarStartValue(idx) ?? 0) : 0;
  });
  const nominalZ = algebraicNames.map((name) => {
    const idx = arena.getVarIdxByName(name);
    return idx >= 0 ? (arena.getVarStartValue(idx) ?? 0) : 0;
  });
  const adJac = buildAdJacobian(arena);
  const algNominalIntervals = nominalZ.map((v) => new Interval(v, v));

  const f = (t: number, u: Readonly<Float64Array | number[]>): number[] => {
    const xArr = Array.isArray(u) ? u : Array.from(u);
    return dae.f(t, xArr, nominalZ);
  };

  const fInPlace = (du: Float64Array, u: Readonly<Float64Array>, _p: unknown, t: number): void => {
    const xArr = Array.from(u);
    const res = dae.f(t, xArr, nominalZ);
    for (let i = 0; i < n; i++) du[i] = res[i] ?? 0;
  };

  const jac = adJac
    ? (t: number, u: Readonly<Float64Array | number[]>): number[][] => {
        const xArr = Array.isArray(u) ? u : Array.from(u);
        return adJac(t, xArr);
      }
    : undefined;

  const fInterval = dae.fInterval
    ? (t: OutwardInterval, u: readonly OutwardInterval[]): OutwardInterval[] => {
        const tIv = new Interval(t.lo, t.hi);
        const xIv = u.map((iv) => new Interval(iv.lo, iv.hi));
        const out = dae.fInterval!(tIv, xIv, algNominalIntervals);
        return out.map((iv) => OutwardInterval.of(iv.lo, iv.hi));
      }
    : undefined;

  const exp = (arena as { experiment?: { startTime?: number; stopTime?: number } }).experiment;
  const tSpan: readonly [number, number] = [exp?.startTime ?? 0, exp?.stopTime ?? 1];

  const fn: ModelFunction = {
    f,
    fInPlace,
    jac,
    fInterval,
    stateNames,
    arenaHandle: arena,
  };

  return {
    fn,
    u0: [...nominalX],
    stateNames,
    tSpan,
  };
}

/** Convenience: builds a unified `ODEProblem` directly from a `DAEBuilder` arena. */
export function arenaToODEProblem(
  arena: DAEBuilder,
  opts?: { tSpan?: readonly [number, number]; u0?: readonly number[] },
): UnifiedODEProblem {
  const model = compileArenaFunction(arena);
  return ODEProblem(model.fn, opts?.u0 ?? model.u0, opts?.tSpan ?? model.tSpan);
}

/** Convenience: builds a unified `ReachabilityProblem` directly from a `DAEBuilder` arena. */
export function arenaToReachabilityProblem(
  arena: DAEBuilder,
  initialRadiusOrSet: number | readonly OutwardInterval[],
  opts?: { tSpan?: readonly [number, number]; properties?: readonly SafetyPropertySpec[] },
): UnifiedReachabilityProblem {
  const model = compileArenaFunction(arena);
  const initialSet: OutwardInterval[] =
    typeof initialRadiusOrSet === "number"
      ? model.u0.map((v) => OutwardInterval.of(v - initialRadiusOrSet, v + initialRadiusOrSet))
      : [...initialRadiusOrSet];
  return ReachabilityProblem(model.fn, initialSet, opts?.tSpan ?? model.tSpan, {
    properties: opts?.properties,
  });
}
