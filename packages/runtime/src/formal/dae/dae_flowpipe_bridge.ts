// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Automated Flowpipe & Barrier Bridge.
 *
 * Automatically converts flattened continuous DAE systems in DAEBuilder SoA linear arena
 * into semi-explicit DAE systems:
 *   \dot{x} = f(t, x, z)
 *   0 = g(x, z)
 *
 * Connects directly to DaeFlowpipeSolver for validated Taylor model flowpipe tubes,
 * Interval Krawczyk algebraic manifold certification, and guaranteed safety invariant verification.
 */

import {
  DaeFlowpipeOptions,
  DaeFlowpipeResult,
  DaeFlowpipeSolver,
  DaeSystem,
} from "../../analysis/wasm_dae_flowpipe.js";
import { Interval } from "../../analysis/wasm_interval.js";
import { BinOp, DAEBuilder, EqKind, ExprKind, Variability, differentiateArenaExpression } from "../../dae/wasm_dae.js";
import { NumericalInterval } from "../abstract_interpretation/interval_domain.js";
import { DaeIntervalEvaluator } from "./dae_interval_evaluator.js";

export interface LoweredDaeSystem {
  dae: DaeSystem;
  diffVarIndices: number[];
  algVarIndices: number[];
  diffVarNames: string[];
  algVarNames: string[];
}

export interface DaeFlowpipeBridgeOptions {
  tSpan: [number, number];
  dt: number;
  initialBounds?: Map<number, NumericalInterval>;
  order?: number;
}

export class DaeFlowpipeBridge {
  /**
   * Lowers a DAEBuilder arena into a validated DaeSystem format.
   */
  public static lowerDaeToSystem(
    arena: DAEBuilder,
    options?: { stateVars?: Set<number>; algVars?: Set<number> },
  ): LoweredDaeSystem {
    const diffVarIndices: number[] = [];
    const algVarIndices: number[] = [];
    const diffVarNames: string[] = [];
    const algVarNames: string[] = [];

    const diffEqMap = new Map<number, number>(); // diffVarIdx -> rhsExprId
    const algEqIndices: number[] = [];

    const stateVarSet = options?.stateVars ?? new Set<number>();
    const algVarSet = options?.algVars ?? new Set<number>();

    // 1. Identify differential equations (der(x) = expr)
    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      const kind = arena.getEqKind(eqIdx);
      if (kind !== EqKind.Simple && kind !== EqKind.InitialSimple) continue;

      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);

      if (arena.getExprKind(lhs) === ExprKind.Der) {
        const inner = arena.getExprData1(lhs);
        if (arena.getExprKind(inner) === ExprKind.Name) {
          const nameId = arena.getExprData1(inner);
          const vIdx = arena.lookupVariable(nameId);
          if (vIdx >= 0) {
            diffVarIndices.push(vIdx);
            diffVarNames.push(arena.getVarName(vIdx));
            diffEqMap.set(vIdx, rhs);
            continue;
          }
        }
      }

      // Check if RHS is der(x)
      if (arena.getExprKind(rhs) === ExprKind.Der) {
        const inner = arena.getExprData1(rhs);
        if (arena.getExprKind(inner) === ExprKind.Name) {
          const nameId = arena.getExprData1(inner);
          const vIdx = arena.lookupVariable(nameId);
          if (vIdx >= 0) {
            diffVarIndices.push(vIdx);
            diffVarNames.push(arena.getVarName(vIdx));
            diffEqMap.set(vIdx, lhs);
            continue;
          }
        }
      }

