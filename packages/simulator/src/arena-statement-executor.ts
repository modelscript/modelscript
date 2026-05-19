// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, ExprKind, StmtKind } from "@modelscript/compiler";
import { evaluateArenaRuntime } from "./arena-eval-runtime.js";

/** Sentinel thrown when a `return` statement is executed. */
export const ArenaReturnSignal = Object.freeze({ __brand: "ArenaReturnSignal" as const });
export type ArenaReturnSignal = typeof ArenaReturnSignal;

/** Sentinel thrown when a `break` statement is executed. */
export const ArenaBreakSignal = Object.freeze({ __brand: "ArenaBreakSignal" as const });
export type ArenaBreakSignal = typeof ArenaBreakSignal;

const MAX_WHILE_ITERATIONS = 100_000;
const MAX_FOR_ITERATIONS = 1_000_000;
const MAX_CALL_DEPTH = 256;

let currentCallDepth = 0;

/**
 * Execute a range of statements from the ArenaDAEBuilder.
 *
 * @param arena The ArenaDAEBuilder.
 * @param startStmtIdx The index of the first statement to execute.
 * @param stmtCount The number of statements to execute.
 * @param valuesByStringId The environment containing variable values.
 * @param functionLookup Callback for user-defined function calls.
 */
export function executeArenaStatements(
  arena: ArenaDAEBuilder,
  startStmtIdx: number,
  stmtCount: number,
  valuesByStringId: Float64Array,
  functionLookup?: (nameId: number, args: number[]) => number | null,
): void {
  let i = startStmtIdx;
  const endIdx = startStmtIdx + stmtCount;

  while (i < endIdx) {
    const kind = arena.getStmtKind(i);
    const data1 = arena.getStmtData1(i);
    const left = arena.getStmtLeft(i);
    const right = arena.getStmtRight(i);

    let nextIdx = i + 1;

    switch (kind) {
      case StmtKind.Assignment: {
        const targetExprId = data1;
        const sourceExprId = left;
        const value = evaluateArenaRuntime(arena, sourceExprId, valuesByStringId);
        // Only simple variable targets are supported natively for now (ExprKind.Name)
        if (arena.getExprKind(targetExprId) === ExprKind.Name) {
          const nameId = arena.getExprData1(targetExprId);
          valuesByStringId[nameId] = value;
        }
        break;
      }

      case StmtKind.For: {
        const indexNameId = data1;
        const rangeExprId = left;
        const bodyStmtCount = right;
        nextIdx += bodyStmtCount; // skip body for outer loop

        executeArenaForStatement(
          arena,
          indexNameId,
          rangeExprId,
          i + 1,
          bodyStmtCount,
          valuesByStringId,
          functionLookup,
        );
        break;
      }

      case StmtKind.While: {
        const condExprId = data1;
        const bodyStmtCount = left;
        nextIdx += bodyStmtCount; // skip body

        executeArenaWhileStatement(arena, condExprId, i + 1, bodyStmtCount, valuesByStringId, functionLookup);
        break;
      }

      case StmtKind.If: {
        const condExprId = data1;
        const thenStmtCount = left;
        const branchCount = right; // number of additional else/elseif blocks

        const blockStartIdx = i + 1;
        nextIdx = blockStartIdx + thenStmtCount;

        const condVal = evaluateArenaRuntime(arena, condExprId, valuesByStringId);
        let executed = false;

        if (condVal !== 0) {
          executeArenaStatements(arena, blockStartIdx, thenStmtCount, valuesByStringId, functionLookup);
          executed = true;
        }

        // Process branches (else if, else)
        for (let b = 0; b < branchCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchKind = arena.getStmtKind(branchStmtIdx);
          const branchCondExprId = arena.getStmtData1(branchStmtIdx);
          const branchStmtCount = arena.getStmtLeft(branchStmtIdx);

          nextIdx += 1 + branchStmtCount;

          if (!executed && branchKind === StmtKind.Block) {
            if (branchCondExprId === -1) {
              // else block
              executeArenaStatements(arena, branchStmtIdx + 1, branchStmtCount, valuesByStringId, functionLookup);
              executed = true;
            } else {
              // else if block
              const elseIfCondVal = evaluateArenaRuntime(arena, branchCondExprId, valuesByStringId);
              if (elseIfCondVal !== 0) {
                executeArenaStatements(arena, branchStmtIdx + 1, branchStmtCount, valuesByStringId, functionLookup);
                executed = true;
              }
            }
          }
        }
        break;
      }

      case StmtKind.When: {
        const condExprId = data1;
        const bodyStmtCount = left;
        const elseWhenCount = right;

        const blockStartIdx = i + 1;
        nextIdx = blockStartIdx + bodyStmtCount;

        const condVal = evaluateArenaRuntime(arena, condExprId, valuesByStringId);
        let executed = false;

        if (condVal !== 0) {
          executeArenaStatements(arena, blockStartIdx, bodyStmtCount, valuesByStringId, functionLookup);
          executed = true;
        }

        for (let b = 0; b < elseWhenCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchCondExprId = arena.getStmtData1(branchStmtIdx);
          const branchStmtCount = arena.getStmtLeft(branchStmtIdx);

          nextIdx += 1 + branchStmtCount;

          if (!executed) {
            const elseWhenCondVal = evaluateArenaRuntime(arena, branchCondExprId, valuesByStringId);
            if (elseWhenCondVal !== 0) {
              executeArenaStatements(arena, branchStmtIdx + 1, branchStmtCount, valuesByStringId, functionLookup);
              executed = true;
            }
          }
        }
        break;
      }

      case StmtKind.Return:
        throw ArenaReturnSignal;

      case StmtKind.Break:
        throw ArenaBreakSignal;

      case StmtKind.ProcedureCall: {
        const callExprId = data1;
        if (arena.getExprKind(callExprId) === ExprKind.Call) {
          const funcNameId = arena.getExprData1(callExprId);
          const firstArg = arena.getExprLeft(callExprId);
          const numArgs = arena.getExprRight(callExprId);

          const funcName = arena.interner.resolve(funcNameId);

          if (funcName === "assert" || funcName === "print" || funcName === "terminate") {
            // Silently consume or handle built-ins
          } else if (functionLookup) {
            const argValues: number[] = [];
            if (numArgs > 0) {
              argValues.push(evaluateArenaRuntime(arena, firstArg, valuesByStringId));
              for (let a = 1; a < numArgs; a++) {
                const tupleExprId = firstArg + a;
                const argExprId = arena.getExprLeft(tupleExprId);
                argValues.push(evaluateArenaRuntime(arena, argExprId, valuesByStringId));
              }
            }
            functionLookup(funcNameId, argValues);
          }
        }
        break;
      }

      case StmtKind.ComplexAssignment: {
        const numTargets = data1;
        const sourceExprId = left;
        nextIdx += numTargets; // skip target blocks

        if (numTargets === 1) {
          const targetBlockIdx = i + 1;
          const targetExprId = arena.getStmtData1(targetBlockIdx);
          const value = evaluateArenaRuntime(arena, sourceExprId, valuesByStringId);
          if (arena.getExprKind(targetExprId) === ExprKind.Name) {
            const nameId = arena.getExprData1(targetExprId);
            valuesByStringId[nameId] = value;
          }
        } else if (functionLookup && arena.getExprKind(sourceExprId) === ExprKind.Call) {
          const funcNameId = arena.getExprData1(sourceExprId);
          const firstArg = arena.getExprLeft(sourceExprId);
          const numArgs = arena.getExprRight(sourceExprId);

          const argValues: number[] = [];
          if (numArgs > 0) {
            argValues.push(evaluateArenaRuntime(arena, firstArg, valuesByStringId));
            for (let a = 1; a < numArgs; a++) {
              const tupleExprId = firstArg + a;
              const argExprId = arena.getExprLeft(tupleExprId);
              argValues.push(evaluateArenaRuntime(arena, argExprId, valuesByStringId));
            }
          }

          const result = functionLookup(funcNameId, argValues);
          if (result !== null && numTargets > 0) {
            const firstTargetBlockIdx = i + 1;
            const targetExprId = arena.getStmtData1(firstTargetBlockIdx);
            if (arena.getExprKind(targetExprId) === ExprKind.Name) {
              const nameId = arena.getExprData1(targetExprId);
              valuesByStringId[nameId] = result;
            }
          }
        }
        break;
      }

      case StmtKind.Block:
        // Standalone blocks are ignored in the main loop, they are processed by If/When/ComplexAssignment
        break;
    }

    i = nextIdx;
  }
}

