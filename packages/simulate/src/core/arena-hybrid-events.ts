// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  EqKind,
  ExprKind,
  UnaryOp,
  VarType,
  Variability,
  evaluateArenaExpression,
  type ArenaStateMachine,
} from "@modelscript/runtime";
import { evaluateArenaRuntime } from "@modelscript/runtime/wasm_evaluator.js";
import type {
  ArenaAssertion,
  ArenaEventIndicator,
  ArenaStateMachineRuntime,
  ArenaWhenAction,
  ArenaWhenClause,
} from "./simulation.js";

export interface ArenaHybridEventsHost {
  arena: DAEBuilder;
  whenClauses: ArenaWhenClause[];
  eventIndicators: ArenaEventIndicator[];
  stateMachineRuntimes: ArenaStateMachineRuntime[];
  preValuesByStringId: Float64Array;
  sampleNextTimeByIdx: Map<number, number>;
  getBlockEvalCount(): number;
  bumpDiscreteEventEpoch(): void;
  evaluateBlocks(valuesByStringId: Float64Array): void;
  evaluateDerivativeEquations(valuesByStringId: Float64Array): void;
  executeStateMachines(valuesByStringId: Float64Array): void;
  stepFmuSubsystemsIfAny(valuesByStringId: Float64Array, currentTime: number, stepSize: number): void;
}

// ─────────────────────────────────────────────────────────────────────────
// When-Clause Extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extracts all `EqKind.When` equations and their `elsewhen` branches from the DAE arena
 * side-table into an array of `ArenaWhenClause`.
 */
export function extractArenaWhenClauses(arena: DAEBuilder): ArenaWhenClause[] {
  const whenClauses: ArenaWhenClause[] = [];
  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.getEqKind(eqIdx) !== EqKind.When) continue;

    // Read compound metadata from the side-table
    const meta = arena.getWhenEquationMeta(eqIdx);
    if (!meta) continue;

    // Main when-clause
    const actions = extractWhenActionsFromMeta(arena, meta.bodyEquations);
    if (actions.length > 0) {
      whenClauses.push({
        conditionExprId: meta.conditionExprId,
        actions,
        wasActive: false,
        groupId: eqIdx,
      } as ArenaWhenClause);
    }

    // Else-when clauses
    for (const ew of meta.elseWhenClauses) {
      const ewActions = extractWhenActionsFromMeta(arena, ew.bodyEquations);
      if (ewActions.length > 0) {
        whenClauses.push({
          conditionExprId: ew.conditionExprId,
          actions: ewActions,
          wasActive: false,
          groupId: eqIdx,
        } as ArenaWhenClause);
      }
    }
  }
  return whenClauses;
}

/**
 * Converts the body equations of a `when` or `elsewhen` clause into executable
 * discrete `reinit(var, expr)` and `assign` actions.
 */
function extractWhenActionsFromMeta(
  arena: DAEBuilder,
  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
): ArenaWhenAction[] {
  const actions: ArenaWhenAction[] = [];
  for (const body of bodyEquations) {
    if (body.kind === EqKind.FunctionCall) {
      // Function call — check for reinit(var, expr), terminate(msg), or assert(cond, msg)
      const callExprId = body.lhsExprId;
      if (arena.getExprKind(callExprId) === ExprKind.Call) {
        const funcNameId = arena.getExprData1(callExprId);
        const funcName = arena.interner.resolve(funcNameId);
        if (funcName === "reinit") {
          const argCount = arena.getExprRight(callExprId);
          if (argCount >= 2) {
            const firstArgId = arena.getExprLeft(callExprId);
            // Second arg stored in the Tuple at callExprId+1
            const secondArgId = arena.getExprLeft(callExprId + 1);
            if (arena.getExprKind(firstArgId) === ExprKind.Name) {
              const targetNameId = arena.getExprData1(firstArgId);
              actions.push({ type: "reinit", targetNameId, exprId: secondArgId });
            }
          }
        } else if (funcName === "terminate" || funcName === "assert") {
          actions.push({
            type: "assign",
            targetNameId: -1,
            exprId: callExprId,
            callType: funcName,
          } as ArenaWhenAction);
        }
      }
    } else if (body.kind === EqKind.Simple) {
      // Regular assignment: lhs = rhs
      const lhs = body.lhsExprId;
      const rhs = body.rhsExprId;
      // Check if RHS is a reinit() call
      if (arena.getExprKind(rhs) === ExprKind.Call) {
        const funcNameId = arena.getExprData1(rhs);
        const funcName = arena.interner.resolve(funcNameId);
        if (funcName === "reinit" && arena.getExprKind(lhs) === ExprKind.Name) {
          const targetNameId = arena.getExprData1(lhs);
          // reinit stored as simple eq: lhs=target, rhs=reinit(target, newValue)
          // The actual new value is the second argument of the call
          const argCount = arena.getExprRight(rhs);
          if (argCount >= 2) {
            const valueExprId = arena.getExprLeft(rhs + 1); // second arg in Tuple at rhs+1
            actions.push({ type: "reinit", targetNameId, exprId: valueExprId });
          }
          continue;
        }
      }
      if (arena.getExprKind(lhs) === ExprKind.Name) {
        const targetNameId = arena.getExprData1(lhs);
        actions.push({ type: "assign", targetNameId, exprId: rhs });
      }
    }
  }
  return actions;
}

// ─────────────────────────────────────────────────────────────────────────
// Assertion Extraction & Runtime Checking
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scans the DAE arena for `assert(condition, message [, level])` function-call equations
 * and returns extracted `ArenaAssertion` entries for runtime verification.
 */
