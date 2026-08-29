// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-native Jacobian / Hessian sparsity pattern analysis.
 *
 * Computes structural sparsity patterns for the Jacobian and Hessian
 * of a DAE system represented in the ArenaDAEBuilder.
 *
 * Uses the Data-Oriented StaticTapeBuilder for dependency tracing,
 * operating entirely on arena expression IDs — no legacy AST objects.
 */

import { type CCSMatrix, buildCCS } from "../../arena-coloring.js";
import type { ArenaDAEBuilder } from "../../dae-arena.js";
import { EqKind, ExprKind } from "../../dae-arena.js";
import { StaticTapeBuilder, TAPE_DATA1, TAPE_DATA2, TAPE_OP_KIND, TAPE_STRIDE, TapeOpKind } from "../tape.js";

export { buildCCS, type CCSMatrix } from "../../arena-coloring.js";

// ─────────────────────────────────────────────────────────────────────
// Jacobian Sparsity
// ─────────────────────────────────────────────────────────────────────

/**
 * Computes the structural Jacobian sparsity pattern from an ArenaDAEBuilder.
 *
 * Rows = derivative equations (der(x) = rhs)
 * Cols = state variables (the x in der(x))
 *
 * For each equation of the form `der(x) = rhs`, the dependencies of the
 * RHS expression on state variables are traced through a StaticTapeBuilder.
 *
 * @param arena The ArenaDAEBuilder containing the flattened DAE system.
 * @returns The CCS sparsity pattern and the ordered list of state variable names.
 */