function executeArenaForStatement(
  arena: ArenaDAEBuilder,
  indexNameId: number,
  rangeExprId: number,
  bodyStartIdx: number,
  bodyStmtCount: number,
  valuesByStringId: Float64Array,
  functionLookup?: (nameId: number, args: number[]) => number | null,
): void {
  let startVal: number;
  let stepVal: number;
  let endVal: number;

  if (arena.getExprKind(rangeExprId) === ExprKind.Range) {
    const startId = arena.getExprData1(rangeExprId);
    const stepId = arena.getExprLeft(rangeExprId);
    const stopId = arena.getExprRight(rangeExprId);

    startVal = evaluateArenaRuntime(arena, startId, valuesByStringId);
    endVal = evaluateArenaRuntime(arena, stopId, valuesByStringId);
    if (stepId !== -1) {
      stepVal = evaluateArenaRuntime(arena, stepId, valuesByStringId);
    } else {
      stepVal = 1;
    }
  } else {
    // Array/scalar iterators
    const val = evaluateArenaRuntime(arena, rangeExprId, valuesByStringId);
    startVal = val;
    endVal = val;
    stepVal = 1;
  }

  if (stepVal === 0) return;

  const previousValue = valuesByStringId[indexNameId] ?? 0;
  let iterCount = 0;

  try {
    if (stepVal > 0) {
      for (let v = startVal; v <= endVal + 1e-10; v += stepVal) {
        if (++iterCount > MAX_FOR_ITERATIONS) break;
        valuesByStringId[indexNameId] = Math.round(v * 1e10) / 1e10;
        try {
          executeArenaStatements(arena, bodyStartIdx, bodyStmtCount, valuesByStringId, functionLookup);
        } catch (e) {
          if (e === ArenaBreakSignal) break;
          throw e;
        }
      }
    } else {
      for (let v = startVal; v >= endVal - 1e-10; v += stepVal) {
        if (++iterCount > MAX_FOR_ITERATIONS) break;
        valuesByStringId[indexNameId] = Math.round(v * 1e10) / 1e10;
        try {
          executeArenaStatements(arena, bodyStartIdx, bodyStmtCount, valuesByStringId, functionLookup);
        } catch (e) {
          if (e === ArenaBreakSignal) break;
          throw e;
        }
      }
    }
  } finally {
    valuesByStringId[indexNameId] = previousValue;
  }
}