export function extractArenaAssertions(arena: DAEBuilder): ArenaAssertion[] {
  const assertions: ArenaAssertion[] = [];
  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.getEqKind(eqIdx) !== EqKind.FunctionCall) continue;

    // FunctionCall equations store the call ExprId in lhs
    const callExprId = arena.getEqLhs(eqIdx);
    if (arena.getExprKind(callExprId) !== ExprKind.Call) continue;

    const funcNameId = arena.getExprData1(callExprId);
    const funcName = arena.interner.resolve(funcNameId);
    if (funcName !== "assert") continue;

    // assert(condition, message [, level]): arg0=cond, arg1=msg, arg2=level
    const argCount = arena.getExprRight(callExprId);
    const firstArg = arena.getExprLeft(callExprId); // condition ExprId
    const secondArg = argCount >= 2 ? arena.getExprLeft(callExprId + 1) : -1; // message ExprId
    const thirdArg = argCount >= 3 ? arena.getExprLeft(callExprId + 2) : -1; // level ExprId

    let level: "warning" | "error" | undefined = "error";
    let levelExprId: number | undefined;
    if (thirdArg !== -1) {
      const k3 = arena.getExprKind(thirdArg);
      if (k3 === ExprKind.EnumLiteral) {
        const enumPath = arena.interner.resolve(arena.getExprLeft(thirdArg));
        const ordinal = arena.getExprData1(thirdArg);
        level = enumPath?.endsWith(".warning") || ordinal === 1 ? "warning" : "error";
      } else if (k3 === ExprKind.Name) {
        const litName = arena.interner.resolve(arena.getExprData1(thirdArg));
        if (litName === "AssertionLevel.warning" || litName === "warning") {
          level = "warning";
        } else if (litName === "AssertionLevel.error" || litName === "error") {
          level = "error";
        } else {
          level = undefined;
          levelExprId = thirdArg;
        }
      } else {
        level = undefined;
        levelExprId = thirdArg;
      }
    }

    assertions.push({
      conditionExprId: firstArg,
      messageExprId: secondArg,
      level,
      levelExprId,
    });
  }
  return assertions;
}

/**
 * Formats a Modelica assertion message expression (supporting StringLiteral,
 * string `+` concatenation, and `String(...)` calls).
 */
export function formatArenaAssertionMessage(
  arena: DAEBuilder,
  exprId: number,
  valuesByStringId: Float64Array,
  depth = 0,
): string {
  if (exprId < 0 || depth > 16) return "";
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.StringLiteral) {
    return arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
  }
  if (kind === ExprKind.Binary && arena.getExprData1(exprId) === BinOp.Add) {
    const l = formatArenaAssertionMessage(arena, arena.getExprLeft(exprId), valuesByStringId, depth + 1);
    const r = formatArenaAssertionMessage(arena, arena.getExprRight(exprId), valuesByStringId, depth + 1);
    return `${l}${r}`;
  }
  if (kind === ExprKind.Call) {
    const fn = arena.interner.resolve(arena.getExprData1(exprId));
    const argc = arena.getExprRight(exprId);
    if (fn === "String" && argc >= 1) {
      const arg0 = arena.getExprLeft(exprId);
      if (arena.getExprKind(arg0) === ExprKind.StringLiteral) {
        return arena.interner.resolve(arena.getExprData1(arg0)) ?? "";
      }
      return String(evaluateArenaRuntime(arena, arg0, valuesByStringId));
    }
  }
  return String(evaluateArenaRuntime(arena, exprId, valuesByStringId));
}

/**
 * Evaluates all extracted Modelica `assert(condition, message [, level])` clauses at time `t`
 * and throws an error for AssertionLevel.error (or warns once for AssertionLevel.warning).
 */