export function computeJacobianSparsityArena(arena: ArenaDAEBuilder): {
  ccs: CCSMatrix;
  states: string[];
} {
  const derEqs = extractDerEquations(arena);
  if (derEqs.length === 0) {
    return { ccs: { row_indices: [], col_ptr: [0], nnz: 0 }, states: [] };
  }

  const tape = new StaticTapeBuilder(arena.interner);

  // Collect the set of independent variables (states)
  const indepVars = new Set<string>();
  for (const eq of derEqs) {
    indepVars.add(eq.state);
  }

  // Trace dependencies for each equation's RHS
  const rowsDeps: Set<string>[] = [];
  for (const eq of derEqs) {
    const outIdx = tape.addExpression(eq.rhsExprId, arena);
    const deps = tape.getDependencies(outIdx);

    // Keep only dependencies that are state variables
    const filteredDeps = new Set<string>();
    for (const d of deps) {
      if (indepVars.has(d)) filteredDeps.add(d);
    }
    rowsDeps.push(filteredDeps);
  }

  const states = Array.from(indepVars);
  return {
    ccs: buildCCS(rowsDeps, states),
    states,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Hessian Sparsity
// ─────────────────────────────────────────────────────────────────────

/**
 * Computes the structural Hessian sparsity pattern of the Lagrangian.
 *
 * The Lagrangian is L = Σ λ_i * f_i(x), where f_i are the derivative equation RHS.
 * The Hessian ∂²L/∂x_j∂x_k is structurally non-zero when variables x_j and x_k
 * interact through a nonlinear operator in any f_i.
 *
 * Returns the lower-triangular CCS pattern suitable for IPOPT.
 *
 * @param arena The ArenaDAEBuilder containing the flattened DAE system.
 * @returns The lower-triangular CCS sparsity pattern and the ordered state list.
 */
export function computeHessianSparsityArena(arena: ArenaDAEBuilder): {
  ccs: CCSMatrix;
  states: string[];
} {
  const derEqs = extractDerEquations(arena);
  if (derEqs.length === 0) {
    return { ccs: { row_indices: [], col_ptr: [0], nnz: 0 }, states: [] };
  }

  const tape = new StaticTapeBuilder(arena.interner);

  const indepVars = new Set<string>();
  for (const eq of derEqs) indepVars.add(eq.state);
  const states = Array.from(indepVars);

  // Build the tape for each equation RHS
  const eqIndices: number[] = [];
  for (const eq of derEqs) {
    eqIndices.push(tape.addExpression(eq.rhsExprId, arena));
  }

  // Build the Lagrangian: L = Σ λ_i * f_i
  let lagrangianNode = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0.0);
  for (let i = 0; i < eqIndices.length; i++) {
    const lamVar = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern(`LAMBDA_${i}`));
    const term = tape.pushScalarOp(TapeOpKind.Mul, lamVar, eqIndices[i]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    lagrangianNode = tape.pushScalarOp(TapeOpKind.Add, lagrangianNode, term);
  }
  // lagrangianNode is used implicitly — the tape now contains the full Lagrangian structure

  // Compute per-op dependency sets (which independent variables flow into each op)
  const depsForOp = new Map<number, Set<string>>();
  for (let i = 0; i < tape.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = tape.opData[offset + TAPE_OP_KIND]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const a = tape.opData[offset + TAPE_DATA1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const b = tape.opData[offset + TAPE_DATA2]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = new Set<string>();

    if (kind === TapeOpKind.Var) {
      const name = tape.interner.resolve(a) ?? "";
      if (indepVars.has(name)) d.add(name);
    } else if (kind === TapeOpKind.VecVar) {
      const name = tape.interner.resolve(a) ?? "";
      if (indepVars.has(name)) d.add(name);
    } else {
      // Propagate dependencies from operands
      switch (kind) {
        case TapeOpKind.Add:
        case TapeOpKind.Sub:
        case TapeOpKind.Mul:
        case TapeOpKind.Div:
        case TapeOpKind.Pow: {
          const ad = depsForOp.get(a);
          if (ad) for (const v of ad) d.add(v);
          const bd = depsForOp.get(b);
          if (bd) for (const v of bd) d.add(v);
          break;
        }
        case TapeOpKind.Neg:
        case TapeOpKind.Sin:
        case TapeOpKind.Cos:
        case TapeOpKind.Tan:
        case TapeOpKind.Exp:
        case TapeOpKind.Log:
        case TapeOpKind.Sqrt: {
          const ad = depsForOp.get(a);
          if (ad) for (const v of ad) d.add(v);
          break;
        }
      }
    }
    depsForOp.set(i, d);
  }

  // Build the interaction graph: variables interact if they appear together
  // in a nonlinear operation (mul, div, pow, trig, exp, log, sqrt)
  const interactions = new Map<string, Set<string>>();
  for (const s of states) interactions.set(s, new Set([s])); // Diagonal is non-zero

  for (let i = 0; i < tape.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = tape.opData[offset + TAPE_OP_KIND]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const a = tape.opData[offset + TAPE_DATA1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const b = tape.opData[offset + TAPE_DATA2]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

    // Binary nonlinear operators: cross-interactions between deps(a) and deps(b)
    if (kind === TapeOpKind.Mul || kind === TapeOpKind.Div || kind === TapeOpKind.Pow) {
      const ad = depsForOp.get(a);
      const bd = depsForOp.get(b);
      if (ad && bd) {
        for (const v1 of ad) {
          for (const v2 of bd) {
            interactions.get(v1)?.add(v2);
            interactions.get(v2)?.add(v1);
          }
        }
      }
    }

    // Nonlinear unary operators: self-interactions among all deps
    if (
      kind === TapeOpKind.Sin ||
      kind === TapeOpKind.Cos ||
      kind === TapeOpKind.Tan ||
      kind === TapeOpKind.Exp ||
      kind === TapeOpKind.Log ||
      kind === TapeOpKind.Sqrt ||
      kind === TapeOpKind.Mul ||
      kind === TapeOpKind.Div ||
      kind === TapeOpKind.Pow
    ) {
      const ad = depsForOp.get(a);
      if (ad) {
        for (const v1 of ad) {
          for (const v2 of ad) {
            interactions.get(v1)?.add(v2);
          }
        }
      }
    }
  }

  // Build lower-triangular CCS for IPOPT
  const rowsDeps: Set<string>[] = [];
  for (let r = 0; r < states.length; r++) {
    const rowId = states[r]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = new Set<string>();
    for (let c = 0; c <= r; c++) {
      const colId = states[c]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (interactions.get(rowId)?.has(colId)) {
        d.add(colId);
      }
    }
    rowsDeps.push(d);
  }

  return {
    ccs: buildCCS(rowsDeps, states),
    states,
  };
}

// ─────────────────────────────────────────────────────────────────────
// C Code Generation
// ─────────────────────────────────────────────────────────────────────

/**
 * Emits C-code static arrays for a given CCS sparsity matrix.
 *
 * @param ccs    The CCS sparsity pattern.
 * @param prefix Variable name prefix (e.g. "ModelName_jacobian").
 * @returns Array of C code lines.
 */
export function generateSparsityArraysC(ccs: CCSMatrix, prefix: string): string[] {
  const lines: string[] = [];
  lines.push(`const int ${prefix}_nnz = ${ccs.nnz};`);
  lines.push(`const int ${prefix}_row_idx[] = {${ccs.row_indices.join(", ")}};`);
  lines.push(`const int ${prefix}_col_ptr[] = {${ccs.col_ptr.join(", ")}};`);
  return lines;
}

// ─────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────

/** A derivative equation: der(state) = rhsExprId */
interface DerEquation {
  /** The state variable name (the x in der(x)) */
  state: string;
  /** The RHS expression ID in the arena */
  rhsExprId: number;
}

/**
 * Extract derivative equations from the ArenaDAEBuilder.
 *
 * Scans all equations for the pattern `der(x) = expr` or `expr = der(x)`,
 * and returns the list of (state, rhsExprId) pairs.
 */
function extractDerEquations(arena: ArenaDAEBuilder): DerEquation[] {
  const derEqs: DerEquation[] = [];

  for (let i = 0; i < arena.eqCount; i++) {
    const kind = arena.getEqKind(i);
    if (kind !== EqKind.Simple && kind !== EqKind.Array && kind !== EqKind.InitialSimple) continue;

    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);

    const lhsState = extractDerState(arena, lhs);
    const rhsState = extractDerState(arena, rhs);

    if (lhsState) {
      // der(x) = rhs → state=x, rhs=rhs
      if (kind === EqKind.Array) {
        expandArrayDerEq(arena, lhsState, rhs, derEqs);
      } else {
        derEqs.push({ state: lhsState, rhsExprId: rhs });
      }
    } else if (rhsState) {
      // lhs = der(x) → state=x, rhs=lhs
      if (kind === EqKind.Array) {
        expandArrayDerEq(arena, rhsState, lhs, derEqs);
      } else {
        derEqs.push({ state: rhsState, rhsExprId: lhs });
      }
    }
  }

  return derEqs;
}

/**
 * Extract the state variable name from a `der(x)` expression.
 * Returns null if the expression is not a der() call.
 */
function extractDerState(arena: ArenaDAEBuilder, exprId: number): string | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);

  // Direct Der node: data1 is the inner expression
  if (kind === ExprKind.Der) {
    const innerExpr = arena.getExprData1(exprId);
    if (arena.getExprKind(innerExpr) === ExprKind.Name) {
      return arena.interner.resolve(arena.getExprData1(innerExpr)) ?? null;
    }
    return null;
  }

  // Call node with function name "der"
  if (kind === ExprKind.Call) {
    const funcNameId = arena.getExprData1(exprId);
    const funcName = arena.interner.resolve(funcNameId);
    if (funcName === "der") {
      const argCount = arena.getExprRight(exprId);
      if (argCount === 1) {
        const firstArg = arena.getExprLeft(exprId);
        if (arena.getExprKind(firstArg) === ExprKind.Name) {
          return arena.interner.resolve(arena.getExprData1(firstArg)) ?? null;
        }
      }
    }
  }

  return null;
}

/**
 * Expand an array derivative equation into scalar derivative equations.
 * For a vector state variable x[n], produces entries for x[1], x[2], ..., x[n].
 */
function expandArrayDerEq(arena: ArenaDAEBuilder, baseName: string, rhsExprId: number, out: DerEquation[]): void {
  // Try to find the variable's array dimensions
  const varIdx = arena.getVarIdxByName(baseName);
  if (varIdx >= 0) {
    const shape = arena.getVarShape(varIdx);
    if (shape.length > 0) {
      const size = shape.reduce((a, b) => a * b, 1);
      if (baseName.includes("[") || size === 1) {
        out.push({ state: baseName, rhsExprId });
      } else {
        for (let j = 0; j < size; j++) {
          out.push({ state: `${baseName}[${j + 1}]`, rhsExprId });
        }
      }
      return;
    }
  }
  // Fallback: treat as scalar
  out.push({ state: baseName, rhsExprId });
}