function executeArenaWhileStatement(
  arena: ArenaDAEBuilder,
  condExprId: number,
  bodyStartIdx: number,
  bodyStmtCount: number,
  valuesByStringId: Float64Array,
  functionLookup?: (nameId: number, args: number[]) => number | null,
): void {
  let iterCount = 0;

  while (true) {
    if (++iterCount > MAX_WHILE_ITERATIONS) break;

    const condVal = evaluateArenaRuntime(arena, condExprId, valuesByStringId);
    if (condVal === 0) break;

    try {
      executeArenaStatements(arena, bodyStartIdx, bodyStmtCount, valuesByStringId, functionLookup);
    } catch (e) {
      if (e === ArenaBreakSignal) break;
      throw e;
    }
  }
}

/**
 * Execute a user-defined Modelica function DAE using its native arena.
 *
 * @param funcArena The ArenaDAEBuilder of the function.
 * @param argValues Positional argument values.
 * @param parentLookup Parent function lookup callback.
 * @returns The value of the first output variable, or null on failure.
 */
export function executeArenaFunction(
  funcArena: ArenaDAEBuilder,
  argValues: number[],
  parentLookup?: (nameId: number, args: number[]) => number | null,
): number | null {
  if (++currentCallDepth > MAX_CALL_DEPTH) {
    currentCallDepth--;
    throw new Error(`Maximum call depth (${MAX_CALL_DEPTH}) exceeded in function.`);
  }

  try {
    const valuesByStringId = new Float64Array(funcArena.interner.size);

    let firstOutputId = -1;
    let argIndex = 0;

    for (let i = 0; i < funcArena.varCount; i++) {
      if (funcArena.isVarRemoved(i)) continue;

      const causality = funcArena.getVarCausality(i);
      const nameId = funcArena.getVarNameId(i);
      const startExprId = funcArena.getVarExpression(i) as number | undefined;

      if (causality === 1 /* Input */) {
        if (argIndex < argValues.length) {
          valuesByStringId[nameId] = argValues[argIndex] ?? 0;
        } else if (typeof startExprId === "number" && startExprId !== -1) {
          valuesByStringId[nameId] = evaluateArenaRuntime(funcArena, startExprId, valuesByStringId);
        }
        argIndex++;
      } else if (causality === 2 /* Output */) {
        if (firstOutputId === -1) firstOutputId = nameId;
        if (typeof startExprId === "number" && startExprId !== -1) {
          valuesByStringId[nameId] = evaluateArenaRuntime(funcArena, startExprId, valuesByStringId);
        }
      } else {
        // Other (local, protected) variables
        if (typeof startExprId === "number" && startExprId !== -1) {
          valuesByStringId[nameId] = evaluateArenaRuntime(funcArena, startExprId, valuesByStringId);
        }
      }
    }

    // Execute all algorithm sections
    for (const section of funcArena.algorithmSections) {
      try {
        executeArenaStatements(funcArena, section.start, section.count, valuesByStringId, parentLookup);
      } catch (e) {
        if (e === ArenaReturnSignal) break;
        throw e;
      }
    }

    if (firstOutputId !== -1) {
      return valuesByStringId[firstOutputId] ?? null;
    }

    return null;
  } finally {
    currentCallDepth--;
  }
}