export function checkArenaAssertions(
  arena: DAEBuilder,
  assertions: ArenaAssertion[],
  warnedAssertions: WeakSet<ArenaAssertion>,
  valuesByStringId: Float64Array,
  t: number,
): void {
  for (const assertion of assertions) {
    const condVal = evaluateArenaRuntime(arena, assertion.conditionExprId, valuesByStringId);
    if (condVal === 0) {
      let level = assertion.level;
      if (!level && assertion.levelExprId !== undefined) {
        const lv = evaluateArenaRuntime(arena, assertion.levelExprId, valuesByStringId);
        level = lv === 1 ? "warning" : "error";
      }
      const detail =
        assertion.messageExprId !== -1
          ? formatArenaAssertionMessage(arena, assertion.messageExprId, valuesByStringId)
          : "";
      if (level === "warning") {
        if (!warnedAssertions.has(assertion)) {
          warnedAssertions.add(assertion);
          console.warn(detail ? `Assertion warning at t=${t}: ${detail}` : `Assertion warning at t=${t}`);
        }
        continue;
      }
      const msg = detail ? `Assertion failed at t=${t}: ${detail}` : `Assertion failed at t=${t}`;
      throw new Error(msg);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Event Indicator Extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Structural equality comparison for DAE arena expressions.
 */
export function areArenaExprsEqual(arena: DAEBuilder, id1: number, id2: number): boolean {
  if (id1 === id2) return true;
  if (id1 < 0 || id2 < 0) return false;
  const k1 = arena.getExprKind(id1);
  const k2 = arena.getExprKind(id2);
  if (k1 !== k2) return false;
  if (arena.getExprData1(id1) !== arena.getExprData1(id2)) return false;
  switch (k1) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.Name:
      return true;
    case ExprKind.Unary:
    case ExprKind.Negate:
      return areArenaExprsEqual(arena, arena.getExprLeft(id1), arena.getExprLeft(id2));
    case ExprKind.Binary:
    case ExprKind.IfElse:
      return (
        areArenaExprsEqual(arena, arena.getExprLeft(id1), arena.getExprLeft(id2)) &&
        areArenaExprsEqual(arena, arena.getExprRight(id1), arena.getExprRight(id2))
      );
    case ExprKind.Call: {
      const left1 = arena.getExprLeft(id1);
      const left2 = arena.getExprLeft(id2);
      const right1 = arena.getExprRight(id1);
      const right2 = arena.getExprRight(id2);
      if (right1 !== right2) return false;
      for (let a = 0; a < right1; a++) {
        const arg1 = a === 0 ? left1 : arena.getExprLeft(id1 + a);
        const arg2 = a === 0 ? left2 : arena.getExprLeft(id2 + a);
        if (!areArenaExprsEqual(arena, arg1, arg2)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Checks whether an expression references time or any continuous/discrete state/algebraic variable.
 * If false, the expression is composed purely of constants and parameters and cannot cross zero.
 */
export function exprHasContinuousVars(arena: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId));
    if (name === "time") return true;
    const vIdx = arena.getVarIdxByName(name);
    if (vIdx >= 0) {
      const v = arena.getVarVariability(vIdx);
      if (v !== Variability.Parameter && v !== Variability.Constant) return true;
    }
    return false;
  }
  if (kind === ExprKind.Binary) {
    return (
      exprHasContinuousVars(arena, arena.getExprLeft(exprId)) ||
      exprHasContinuousVars(arena, arena.getExprRight(exprId))
    );
  }
  if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
    return exprHasContinuousVars(arena, arena.getExprLeft(exprId));
  }
  if (kind === ExprKind.IfElse) {
    return (
      exprHasContinuousVars(arena, arena.getExprLeft(exprId)) ||
      exprHasContinuousVars(arena, arena.getExprRight(exprId))
    );
  }
  if (kind === ExprKind.Call) {
    const fnName = arena.interner.resolve(arena.getExprData1(exprId));
    if (fnName === "sample") return true;
    const argc = arena.getExprRight(exprId);
    const firstArg = arena.getExprLeft(exprId);
    for (let a = 0; a < argc; a++) {
      const argId = a === 0 ? firstArg : arena.getExprLeft(exprId + a);
      if (exprHasContinuousVars(arena, argId)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Checks whether an event indicator is a time event `time - T_const` with a constant threshold
 * that lies strictly outside the simulation interval [startTime, stopTime].
 */
export function isInactiveTimeEvent(arena: DAEBuilder, parameters: Map<string, number>, exprId: number): boolean {
  const kind = arena.getExprKind(exprId);
  if (kind !== ExprKind.Binary) return false;
  const op = arena.getExprData1(exprId);
  if (op !== BinOp.Sub) return false;
  const leftId = arena.getExprLeft(exprId);
  const rightId = arena.getExprRight(exprId);
  let timeSide = 0;
  if (arena.getExprKind(leftId) === ExprKind.Name && arena.interner.resolve(arena.getExprData1(leftId)) === "time") {
    timeSide = 1;
  } else if (
    arena.getExprKind(rightId) === ExprKind.Name &&
    arena.interner.resolve(arena.getExprData1(rightId)) === "time"
  ) {
    timeSide = 2;
  }
  if (timeSide === 0) return false;
  const constSideId = timeSide === 1 ? rightId : leftId;
  if (exprHasContinuousVars(arena, constSideId)) return false;

  const constVal = evaluateArenaExpression(arena, constSideId, parameters);
  if (typeof constVal !== "number" || !isFinite(constVal)) return false;

  const startTime = arena.experiment.startTime ?? 0;
  const stopTime = arena.experiment.stopTime ?? 10;
  if (constVal < startTime - 1e-6 || constVal > stopTime + 1e-6) {
    return true;
  }
  return false;
}

/**
 * Recursively collect continuous zero-crossing indicators from a condition expression.
 *
 * Handles relational expressions (Lt, Lte, Gt, Gte, Eq, Neq) by creating `lhs - rhs`
 * synthetic subtraction expressions with appropriate crossing directions.
 * Decomposes logical expressions (And, Or, Not) so that every continuous boundary
 * participating in a compound when-condition is registered as a zero-crossing indicator.
 */
export function collectArenaEventIndicators(
  arena: DAEBuilder,
  condExprId: number,
  inverted = false,
): { exprId: number; direction: -1 | 0 | 1 }[] {
  const kind = arena.getExprKind(condExprId);
  if (kind === ExprKind.Call) {
    const fnName = arena.interner.resolve(arena.getExprData1(condExprId));
    if (fnName === "noEvent" || fnName === "smooth") return [];
  }
  if (kind === ExprKind.IfElse) {
    const tId = arena.getExprLeft(condExprId);
    const eId = arena.getExprRight(condExprId);
    return [...collectArenaEventIndicators(arena, tId, inverted), ...collectArenaEventIndicators(arena, eId, inverted)];
  }
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(condExprId) as BinOp;
    if (op === BinOp.And || op === BinOp.Or) {
      const lhsId = arena.getExprLeft(condExprId);
      const rhsId = arena.getExprRight(condExprId);
      return [
        ...collectArenaEventIndicators(arena, lhsId, inverted),
        ...collectArenaEventIndicators(arena, rhsId, inverted),
      ];
    }
    if (
      op === BinOp.Lt ||
      op === BinOp.Lte ||
      op === BinOp.Gt ||
      op === BinOp.Gte ||
      op === BinOp.Eq ||
      op === BinOp.Neq
    ) {
      const lhsId = arena.getExprLeft(condExprId);
      const rhsId = arena.getExprRight(condExprId);
      const exprId = arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
      let direction: -1 | 0 | 1 = 0;
      if (op === BinOp.Lt || op === BinOp.Lte) {
        direction = inverted ? 1 : -1;
      } else if (op === BinOp.Gt || op === BinOp.Gte) {
        direction = inverted ? -1 : 1;
      }
      return [{ exprId, direction }];
    }
  } else if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(condExprId) as UnaryOp;
    if (op === UnaryOp.Not) {
      const argId = arena.getExprLeft(condExprId);
      return collectArenaEventIndicators(arena, argId, !inverted);
    }
  }
  if (kind === ExprKind.Name || kind === ExprKind.IntLiteral || kind === ExprKind.RealLiteral) {
    return [];
  }
  return [{ exprId: condExprId, direction: 0 }];
}

/**
 * Collects all continuous zero-crossing event indicators from `when` conditions,
 * `if` equations, and `if-then-else` expressions (excluding sub-expressions wrapped in `noEvent()`).
 */
export function extractArenaEventIndicators(
  arena: DAEBuilder,
  whenClauses: ArenaWhenClause[],
  parameters: Map<string, number>,
): ArenaEventIndicator[] {
  const eventIndicators: ArenaEventIndicator[] = [];
  for (let cIdx = 0; cIdx < whenClauses.length; cIdx++) {
    const clause = whenClauses[cIdx]!;
    const indicators = collectArenaEventIndicators(arena, clause.conditionExprId);
    for (const ind of indicators) {
      if (!exprHasContinuousVars(arena, ind.exprId)) continue;
      if (isInactiveTimeEvent(arena, parameters, ind.exprId)) continue;
      let existing = eventIndicators.find(
        (e) => areArenaExprsEqual(arena, e.exprId, ind.exprId) && e.direction === ind.direction,
      );
      if (!existing) {
        existing = { exprId: ind.exprId, prevValue: 0, direction: ind.direction, clauseIndices: [] };
        eventIndicators.push(existing);
      }
      const clauseIndices: number[] = existing.clauseIndices ?? (existing.clauseIndices = []);
      if (!clauseIndices.includes(cIdx)) {
        clauseIndices.push(cIdx);
      }
    }
  }

  const addIfIndicator = (condId: number): void => {
    if (condId < 0) return;
    for (const ind of collectArenaEventIndicators(arena, condId)) {
      if (!exprHasContinuousVars(arena, ind.exprId)) continue;
      if (isInactiveTimeEvent(arena, parameters, ind.exprId)) continue;
      let existing = eventIndicators.find(
        (e) => areArenaExprsEqual(arena, e.exprId, ind.exprId) && e.direction === ind.direction,
      );
      if (!existing) {
        existing = { exprId: ind.exprId, prevValue: 0, direction: ind.direction, clauseIndices: [] };
        eventIndicators.push(existing);
      }
    }
  };

  const scanIfElseExpr = (exprId: number): void => {
    if (exprId < 0) return;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Call) {
      const fnName = arena.interner.resolve(arena.getExprData1(exprId));
      if (fnName === "noEvent" || fnName === "smooth") return;
      if (fnName === "sample") {
        addIfIndicator(exprId);
      }
      const argc = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      for (let a = 0; a < argc; a++) {
        scanIfElseExpr(a === 0 ? firstArg : arena.getExprLeft(exprId + a));
      }
      return;
    }
    if (kind === ExprKind.IfElse) {
      addIfIndicator(arena.getExprData1(exprId));
      scanIfElseExpr(arena.getExprLeft(exprId));
      scanIfElseExpr(arena.getExprRight(exprId));
      return;
    }
    if (kind === ExprKind.Binary) {
      scanIfElseExpr(arena.getExprLeft(exprId));
      scanIfElseExpr(arena.getExprRight(exprId));
    } else if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      scanIfElseExpr(arena.getExprLeft(exprId));
    }
  };

  const boolVarNameIds = new Set<number>();
  for (let v = 0; v < arena.varCount; v++) {
    if (arena.getVarType(v) === VarType.Boolean) {
      boolVarNameIds.add(arena.getVarNameId(v));
    }
  }

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.isEqRemoved(eqIdx) || arena.isEqInitial(eqIdx)) continue;
    const eqKind = arena.getEqKind(eqIdx);
    if (eqKind === EqKind.Simple) {
      const lhsId = arena.getEqLhs(eqIdx);
      const rhsId = arena.getEqRhs(eqIdx);
      scanIfElseExpr(lhsId);
      scanIfElseExpr(rhsId);
      if (arena.getExprKind(lhsId) === ExprKind.Name && boolVarNameIds.has(arena.getExprData1(lhsId))) {
        addIfIndicator(rhsId);
      }
    } else if (eqKind === EqKind.If) {
      const meta = arena.getIfEquationMeta?.(eqIdx) as
        { branches?: { conditionExprId?: number | undefined }[] | undefined } | undefined;
      if (meta?.branches) {
        for (const branch of meta.branches) {
          if (typeof branch.conditionExprId === "number" && branch.conditionExprId >= 0) {
            addIfIndicator(branch.conditionExprId);
          }
        }
      }
    }
  }
  return eventIndicators;
}

// ─────────────────────────────────────────────────────────────────────────
// State Machine Extraction & Execution (Modelica 3.3 §17)
//
// Transition semantics:
//   immediate=true  → fires at the CURRENT event instant when condition becomes true
//   immediate=false → fires at the NEXT event instant after condition was true (deferred)
//
// synchronize=true → transition only fires when ALL sub-state machines
//                    of the source state have reached a final state
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initializes runtime state-machine hierarchies from the Modelica 3.3
 * synchronous state machines registered in the DAE arena.
 */
export function extractArenaStateMachines(arena: DAEBuilder): ArenaStateMachineRuntime[] {
  const runtimes: ArenaStateMachineRuntime[] = [];
  for (const sm of arena.stateMachines) {
    runtimes.push(buildStateMachineRuntime(sm));
  }
  return runtimes;
}

/** Recursively build a runtime for a state machine and any nested sub-state machines. */
export function buildStateMachineRuntime(sm: ArenaStateMachine): ArenaStateMachineRuntime {
  const stateOrdinals = new Map<string, number>();
  for (let i = 0; i < sm.states.length; i++) {
    const state = sm.states[i];
    if (state) stateOrdinals.set(state.name, i);
  }

  // Recursively build children for each state that has sub-state machines
  const children: ArenaStateMachineRuntime[] = [];
  for (const state of sm.states) {
    if (state.stateMachines) {
      for (const childSm of state.stateMachines) {
        children.push(buildStateMachineRuntime(childSm));
      }
    }
  }

  return {
    def: sm,
    activeState: sm.initialState,
    previousState: sm.initialState,
    ticksInState: 0,
    timeInState: 0,
    deferredConditions: new Array(sm.transitions.length).fill(false),
    stateOrdinals,
    children,
  };
}

/**
 * Executes one tick of all top-level synchronous state machine runtimes.
 * Returns the updated `prevStateMachineTime`.
 */
export function executeArenaStateMachines(
  arena: DAEBuilder,
  stateMachineRuntimes: ArenaStateMachineRuntime[],
  valuesByStringId: Float64Array,
  preValuesByStringId: Float64Array,
  prevStateMachineTime: number,
): number {
  if (stateMachineRuntimes.length === 0) return prevStateMachineTime;
  const timeId = arena.interner.intern("time");
  const t = valuesByStringId[timeId] ?? 0;
  const dt = prevStateMachineTime >= 0 ? Math.max(0, t - prevStateMachineTime) : 0;

  for (const rt of stateMachineRuntimes) {
    executeSingleStateMachine(arena, rt, valuesByStringId, preValuesByStringId, dt);
  }
  return t;
}

/**
 * Evaluates priority-ordered transitions, active-state equations, nested sub-automata,
 * and Modelica 3.3 state machine intrinsics (`activeState`, `ticksInState`, `timeInState`, `previousState`)
 * for a single state machine runtime.
 */
function executeSingleStateMachine(
  arena: DAEBuilder,
  rt: ArenaStateMachineRuntime,
  valuesByStringId: Float64Array,
  preValuesByStringId: Float64Array,
  dt: number,
): void {
  // ── Phase 1: Evaluate transitions from the current active state (priority-ordered) ──
  let transitioned = false;
  for (let ti = 0; ti < rt.def.transitions.length; ti++) {
    const tr = rt.def.transitions[ti];
    if (!tr) continue;
    if (tr.fromState !== rt.activeState) continue;

    const condVal = evaluateArenaRuntime(arena, tr.conditionExprId, valuesByStringId, preValuesByStringId);
    const condTrue = condVal !== 0;

    // Synchronize guard: if synchronize=true, only fire when all child state
    // machines in the current state have reached a final state (no outgoing transitions)
    if (condTrue && tr.synchronize && rt.children.length > 0) {
      const allFinal = rt.children.every((child) => {
        // A child SM is in a "final" state when no transitions can fire from its active state
        return !child.def.transitions.some((ct) => ct.fromState === child.activeState);
      });
      if (!allFinal) continue; // Not ready — skip this transition
    }

    let shouldFire: boolean;
    if (tr.immediate) {
      // Immediate: fires at the current event instant
      shouldFire = condTrue;
    } else {
      // Deferred: fires only if the condition was true at the *previous* event instant
      shouldFire = rt.deferredConditions[ti] ?? false;
    }

    // Update deferred condition tracking for next iteration
    rt.deferredConditions[ti] = condTrue;

    if (shouldFire) {
      // Transition fires
      rt.previousState = rt.activeState;
      rt.activeState = tr.toState;
      rt.ticksInState = 0;
      rt.timeInState = 0;

      // Apply reset: initialize variables of the destination state
      if (tr.reset) {
        const destState = rt.def.states.find((s) => s.name === tr.toState);
        if (destState) {
          for (const v of destState.variables) {
            valuesByStringId[v.nameId] = v.startValue;
          }
          // Also reset child state machines within the destination state
          if (destState.stateMachines) {
            for (const childSm of destState.stateMachines) {
              const childRt = rt.children.find((c) => c.def.name === childSm.name);
              if (childRt) {
                childRt.activeState = childSm.initialState;
                childRt.previousState = childSm.initialState;
                childRt.ticksInState = 0;
                childRt.timeInState = 0;
                childRt.deferredConditions.fill(false);
              }
            }
          }
        }
      }

      transitioned = true;
      break; // Only one transition per tick (highest priority wins)
    }
  }

  if (!transitioned) {
    rt.ticksInState++;
    rt.timeInState += dt;
  }

  // ── Phase 2: Activate equations for the current state ──
  const activeStateDef = rt.def.states.find((s) => s.name === rt.activeState);
  if (activeStateDef) {
    for (const eq of activeStateDef.equations) {
      const val = evaluateArenaRuntime(arena, eq.exprId, valuesByStringId, preValuesByStringId);
      if (eq.isDerivative) {
        // For derivative equations: write to der(varName)
        const varName = arena.interner.resolve(eq.targetNameId);
        const derNameId = arena.interner.intern(`der(${varName})`);
        valuesByStringId[derNameId] = isFinite(val) ? val : 0;
      } else {
        valuesByStringId[eq.targetNameId] = isFinite(val) ? val : 0;
      }
    }
  }

  // ── Phase 3: Recursively execute child state machines of the active state ──
  if (activeStateDef?.stateMachines) {
    for (const childSm of activeStateDef.stateMachines) {
      const childRt = rt.children.find((c) => c.def.name === childSm.name);
      if (childRt) {
        executeSingleStateMachine(arena, childRt, valuesByStringId, preValuesByStringId, dt);
      }
    }
  }

  // ── Phase 4: Expose state machine intrinsics ──
  // activeState(sm) → ordinal of current active state (0-indexed)
  const activeStateIntrinsicId = arena.interner.intern(`$activeState(${rt.def.name})`);
  valuesByStringId[activeStateIntrinsicId] = rt.stateOrdinals.get(rt.activeState) ?? 0;

  // ticksInState(sm) → integer tick count
  const ticksIntrinsicId = arena.interner.intern(`$ticksInState(${rt.def.name})`);
  valuesByStringId[ticksIntrinsicId] = rt.ticksInState;

  // timeInState(sm) → real-valued time spent in current state
  const timeInStateId = arena.interner.intern(`$timeInState(${rt.def.name})`);
  valuesByStringId[timeInStateId] = rt.timeInState;

  // previousState(sm) → ordinal of previously active state
  const prevStateId = arena.interner.intern(`$previousState(${rt.def.name})`);
  valuesByStringId[prevStateId] = rt.stateOrdinals.get(rt.previousState) ?? 0;

  // Per-state boolean activeState(stateName) and scoped counters
  for (const state of rt.def.states) {
    const isAct = state.name === rt.activeState ? 1 : 0;
    valuesByStringId[arena.interner.intern(`$activeState(${state.name})`)] = isAct;
    valuesByStringId[arena.interner.intern(`$ticksInState(${state.name})`)] = isAct ? rt.ticksInState : 0;
    valuesByStringId[arena.interner.intern(`$timeInState(${state.name})`)] = isAct ? rt.timeInState : 0;
    if (rt.def.name) {
      valuesByStringId[arena.interner.intern(`$activeState(${rt.def.name}.${state.name})`)] = isAct;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// When-Clause Event Handling & Zero-Crossing Bridges
// ─────────────────────────────────────────────────────────────────────────

/** Checks whether an expression tree contains a `sample(...)` call. */
export function exprHasSampleCall(arena: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = arena.getExprKind(exprId);
  if (k === ExprKind.Call) {
    const fn = arena.interner.resolve(arena.getExprData1(exprId));
    if (fn === "sample") return true;
    const argc = arena.getExprRight(exprId);
    const first = arena.getExprLeft(exprId);
    for (let a = 0; a < argc; a++) {
      if (exprHasSampleCall(arena, a === 0 ? first : arena.getExprLeft(exprId + a))) return true;
    }
    return false;
  }
  if (k === ExprKind.Binary) {
    return exprHasSampleCall(arena, arena.getExprLeft(exprId)) || exprHasSampleCall(arena, arena.getExprRight(exprId));
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    return exprHasSampleCall(arena, arena.getExprLeft(exprId));
  }
  if (k === ExprKind.IfElse) {
    return (
      exprHasSampleCall(arena, arena.getExprData1(exprId)) ||
      exprHasSampleCall(arena, arena.getExprLeft(exprId)) ||
      exprHasSampleCall(arena, arena.getExprRight(exprId))
    );
  }
  return false;
}

/**
 * Processes discrete `when` and `elsewhen` clauses using rising-edge detection
 * (`isActive && !clause.wasActive`) with bounded fixed-point event iteration.
 */
export function processArenaWhenClauses(host: ArenaHybridEventsHost, valuesByStringId: Float64Array): void {
  if (host.whenClauses.length === 0) return;
  let totalFired = false;
  const firedGroups = new Set<number>();
  for (let iter = 0; iter < 10; iter++) {
    if (iter > 0 && host.preValuesByStringId && host.preValuesByStringId.length === valuesByStringId.length) {
      host.preValuesByStringId.set(valuesByStringId);
    }
    let anyFired = false;
    for (const clause of host.whenClauses) {
      const groupId = clause.groupId;
      const condVal = evaluateArenaRuntime(
        host.arena,
        clause.conditionExprId,
        valuesByStringId,
        host.preValuesByStringId,
      );
      const isActive = condVal !== 0;

      if (groupId !== undefined && firedGroups.has(groupId)) {
        clause.wasActive = isActive;
        continue;
      }

      // Rising edge detection
      if (isActive && !clause.wasActive) {
        anyFired = true;
        totalFired = true;
        if (groupId !== undefined) firedGroups.add(groupId);
        for (const action of clause.actions) {
          if (action.targetNameId < 0) continue;
          const val = evaluateArenaRuntime(host.arena, action.exprId, valuesByStringId, host.preValuesByStringId);
          valuesByStringId[action.targetNameId] = val;
        }
        if (exprHasSampleCall(host.arena, clause.conditionExprId)) {
          clause.wasActive = false;
        } else {
          const postCondVal = evaluateArenaRuntime(
            host.arena,
            clause.conditionExprId,
            valuesByStringId,
            host.preValuesByStringId,
          );
          clause.wasActive = postCondVal !== 0;
        }
      } else {
        clause.wasActive = isActive;
      }
    }
    if (!anyFired) break;
    host.bumpDiscreteEventEpoch();
    host.evaluateBlocks(valuesByStringId);
  }
  if (totalFired && host.preValuesByStringId && host.preValuesByStringId.length === valuesByStringId.length) {
    host.preValuesByStringId.set(valuesByStringId);
  }
}

/**
 * Constructs scalar zero-crossing indicator callbacks $g_i(t, y)$ for all extracted
 * relational and `sample(start, interval)` event indicators.
 */
export function buildArenaEventFunctions(
  host: ArenaHybridEventsHost,
  valuesByStringId: Float64Array,
  stateStringIds: number[],
  timeId: number,
): ((t: number, y: number[]) => number)[] {
  if (host.eventIndicators.length === 0) return [];
  const n = stateStringIds.length;
  let lastEvalT = NaN;
  let lastEvalGen = -1;
  const lastEvalY = new Float64Array(n);
  lastEvalY.fill(NaN);

  const syncEnv = (t: number, y: number[]): void => {
    let same = t === lastEvalT && lastEvalGen === host.getBlockEvalCount();
    if (same) {
      for (let i = 0; i < n; i++) {
        if ((y[i] ?? 0) !== lastEvalY[i]) {
          same = false;
          break;
        }
      }
    }
    if (!same) {
      lastEvalT = t;
      valuesByStringId[timeId] = t;
      for (let i = 0; i < n; i++) {
        const v = y[i] ?? 0;
        lastEvalY[i] = v;
        valuesByStringId[stateStringIds[i] ?? -1] = v;
      }
      host.evaluateBlocks(valuesByStringId);
      host.evaluateDerivativeEquations(valuesByStringId);
      lastEvalGen = host.getBlockEvalCount();
    }
  };

  host.sampleNextTimeByIdx.clear();
  return host.eventIndicators.map((ei, eiIdx) => {
    const kind = host.arena.getExprKind(ei.exprId);
    const isSampleCall =
      kind === ExprKind.Call &&
      host.arena.interner.resolve(host.arena.getExprData1(ei.exprId)) === "sample" &&
      host.arena.getExprRight(ei.exprId) >= 2;
    const sampleStartExprId = isSampleCall ? host.arena.getExprLeft(ei.exprId) : -1;
    const sampleIntervalExprId = isSampleCall ? host.arena.getExprLeft(ei.exprId + 1) : -1;

    return (t: number, y: number[]): number => {
      syncEnv(t, y);
      if (isSampleCall) {
        const start = evaluateArenaRuntime(host.arena, sampleStartExprId, valuesByStringId);
        const interval = evaluateArenaRuntime(host.arena, sampleIntervalExprId, valuesByStringId);
        if (interval <= 0) return -1;
        let nextSample = host.sampleNextTimeByIdx.get(eiIdx);
        if (nextSample === undefined) {
          if (t < start - 1e-9) {
            nextSample = start;
          } else if (Math.abs(t - start) <= 1e-9) {
            nextSample = start + interval;
          } else {
            nextSample = start + Math.ceil((t - start - 1e-9) / interval) * interval;
          }
          host.sampleNextTimeByIdx.set(eiIdx, nextSample);
        }
        return t - nextSample;
      }
      return evaluateArenaRuntime(host.arena, ei.exprId, valuesByStringId, host.preValuesByStringId);
    };
  });
}

/**
 * Constructs the event-handling callback invoked by adaptive solvers when a zero-crossing
 * root is located, executing state machines, `when`-clause `reinit`/assignment actions,
 * and zero-crossing surface projection.
 */
export function buildArenaEventCallback(
  host: ArenaHybridEventsHost,
  valuesByStringId: Float64Array,
  stateStringIds: number[],
  timeId: number,
  onEventCompleted?: (t: number) => void,
): (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[] {
  const n = stateStringIds.length;
  return (t: number, y: number[], eventIdx: number, dir: 1 | -1): number[] => {
    // Write state at event time
    valuesByStringId[timeId] = t;
    for (let i = 0; i < n; i++) {
      valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
    }
    // Evaluate blocks and derivative equations at the event state
    host.evaluateBlocks(valuesByStringId);
    host.evaluateDerivativeEquations(valuesByStringId);
    if (host.preValuesByStringId && host.preValuesByStringId.length === valuesByStringId.length) {
      host.preValuesByStringId.set(valuesByStringId);
    }
    host.executeStateMachines(valuesByStringId);
    host.bumpDiscreteEventEpoch();

    // Discrete event limit handling:
    // When a zero-crossing indicator triggers, the solver root-finder has located
    // the event boundary to ~1e-12 precision. Due to floating-point truncation,
    // strict inequalities (e.g. h < 0) evaluated at the exact root could be +1e-14 (evaluating to false).
    // We evaluate boolean combinations (and, or, not) faithfully while resolving relational atomic
    // conditions at the zero-crossing boundary (|lhs - rhs| <= 1e-7) using the crossing direction `dir`.
    let triggeredClauseIndices: number[] | undefined;
    const triggeredClauseSet = new Set<number>();
    const triggeredEi =
      eventIdx >= 0 && eventIdx < host.eventIndicators.length ? host.eventIndicators[eventIdx] : undefined;
    if (triggeredEi) {
      triggeredClauseIndices = triggeredEi.clauseIndices;
      if (triggeredClauseIndices) {
        for (const cIdx of triggeredClauseIndices) {
          triggeredClauseSet.add(cIdx);
        }
      }
    }

    const evalConditionAtEventRoot = (condExprId: number): number => {
      if (condExprId < 0) return 0;
      const kind = host.arena.getExprKind(condExprId);
      if (kind === ExprKind.Unary) {
        const op = host.arena.getExprData1(condExprId) as UnaryOp;
        if (op === UnaryOp.Not) {
          return evalConditionAtEventRoot(host.arena.getExprLeft(condExprId)) === 0 ? 1 : 0;
        }
      }
      if (kind === ExprKind.Binary) {
        const op = host.arena.getExprData1(condExprId) as BinOp;
        if (op === BinOp.And) {
          return evalConditionAtEventRoot(host.arena.getExprLeft(condExprId)) !== 0 &&
            evalConditionAtEventRoot(host.arena.getExprRight(condExprId)) !== 0
            ? 1
            : 0;
        }
        if (op === BinOp.Or) {
          return evalConditionAtEventRoot(host.arena.getExprLeft(condExprId)) !== 0 ||
            evalConditionAtEventRoot(host.arena.getExprRight(condExprId)) !== 0
            ? 1
            : 0;
        }
        if (
          op === BinOp.Lt ||
          op === BinOp.Lte ||
          op === BinOp.Gt ||
          op === BinOp.Gte ||
          op === BinOp.Eq ||
          op === BinOp.Neq
        ) {
          const lhsVal = evaluateArenaRuntime(
            host.arena,
            host.arena.getExprLeft(condExprId),
            valuesByStringId,
            host.preValuesByStringId,
          );
          const rhsVal = evaluateArenaRuntime(
            host.arena,
            host.arena.getExprRight(condExprId),
            valuesByStringId,
            host.preValuesByStringId,
          );
          const diff = lhsVal - rhsVal;
          if (Math.abs(diff) <= 1e-7) {
            const effDiff = dir < 0 ? -1e-10 : 1e-10;
            if (op === BinOp.Lt || op === BinOp.Lte) return effDiff < 0 ? 1 : 0;
            if (op === BinOp.Gt || op === BinOp.Gte) return effDiff > 0 ? 1 : 0;
            if (op === BinOp.Eq) return 1;
            if (op === BinOp.Neq) return 0;
          }
          return evaluateArenaRuntime(host.arena, condExprId, valuesByStringId, host.preValuesByStringId) !== 0 ? 1 : 0;
        }
      }
      if (kind === ExprKind.Call) {
        const fnName = host.arena.interner.resolve(host.arena.getExprData1(condExprId));
        if (fnName === "sample") {
          if (triggeredEi && areArenaExprsEqual(host.arena, condExprId, triggeredEi.exprId)) {
            return 1;
          }
          if (host.arena.getExprRight(condExprId) >= 2) {
            const sStart = evaluateArenaRuntime(host.arena, host.arena.getExprLeft(condExprId), valuesByStringId);
            const sInt = evaluateArenaRuntime(host.arena, host.arena.getExprLeft(condExprId + 1), valuesByStringId);
            if (sInt > 0 && t >= sStart - 1e-7) {
              const k = Math.round((t - sStart) / sInt);
              if (k >= 0 && Math.abs(t - (sStart + k * sInt)) <= 1e-6) {
                return 1;
              }
            }
          }
        }
      }
      return evaluateArenaRuntime(host.arena, condExprId, valuesByStringId, host.preValuesByStringId) !== 0 ? 1 : 0;
    };

    // Reset wasActive flags ONLY for clauses participating in the triggered zero-crossing
    if (Array.isArray(triggeredClauseIndices) && triggeredClauseIndices.length > 0) {
      for (const cIdx of triggeredClauseIndices) {
        const clause = host.whenClauses[cIdx];
        if (clause) clause.wasActive = false;
      }
    }

    // Process all when-clauses with bounded discrete event iteration.
    // We evaluate their boolean conditions at the precise event state to detect rising edges,
    // and record any state variables modified by reinit/assign actions so post-event surface
    // projection does not clobber them.
    const modifiedByWhen = new Set<number>();
    const firedGroups = new Set<number>();
    for (let iter = 0; iter < 10; iter++) {
      if (iter > 0 && host.preValuesByStringId && host.preValuesByStringId.length === valuesByStringId.length) {
        host.preValuesByStringId.set(valuesByStringId);
      }
      let anyFired = false;
      for (let cIdx = 0; cIdx < host.whenClauses.length; cIdx++) {
        const clause = host.whenClauses[cIdx]!;
        const groupId = clause.groupId;
        let condVal = evaluateArenaRuntime(
          host.arena,
          clause.conditionExprId,
          valuesByStringId,
          host.preValuesByStringId,
        );
        if (iter === 0 && condVal === 0 && triggeredClauseSet.has(cIdx)) {
          condVal = evalConditionAtEventRoot(clause.conditionExprId);
        }
        const isActive = condVal !== 0;

        if (groupId !== undefined && firedGroups.has(groupId)) {
          clause.wasActive = isActive;
          continue;
        }

        if (isActive && !clause.wasActive) {
          anyFired = true;
          if (groupId !== undefined) firedGroups.add(groupId);
          for (const action of clause.actions) {
            if (action.targetNameId < 0) continue;
            const val = evaluateArenaRuntime(host.arena, action.exprId, valuesByStringId, host.preValuesByStringId);
            valuesByStringId[action.targetNameId] = val;
            modifiedByWhen.add(action.targetNameId);
          }
          if (exprHasSampleCall(host.arena, clause.conditionExprId)) {
            clause.wasActive = false;
          } else {
            // Re-evaluate the condition after actions (e.g. reinit) to properly set the edge-detection
            // state for the next step, preventing immediate spurious re-triggering.
            const postCondVal = evaluateArenaRuntime(
              host.arena,
              clause.conditionExprId,
              valuesByStringId,
              host.preValuesByStringId,
            );
            clause.wasActive = postCondVal !== 0;
          }
        } else {
          clause.wasActive = isActive;
        }
      }
      if (!anyFired) break;
      host.bumpDiscreteEventEpoch();
      host.evaluateBlocks(valuesByStringId);
    }

    host.stepFmuSubsystemsIfAny(valuesByStringId, t, 0);

    // Read back state: only overwrite continuous states that were explicitly modified by when-actions;
    // restore unmodified states to their exact event-time values `y[i]`.
    const yAfter = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const sid = stateStringIds[i] ?? -1;
      if (sid >= 0 && modifiedByWhen.has(sid)) {
        yAfter[i] = valuesByStringId[sid] ?? 0;
      } else {
        yAfter[i] = y[i] ?? 0;
        if (sid >= 0) valuesByStringId[sid] = yAfter[i]!;
      }
    }

    host.evaluateBlocks(valuesByStringId);
    host.evaluateDerivativeEquations(valuesByStringId);
    if (host.preValuesByStringId && host.preValuesByStringId.length === valuesByStringId.length) {
      host.preValuesByStringId.set(valuesByStringId);
    }

    for (let eiIdx = 0; eiIdx < host.eventIndicators.length; eiIdx++) {
      const ei = host.eventIndicators[eiIdx]!;
      if (
        host.arena.getExprKind(ei.exprId) === ExprKind.Call &&
        host.arena.interner.resolve(host.arena.getExprData1(ei.exprId)) === "sample" &&
        host.arena.getExprRight(ei.exprId) >= 2
      ) {
        const start = evaluateArenaRuntime(host.arena, host.arena.getExprLeft(ei.exprId), valuesByStringId);
        const interval = evaluateArenaRuntime(host.arena, host.arena.getExprLeft(ei.exprId + 1), valuesByStringId);
        if (interval > 0) {
          const curNext = host.sampleNextTimeByIdx.get(eiIdx);
          if (eiIdx === eventIdx || (curNext !== undefined && t >= curNext - 1e-6)) {
            const nextSample = start + (Math.floor((t - start + 1e-6) / interval) + 1) * interval;
            host.sampleNextTimeByIdx.set(eiIdx, nextSample);
          }
        }
      }
    }

    onEventCompleted?.(t);

    return yAfter;
  };
}

/**
 * Checks numerical variables against interval bounds, min/max attributes, and domain singularities.
 */
export function checkArenaIntervalSafetyBarriers(
  arena: DAEBuilder,
  intervalIssues: string[],
  valuesByStringId: Float64Array,
  stateStringIds: number[],
  currentTime: number,
): void {
  // Check state variables for NaN/Infinity
  for (const sid of stateStringIds) {
    const val = valuesByStringId[sid] ?? 0;
    if (!Number.isFinite(val)) {
      const name = arena.interner.resolve(sid) ?? `var_${sid}`;
      intervalIssues.push(
        `Numerical singularity at t=${currentTime.toFixed(4)}s: variable '${name}' is ${isNaN(val) ? "NaN" : "Infinity"}`,
      );
    }
  }

  // Check variable min/max attribute bounds
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const minExpr = arena.getVarAttrExprId(i, "min");
    const maxExpr = arena.getVarAttrExprId(i, "max");
    if (minExpr === undefined && maxExpr === undefined) continue;

    const nameId = arena.getVarNameId(i);
    const val = valuesByStringId[nameId];
    if (val === undefined || !Number.isFinite(val)) continue;

    let minVal = -Infinity;
    let maxVal = Infinity;
    if (minExpr !== undefined) {
      minVal = evaluateArenaRuntime(arena, minExpr, valuesByStringId);
    }
    if (maxExpr !== undefined) {
      maxVal = evaluateArenaRuntime(arena, maxExpr, valuesByStringId);
    }

    if (typeof arena.exports?.dae_checkVarBounds === "function") {
      const mask = arena.exports.dae_checkVarBounds(i, val, val, minVal, maxVal);
      const MIN_BOUND_VIOLATION = 1 << 8;
      const MAX_BOUND_VIOLATION = 1 << 9;
      if ((mask & MIN_BOUND_VIOLATION) !== 0) {
        const varName = arena.getVarName(i);
        intervalIssues.push(
          `Variable '${varName}' breached minimum bound ${minVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
        );
      }
      if ((mask & MAX_BOUND_VIOLATION) !== 0) {
        const varName = arena.getVarName(i);
        intervalIssues.push(
          `Variable '${varName}' breached maximum bound ${maxVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
        );
      }
    } else {
      if (minVal > -Infinity && val < minVal) {
        const varName = arena.getVarName(i);
        intervalIssues.push(
          `Variable '${varName}' breached minimum bound ${minVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
        );
      }
      if (maxVal < Infinity && val > maxVal) {
        const varName = arena.getVarName(i);
        intervalIssues.push(
          `Variable '${varName}' breached maximum bound ${maxVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
        );
      }
    }
  }
}
