// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Composable Dual-Mode Automatic Differentiation Primitives for DAE Arenas.
 *
 * Implements JAX-style functional transforms directly on linear-memory DAEs:
 *   - `jvp`: Jacobian-Vector Product (Forward-mode / Push-Forward) via dual numbers
 *   - `vjp`: Vector-Jacobian Product (Reverse-mode / Pull-Back) via linear-memory adjoints
 *
 * Satisfies the exact adjoint duality identity: <jvp(v), u> = <v, vjp(u)>.
 */

import { Dual, evaluateArenaDualExpression } from "@modelscript/runtime";
import { ArenaSimulator } from "./simulate-arena.js";

export interface JvpResult {
  /** Primal value of state derivatives: f(x, p). */
  primal: Float64Array;
  /** Tangent push-forward: J_x * v_x + J_p * v_p. */
  tangent: Float64Array;
}

export interface VjpResult {
  /** Primal value of state derivatives: f(x, p). */
  primal: Float64Array;
  /** Pull-back gradient with respect to states: u^T * J_x. */
  gradX: Float64Array;
  /** Pull-back gradient with respect to parameters: u^T * J_p. */
  gradP: Map<string, number>;
}

/**
 * Jacobian-Vector Product (Forward-Mode / Push-Forward).
 *
 * Propagates tangent perturbations (v_x, v_p) through the DAE in a single forward
 * pass using dual numbers with zero tape allocations.
 *
 * @param sim - Prepared ArenaSimulator instance
 * @param states - Primal state values x
 * @param vStates - Tangent vector for states v_x (direction of perturbation)
 * @param vParams - Optional tangent vector for parameters v_p
 */
export function jvp(
  sim: ArenaSimulator,
  states: Float64Array,
  vStates: Float64Array,
  vParams?: Map<string, number>,
): JvpResult {
  const arena = sim.arena;
  const stateVarsList = Array.from(sim.stateVars);
  const numStates = stateVarsList.length;

  const envSize = Math.max(arena.interner.size + 256, 4096);
  const dualEnv = new Array<Dual>(envSize);

  // 1. Initialize environment with base evaluation
  const baseValues = new Float64Array(envSize);
  for (const [name, val] of sim.parameters) {
    baseValues[arena.interner.intern(name)] = val;
  }
  for (let i = 0; i < numStates; i++) {
    const varIdx = stateVarsList[i]!;
    const name = arena.getVarName(varIdx);
    baseValues[arena.interner.intern(name)] = states[i] ?? 0;
  }
  baseValues[arena.interner.intern("time")] = 0;
  sim.evaluateBlocks(baseValues);
  sim.evaluateDerivativeEquations(baseValues);

  // Load into dual env
  for (let sid = 0; sid < envSize; sid++) {
    dualEnv[sid] = Dual.constant(baseValues[sid] ?? 0);
  }

  // 2. Perturb states with tangent vector v_x
  for (let i = 0; i < numStates; i++) {
    const varIdx = stateVarsList[i]!;
    const nameId = arena.getVarNameId(varIdx);
    if (nameId < envSize) {
      dualEnv[nameId] = new Dual(states[i] ?? 0, vStates[i] ?? 0);
    }
  }

  // 3. Perturb parameters with tangent vector v_p (if provided)
  if (vParams) {
    for (const [pName, pDot] of vParams) {
      const pNameId = arena.interner.intern(pName);
      if (pNameId < envSize) {
        const pVal = dualEnv[pNameId]?.val ?? 0;
        dualEnv[pNameId] = new Dual(pVal, pDot);
      }
    }
  }

  // 4. Propagate dual numbers through blocks in execution order
  for (const block of sim.executionBlocks) {
    if (block.type === "single") {
      const val = evaluateArenaDualExpression(arena, block.exprId, dualEnv);
      if (val !== null) {
        const varNameId = arena.getVarNameId(block.varIdx);
        dualEnv[varNameId] = val;
      }
    } else if (block.type === "system") {
      for (let iter = 0; iter < 5; iter++) {
        for (let i = 0; i < block.vars.length; i++) {
          const varIdx = block.vars[i]!;
          const eqIdx = block.eqIdxs[i]!;
          const rhsId = arena.getEqRhs(eqIdx);
          const val = evaluateArenaDualExpression(arena, rhsId, dualEnv);
          if (val !== null) {
            const varNameId = arena.getVarNameId(varIdx);
            dualEnv[varNameId] = val;
          }
        }
      }
    }
  }

  // 5. Read primal and tangent outputs for all state derivatives
  const primal = new Float64Array(numStates);
  const tangent = new Float64Array(numStates);

  for (let i = 0; i < numStates; i++) {
    const varIdx = stateVarsList[i]!;
    const name = arena.getVarName(varIdx);
    const derId = arena.interner.intern(`der(${name})`);
    const dualDer = dualEnv[derId];
    primal[i] = dualDer ? dualDer.val : (baseValues[derId] ?? 0);
    tangent[i] = dualDer ? dualDer.dot : 0;
  }

  return { primal, tangent };
}

/**
 * Vector-Jacobian Product (Reverse-Mode / Pull-Back).
 *
 * Pulls back cotangent perturbation u through the DAE to compute parameter gradients
 * (u^T * J_p) and state gradients (u^T * J_x).
 *
 * @param sim - Prepared ArenaSimulator instance
 * @param states - Primal state values x
 * @param u - Cotangent vector u (seed vector of derivatives)
 * @param paramsToDiff - Optional list of parameter names to compute gradients for
 */
export function vjp(sim: ArenaSimulator, states: Float64Array, u: Float64Array, paramsToDiff?: string[]): VjpResult {
  const stateVarsList = Array.from(sim.stateVars);
  const numStates = stateVarsList.length;

  const stateMap = new Map<string, number>();
  for (let i = 0; i < numStates; i++) {
    const varIdx = stateVarsList[i]!;
    stateMap.set(sim.arena.getVarName(varIdx), states[i] ?? 0);
  }

  const allSeedVars = [...Array.from(stateMap.keys()), ...(paramsToDiff ?? [])];

  const { f, J } = sim.evaluateRHSWithJacobian(0, stateMap, undefined, allSeedVars);

  const primal = new Float64Array(numStates);
  for (let i = 0; i < numStates; i++) {
    const sName = sim.arena.getVarName(stateVarsList[i]!);
    primal[i] = f.get(sName) ?? 0;
  }

  // gradX = u^T * J_x
  const gradX = new Float64Array(numStates);
  for (let j = 0; j < numStates; j++) {
    const targetState = sim.arena.getVarName(stateVarsList[j]!);
    let sum = 0;
    for (let i = 0; i < numStates; i++) {
      const derState = sim.arena.getVarName(stateVarsList[i]!);
      const sens = J.get(derState)?.get(targetState) ?? 0;
      sum += (u[i] ?? 0) * sens;
    }
    gradX[j] = sum;
  }

  // gradP = u^T * J_p
  const gradP = new Map<string, number>();
  if (paramsToDiff) {
    for (const pName of paramsToDiff) {
      let sum = 0;
      for (let i = 0; i < numStates; i++) {
        const derState = sim.arena.getVarName(stateVarsList[i]!);
        const sens = J.get(derState)?.get(pName) ?? 0;
        sum += (u[i] ?? 0) * sens;
      }
      gradP.set(pName, sum);
    }
  }

  return { primal, gradX, gradP };
}