      algEqIndices.push(eqIdx);
    }

    const diffSet = new Set(diffVarIndices);

    // 2. Identify algebraic continuous variables
    for (let i = 0; i < arena.varCount; i++) {
      if (diffSet.has(i)) continue;
      const variability = arena.getVarVariability(i);
      if (variability === Variability.Continuous || algVarSet.has(i)) {
        algVarIndices.push(i);
        algVarNames.push(arena.getVarName(i));
      }
    }

    const evaluator = new DaeIntervalEvaluator(arena);

    // 3. Pre-generate symbolic Jacobians for algebraic equations: J_z[i][j] = \partial g_i / \partial z_j
    const jacobianZExprs: number[][] = [];
    const jacobianXExprs: number[][] = [];

    for (let i = 0; i < algEqIndices.length; i++) {
      const eqIdx = algEqIndices[i]!;
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      const resExpr = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);

      const rowZ: number[] = [];
      for (let j = 0; j < algVarIndices.length; j++) {
        const varIdx = algVarIndices[j]!;
        const nameId = arena.interner.intern(arena.getVarName(varIdx));
        const dExpr = differentiateArenaExpression(arena, resExpr, nameId);
        rowZ.push(dExpr);
      }
      jacobianZExprs.push(rowZ);

      const rowX: number[] = [];
      for (let j = 0; j < diffVarIndices.length; j++) {
        const varIdx = diffVarIndices[j]!;
        const nameId = arena.interner.intern(arena.getVarName(varIdx));
        const dExpr = differentiateArenaExpression(arena, resExpr, nameId);
        rowX.push(dExpr);
      }
      jacobianXExprs.push(rowX);
    }

    // Helper: evaluate expressions with a given point state
    const evaluatePointState = (exprId: number, xVals: number[], zVals: number[]): number => {
      const env = new Map<number, NumericalInterval>();
      for (let i = 0; i < diffVarIndices.length; i++) {
        env.set(diffVarIndices[i]!, NumericalInterval.const(xVals[i] ?? 0));
      }
      for (let j = 0; j < algVarIndices.length; j++) {
        env.set(algVarIndices[j]!, NumericalInterval.const(zVals[j] ?? 0));
      }
      const evalRes = evaluator.evaluateExpr(exprId, env);
      return evalRes.interval.low;
    };

    const numDiffStates = diffVarIndices.length;
    const numAlgStates = algVarIndices.length;

    const dae: DaeSystem = {
      numDiffStates,
      numAlgStates,

      f: (_t: number, x: number[], z: number[]): number[] => {
        const res: number[] = [];
        for (let i = 0; i < numDiffStates; i++) {
          const varIdx = diffVarIndices[i]!;
          const rhsExpr = diffEqMap.get(varIdx);
          if (rhsExpr !== undefined) {
            res.push(evaluatePointState(rhsExpr, x, z));
          } else {
            res.push(0.0);
          }
        }
        return res;
      },

      g: (x: number[], z: number[]): number[] => {
        const res: number[] = [];
        for (let i = 0; i < algEqIndices.length; i++) {
          const eqIdx = algEqIndices[i]!;
          const lhs = arena.getEqLhs(eqIdx);
          const rhs = arena.getEqRhs(eqIdx);
          const lhsVal = evaluatePointState(lhs, x, z);
          const rhsVal = evaluatePointState(rhs, x, z);
          res.push(lhsVal - rhsVal);
        }
        return res;
      },

      jacobianGz: (x: number[], z: number[]): number[][] => {
        const J: number[][] = [];
        for (let i = 0; i < jacobianZExprs.length; i++) {
          const row: number[] = [];
          for (let j = 0; j < numAlgStates; j++) {
            const expr = jacobianZExprs[i]![j]!;
            row.push(evaluatePointState(expr, x, z));
          }
          J.push(row);
        }
        return J;
      },

      jacobianGx: (x: number[], z: number[]): number[][] => {
        const J: number[][] = [];
        for (let i = 0; i < jacobianXExprs.length; i++) {
          const row: number[] = [];
          for (let j = 0; j < numDiffStates; j++) {
            const expr = jacobianXExprs[i]![j]!;
            row.push(evaluatePointState(expr, x, z));
          }
          J.push(row);
        }
        return J;
      },
    };

    return {
      dae,
      diffVarIndices,
      algVarIndices,
      diffVarNames,
      algVarNames,
    };
  }

  /**
   * Solves continuous flowpipe reachability directly from a DAEBuilder arena.
   */
  public static solveFlowpipe(
    arena: DAEBuilder,
    options: DaeFlowpipeBridgeOptions,
  ): DaeFlowpipeResult & { lowered: LoweredDaeSystem } {
    const lowered = this.lowerDaeToSystem(arena);
    const { dae, diffVarIndices, algVarIndices } = lowered;

    const initialX: Interval[] = [];
    const nominalX: number[] = [];
    for (const vIdx of diffVarIndices) {
      const bound = options.initialBounds?.get(vIdx) ?? new NumericalInterval(0, 0);
      initialX.push(new Interval(bound.low, bound.high));
      nominalX.push((bound.low + bound.high) / 2);
    }

    const initialZ: Interval[] = [];
    const nominalZ: number[] = [];
    for (const vIdx of algVarIndices) {
      const bound = options.initialBounds?.get(vIdx) ?? new NumericalInterval(0, 0);
      initialZ.push(new Interval(bound.low, bound.high));
      nominalZ.push((bound.low + bound.high) / 2);
    }

    const solverOpts: DaeFlowpipeOptions = {
      dae,
      initialX,
      initialZ,
      nominalX,
      nominalZ,
      tSpan: options.tSpan,
      dt: options.dt,
      order: options.order ?? 2,
    };

    const result = DaeFlowpipeSolver.solve(solverOpts);

    return {
      ...result,
      lowered,
    };
  }
}
