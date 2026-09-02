// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Procedural algorithm statement execution module.
 * Executes Modelica algorithm sections (`for`, `while`, `assignment`, `if`, `when`, `return`, `break`)
 * using the DAEBuilder AST and dense environment vectors.
 */

import type { QueryDB, SymbolId } from "./runtime.js";
import { DAEBuilder, ExprKind, StmtKind, VarType } from "./wasm_dae.js";
import { evaluateArenaExpression, evaluateArenaRuntime, type ArenaValue } from "./wasm_evaluator.js";

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
 * Execute a range of statements from the DAEBuilder.
 */
export function executeArenaStatements(
  arena: DAEBuilder,
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
        nextIdx += bodyStmtCount;

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
        nextIdx += bodyStmtCount;

        executeArenaWhileStatement(arena, condExprId, i + 1, bodyStmtCount, valuesByStringId, functionLookup);
        break;
      }

      case StmtKind.If: {
        const condExprId = data1;
        const thenStmtCount = left;
        const branchCount = right;

        const blockStartIdx = i + 1;
        nextIdx = blockStartIdx + thenStmtCount;

        const condVal = evaluateArenaRuntime(arena, condExprId, valuesByStringId);
        let executed = false;

        if (condVal !== 0) {
          executeArenaStatements(arena, blockStartIdx, thenStmtCount, valuesByStringId, functionLookup);
          executed = true;
        }

        for (let b = 0; b < branchCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchKind = arena.getStmtKind(branchStmtIdx);
          const branchCondExprId = arena.getStmtData1(branchStmtIdx);
          const branchStmtCount = arena.getStmtLeft(branchStmtIdx);

          nextIdx += 1 + branchStmtCount;

          if (!executed && branchKind === StmtKind.Block) {
            if (branchCondExprId === -1) {
              executeArenaStatements(arena, branchStmtIdx + 1, branchStmtCount, valuesByStringId, functionLookup);
              executed = true;
            } else {
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
            // consume built-in
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
        nextIdx += numTargets;

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
        break;
    }

    i = nextIdx;
  }
}

function executeArenaForStatement(
  arena: DAEBuilder,
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
    const stopId = arena.getExprLeft(rangeExprId);
    const stepId = arena.getExprRight(rangeExprId);

    startVal = evaluateArenaRuntime(arena, startId, valuesByStringId);
    endVal = evaluateArenaRuntime(arena, stopId, valuesByStringId);
    if (stepId !== -1) {
      stepVal = evaluateArenaRuntime(arena, stepId, valuesByStringId);
    } else {
      stepVal = 1;
    }
  } else {
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
  arena: DAEBuilder,
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
 */
export function executeArenaFunction(
  funcArena: DAEBuilder,
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
        if (typeof startExprId === "number" && startExprId !== -1) {
          valuesByStringId[nameId] = evaluateArenaRuntime(funcArena, startExprId, valuesByStringId);
        }
      }
    }

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

export async function executeArenaStatementsAsync(
  arena: DAEBuilder,
  startStmtIdx: number,
  stmtCount: number,
  valuesByStringId: Float64Array,
  functionLookup?: (nameId: number, args: number[]) => number | null,
  debuggerHook?: import("../compiler/simulator/core/simulation.js").SimulationDebugger,
): Promise<void> {
  let i = startStmtIdx;
  const endIdx = startStmtIdx + stmtCount;

  while (i < endIdx) {
    if (debuggerHook?.onArenaStatement) {
      await debuggerHook.onArenaStatement(arena, i, valuesByStringId);
    }

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
        nextIdx += bodyStmtCount;

        await executeArenaForStatementAsync(
          arena,
          indexNameId,
          rangeExprId,
          i + 1,
          bodyStmtCount,
          valuesByStringId,
          functionLookup,
          debuggerHook,
        );
        break;
      }

      case StmtKind.While: {
        const condExprId = data1;
        const bodyStmtCount = left;
        nextIdx += bodyStmtCount;

        await executeArenaWhileStatementAsync(
          arena,
          condExprId,
          i + 1,
          bodyStmtCount,
          valuesByStringId,
          functionLookup,
          debuggerHook,
        );
        break;
      }

      case StmtKind.If: {
        const condExprId = data1;
        const thenStmtCount = left;
        const branchCount = right;

        const blockStartIdx = i + 1;
        nextIdx = blockStartIdx + thenStmtCount;

        const condVal = evaluateArenaRuntime(arena, condExprId, valuesByStringId);
        let executed = false;

        if (condVal !== 0) {
          await executeArenaStatementsAsync(
            arena,
            blockStartIdx,
            thenStmtCount,
            valuesByStringId,
            functionLookup,
            debuggerHook,
          );
          executed = true;
        }

        for (let b = 0; b < branchCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchKind = arena.getStmtKind(branchStmtIdx);
          const branchCondExprId = arena.getStmtData1(branchStmtIdx);
          const branchStmtCount = arena.getStmtLeft(branchStmtIdx);

          nextIdx += 1 + branchStmtCount;

          if (!executed && branchKind === StmtKind.Block) {
            if (branchCondExprId === -1) {
              await executeArenaStatementsAsync(
                arena,
                branchStmtIdx + 1,
                branchStmtCount,
                valuesByStringId,
                functionLookup,
                debuggerHook,
              );
              executed = true;
            } else {
              const elseIfCondVal = evaluateArenaRuntime(arena, branchCondExprId, valuesByStringId);
              if (elseIfCondVal !== 0) {
                await executeArenaStatementsAsync(
                  arena,
                  branchStmtIdx + 1,
                  branchStmtCount,
                  valuesByStringId,
                  functionLookup,
                  debuggerHook,
                );
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
          await executeArenaStatementsAsync(
            arena,
            blockStartIdx,
            bodyStmtCount,
            valuesByStringId,
            functionLookup,
            debuggerHook,
          );
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
              await executeArenaStatementsAsync(
                arena,
                branchStmtIdx + 1,
                branchStmtCount,
                valuesByStringId,
                functionLookup,
                debuggerHook,
              );
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
            // consume built-in
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
        nextIdx += numTargets;

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
        break;
    }

    i = nextIdx;
  }
}

async function executeArenaForStatementAsync(
  arena: DAEBuilder,
  indexNameId: number,
  rangeExprId: number,
  bodyStartIdx: number,
  bodyStmtCount: number,
  valuesByStringId: Float64Array,
  functionLookup?: (nameId: number, args: number[]) => number | null,
  debuggerHook?: import("../compiler/simulator/core/simulation.js").SimulationDebugger,
): Promise<void> {
  let startVal: number;
  let stepVal: number;
  let endVal: number;

  if (arena.getExprKind(rangeExprId) === ExprKind.Range) {
    const startId = arena.getExprData1(rangeExprId);
    const stopId = arena.getExprLeft(rangeExprId);
    const stepId = arena.getExprRight(rangeExprId);

    startVal = evaluateArenaRuntime(arena, startId, valuesByStringId);
    endVal = evaluateArenaRuntime(arena, stopId, valuesByStringId);
    if (stepId !== -1) {
      stepVal = evaluateArenaRuntime(arena, stepId, valuesByStringId);
    } else {
      stepVal = 1;
    }
  } else {
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
          await executeArenaStatementsAsync(
            arena,
            bodyStartIdx,
            bodyStmtCount,
            valuesByStringId,
            functionLookup,
            debuggerHook,
          );
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
          await executeArenaStatementsAsync(
            arena,
            bodyStartIdx,
            bodyStmtCount,
            valuesByStringId,
            functionLookup,
            debuggerHook,
          );
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

async function executeArenaWhileStatementAsync(
  arena: DAEBuilder,
  condExprId: number,
  bodyStartIdx: number,
  bodyStmtCount: number,
  valuesByStringId: Float64Array,
  functionLookup?: (nameId: number, args: number[]) => number | null,
  debuggerHook?: import("../compiler/simulator/core/simulation.js").SimulationDebugger,
): Promise<void> {
  let iterCount = 0;

  while (true) {
    if (++iterCount > MAX_WHILE_ITERATIONS) break;

    const condVal = evaluateArenaRuntime(arena, condExprId, valuesByStringId);
    if (condVal === 0) break;

    try {
      await executeArenaStatementsAsync(
        arena,
        bodyStartIdx,
        bodyStmtCount,
        valuesByStringId,
        functionLookup,
        debuggerHook,
      );
    } catch (e) {
      if (e === ArenaBreakSignal) break;
      throw e;
    }
  }
}

export async function executeArenaFunctionAsync(
  funcArena: DAEBuilder,
  argValues: number[],
  parentLookup?: (nameId: number, args: number[]) => number | null,
  debuggerHook?: import("../compiler/simulator/core/simulation.js").SimulationDebugger,
): Promise<number | null> {
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
        if (typeof startExprId === "number" && startExprId !== -1) {
          valuesByStringId[nameId] = evaluateArenaRuntime(funcArena, startExprId, valuesByStringId);
        }
      }
    }

    for (const section of funcArena.algorithmSections) {
      try {
        await executeArenaStatementsAsync(
          funcArena,
          section.start,
          section.count,
          valuesByStringId,
          parentLookup,
          debuggerHook,
        );
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

// ─────────────────────────────────────────────────────────────────────────────
// Compile-Time Statement Execution (CEval)
// ─────────────────────────────────────────────────────────────────────────────

const ArenaCEvalReturnSignal = { __brand: "ArenaCEvalReturnSignal" as const };
const ArenaCEvalBreakSignal = { __brand: "ArenaCEvalBreakSignal" as const };

function getSequenceElementsLocal(dae: DAEBuilder, baseExprId: number, count: number, firstElement: number): number[] {
  if (count === 0) return [];
  const elements = [firstElement];
  for (let i = 1; i < count; i++) {
    const tupleId = baseExprId + i;
    elements.push(dae.getExprLeft(tupleId));
  }
  return elements;
}

function updateNestedArray(arr: ArenaValue, indices: ArenaValue[], value: ArenaValue): ArenaValue {
  if (indices.length === 0) return value;
  const idx = indices[0];
  if (typeof idx !== "number" || !Number.isInteger(idx)) return arr;
  const arrayIndex = idx - 1;
  const currentArr = Array.isArray(arr) ? [...arr] : [];
  while (currentArr.length <= arrayIndex) {
    currentArr.push(indices.length > 1 ? [] : 0);
  }
  if (indices.length === 1) {
    currentArr[arrayIndex] = value;
  } else {
    const element = currentArr[arrayIndex] ?? [];
    currentArr[arrayIndex] = updateNestedArray(element, indices.slice(1), value);
  }
  return currentArr;
}

/**
 * Execute statements in a compile-time context.
 */
export function executeArenaCEvalStatements(
  arena: DAEBuilder,
  startStmtIdx: number,
  stmtCount: number,
  env: Map<string, ArenaValue>,
  functionLookup?: (funcNameId: number, args: ArenaValue[]) => ArenaValue | null,
  db?: QueryDB,
  scopeId?: SymbolId,
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
        const value = evaluateArenaExpression(arena, sourceExprId, env, db, scopeId, undefined, false, functionLookup);
        if (value === null) break;

        const targetKind = arena.getExprKind(targetExprId);
        if (targetKind === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(targetExprId));
          if (name) env.set(name, value);
        } else if (targetKind === ExprKind.Subscript) {
          let currentExprId = targetExprId;
          const subscripts: number[] = [];
          let ok = true;
          while (arena.getExprKind(currentExprId) === ExprKind.Subscript) {
            const idxCount = arena.getExprRight(currentExprId);
            const firstIdx = arena.getExprLeft(currentExprId);
            const idxIds = getSequenceElementsLocal(arena, currentExprId, idxCount, firstIdx);
            const currentSubscripts: number[] = [];
            for (const id of idxIds) {
              const val = evaluateArenaExpression(arena, id, env, db, scopeId, undefined, false, functionLookup);
              if (typeof val !== "number") {
                ok = false;
                break;
              }
              currentSubscripts.push(val);
            }
            subscripts.unshift(...currentSubscripts);
            if (!ok) break;
            currentExprId = arena.getExprData1(currentExprId);
          }
          if (!ok) break;
          if (arena.getExprKind(currentExprId) === ExprKind.Name) {
            const baseName = arena.interner.resolve(arena.getExprData1(currentExprId));
            if (baseName) {
              const currentArr = env.get(baseName) ?? [];
              const updatedArr = updateNestedArray(currentArr, subscripts, value);
              env.set(baseName, updatedArr);
            }
          }
        }
        break;
      }

      case StmtKind.For: {
        const indexNameId = data1;
        const rangeExprId = left;
        const bodyStmtCount = right;
        nextIdx += bodyStmtCount;

        const indexName = arena.interner.resolve(indexNameId);
        if (!indexName) break;

        const rangeVal = evaluateArenaExpression(
          arena,
          rangeExprId,
          env,
          db,
          scopeId,
          undefined,
          false,
          functionLookup,
        );
        if (!Array.isArray(rangeVal)) break;

        const previousValue = env.get(indexName);
        let iterCount = 0;

        try {
          for (const v of rangeVal) {
            if (++iterCount > MAX_FOR_ITERATIONS) break;
            env.set(indexName, v);
            try {
              executeArenaCEvalStatements(arena, i + 1, bodyStmtCount, env, functionLookup, db, scopeId);
            } catch (e) {
              if (e === ArenaCEvalBreakSignal) break;
              throw e;
            }
          }
        } finally {
          if (previousValue !== undefined) {
            env.set(indexName, previousValue);
          } else {
            env.delete(indexName);
          }
        }
        break;
      }

      case StmtKind.While: {
        const condExprId = data1;
        const bodyStmtCount = left;
        nextIdx += bodyStmtCount;

        let iterCount = 0;
        while (true) {
          if (++iterCount > MAX_WHILE_ITERATIONS) break;
          const condVal = evaluateArenaExpression(
            arena,
            condExprId,
            env,
            db,
            scopeId,
            undefined,
            false,
            functionLookup,
          );
          if (condVal !== true) break;
          try {
            executeArenaCEvalStatements(arena, i + 1, bodyStmtCount, env, functionLookup, db, scopeId);
          } catch (e) {
            if (e === ArenaCEvalBreakSignal) break;
            throw e;
          }
        }
        break;
      }

      case StmtKind.If: {
        const condExprId = data1;
        const thenStmtCount = left;
        const branchCount = right;

        const blockStartIdx = i + 1;
        nextIdx = blockStartIdx + thenStmtCount;

        const condVal = evaluateArenaExpression(arena, condExprId, env, db, scopeId, undefined, false, functionLookup);
        let executed = false;

        if (condVal === true) {
          executeArenaCEvalStatements(arena, blockStartIdx, thenStmtCount, env, functionLookup, db, scopeId);
          executed = true;
        }

        for (let b = 0; b < branchCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchKind = arena.getStmtKind(branchStmtIdx);
          const branchCondExprId = arena.getStmtData1(branchStmtIdx);
          const branchStmtCount = arena.getStmtLeft(branchStmtIdx);

          nextIdx += 1 + branchStmtCount;

          if (!executed && branchKind === StmtKind.Block) {
            if (branchCondExprId === -1) {
              executeArenaCEvalStatements(arena, branchStmtIdx + 1, branchStmtCount, env, functionLookup, db, scopeId);
              executed = true;
            } else {
              const elseIfCondVal = evaluateArenaExpression(
                arena,
                branchCondExprId,
                env,
                db,
                scopeId,
                undefined,
                false,
                functionLookup,
              );
              if (elseIfCondVal === true) {
                executeArenaCEvalStatements(
                  arena,
                  branchStmtIdx + 1,
                  branchStmtCount,
                  env,
                  functionLookup,
                  db,
                  scopeId,
                );
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

        const condVal = evaluateArenaExpression(arena, condExprId, env, db, scopeId, undefined, false, functionLookup);
        let executed = false;

        if (condVal === true) {
          executeArenaCEvalStatements(arena, blockStartIdx, bodyStmtCount, env, functionLookup, db, scopeId);
          executed = true;
        }

        for (let b = 0; b < elseWhenCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchCondExprId = arena.getStmtData1(branchStmtIdx);
          const branchStmtCount = arena.getStmtLeft(branchStmtIdx);

          nextIdx += 1 + branchStmtCount;

          if (!executed) {
            const elseWhenCondVal = evaluateArenaExpression(
              arena,
              branchCondExprId,
              env,
              db,
              scopeId,
              undefined,
              false,
              functionLookup,
            );
            if (elseWhenCondVal === true) {
              executeArenaCEvalStatements(arena, branchStmtIdx + 1, branchStmtCount, env, functionLookup, db, scopeId);
              executed = true;
            }
          }
        }
        break;
      }

      case StmtKind.Return:
        throw ArenaCEvalReturnSignal;

      case StmtKind.Break:
        throw ArenaCEvalBreakSignal;

      case StmtKind.ProcedureCall: {
        const callExprId = data1;
        if (arena.getExprKind(callExprId) === ExprKind.Call) {
          const funcNameId = arena.getExprData1(callExprId);
          const firstArg = arena.getExprLeft(callExprId);
          const numArgs = arena.getExprRight(callExprId);

          const argValues: ArenaValue[] = [];
          if (numArgs > 0) {
            const firstArgVal = evaluateArenaExpression(
              arena,
              firstArg,
              env,
              db,
              scopeId,
              undefined,
              false,
              functionLookup,
            );
            if (firstArgVal !== null) argValues.push(firstArgVal);
            for (let a = 1; a < numArgs; a++) {
              const tupleExprId = firstArg + a;
              const argExprId = arena.getExprLeft(tupleExprId);
              const val = evaluateArenaExpression(arena, argExprId, env, db, scopeId, undefined, false, functionLookup);
              if (val !== null) argValues.push(val);
            }
          }
          if (functionLookup) {
            functionLookup(funcNameId, argValues);
          }
        }
        break;
      }

      case StmtKind.ComplexAssignment: {
        const numTargets = data1;
        const sourceExprId = left;
        nextIdx += numTargets;

        if (numTargets === 1) {
          const targetBlockIdx = i + 1;
          const targetExprId = arena.getStmtData1(targetBlockIdx);
          const value = evaluateArenaExpression(
            arena,
            sourceExprId,
            env,
            db,
            scopeId,
            undefined,
            false,
            functionLookup,
          );
          if (value !== null && arena.getExprKind(targetExprId) === ExprKind.Name) {
            const name = arena.interner.resolve(arena.getExprData1(targetExprId));
            if (name) env.set(name, value);
          }
        } else if (arena.getExprKind(sourceExprId) === ExprKind.Call) {
          const funcNameId = arena.getExprData1(sourceExprId);
          const firstArg = arena.getExprLeft(sourceExprId);
          const numArgs = arena.getExprRight(sourceExprId);

          const argValues: ArenaValue[] = [];
          if (numArgs > 0) {
            const firstArgVal = evaluateArenaExpression(
              arena,
              firstArg,
              env,
              db,
              scopeId,
              undefined,
              false,
              functionLookup,
            );
            if (firstArgVal !== null) argValues.push(firstArgVal);
            for (let a = 1; a < numArgs; a++) {
              const tupleExprId = firstArg + a;
              const argExprId = arena.getExprLeft(tupleExprId);
              const val = evaluateArenaExpression(arena, argExprId, env, db, scopeId, undefined, false, functionLookup);
              if (val !== null) argValues.push(val);
            }
          }

          const result = functionLookup ? functionLookup(funcNameId, argValues) : null;
          if (Array.isArray(result) && numTargets > 0) {
            for (let t = 0; t < numTargets; t++) {
              const targetBlockIdx = i + 1 + t;
              const targetExprId = arena.getStmtData1(targetBlockIdx);
              if (arena.getExprKind(targetExprId) === ExprKind.Name) {
                const name = arena.interner.resolve(arena.getExprData1(targetExprId));
                if (name && t < result.length) {
                  const val = result[t];
                  if (val !== undefined) {
                    env.set(name, val);
                  }
                }
              }
            }
          }
        }
        break;
      }

      case StmtKind.Block:
        break;
    }

    i = nextIdx;
  }
}

/**
 * Evaluate a user-defined function inside the compile-time context.
 */
export function evaluateArenaFunctionCall(
  dae: DAEBuilder,
  funcNameId: number,
  argValues: ArenaValue[],
  db?: QueryDB,
  scopeId?: SymbolId,
): ArenaValue | null {
  const funcArena = dae.functions.get(funcNameId);
  if (!funcArena) return null;

  if (++currentCallDepth > MAX_CALL_DEPTH) {
    currentCallDepth--;
    throw new Error(`Maximum call depth (${MAX_CALL_DEPTH}) exceeded in function CEval.`);
  }

  try {
    const env = new Map<string, ArenaValue>();

    const functionLookup = (fid: number, args: ArenaValue[]) => {
      const funcName = funcArena.interner.resolve(fid);
      if (!funcName) return null;
      const rootFid = dae.interner.intern(funcName);
      return evaluateArenaFunctionCall(dae, rootFid, args, db, scopeId);
    };

    const outputs: string[] = [];
    const flatArgs: ArenaValue[] = [];
    let flatArgIndex = 0;

    let expectedInputsCount = 0;
    for (let i = 0; i < funcArena.varCount; i++) {
      if (!funcArena.isVarRemoved(i) && funcArena.getVarCausality(i) === 1 /* Input */) {
        expectedInputsCount++;
      }
    }

    let inputIndex = 0;

    for (let i = 0; i < funcArena.varCount; i++) {
      if (funcArena.isVarRemoved(i)) continue;

      const causality = funcArena.getVarCausality(i);
      const name = funcArena.getVarName(i);
      const startExprId = funcArena.getVarExpression(i) as number | undefined;

      let defaultVal: ArenaValue = 0;
      const type = funcArena.getVarType(i);
      if (type === VarType.Boolean) defaultVal = false;
      else if (type === VarType.String) defaultVal = "";

      if (causality === 1 /* Input */) {
        let val: ArenaValue | undefined;
        if (argValues.length === expectedInputsCount) {
          val = argValues[inputIndex++];
        } else {
          if (flatArgs.length === 0) {
            const flattenArg = (val2: ArenaValue): void => {
              if (Array.isArray(val2)) val2.forEach(flattenArg);
              else flatArgs.push(val2);
            };
            argValues.forEach(flattenArg);
          }
          val = flatArgs[flatArgIndex++];
        }

        if (val !== undefined) {
          env.set(name, val);
        } else if (typeof startExprId === "number" && startExprId !== -1) {
          env.set(
            name,
            evaluateArenaExpression(funcArena, startExprId, env, db, scopeId, undefined, false, functionLookup) ??
              defaultVal,
          );
        } else {
          env.set(name, defaultVal);
        }
      } else {
        if (causality === 2 /* Output */) outputs.push(name);
        if (typeof startExprId === "number" && startExprId !== -1) {
          env.set(
            name,
            evaluateArenaExpression(funcArena, startExprId, env, db, scopeId, undefined, false, functionLookup) ??
              defaultVal,
          );
        } else {
          env.set(name, defaultVal);
        }
      }
    }

    for (const section of funcArena.algorithmSections) {
      try {
        executeArenaCEvalStatements(funcArena, section.start, section.count, env, functionLookup, db, scopeId);
      } catch (e) {
        if (e === ArenaCEvalReturnSignal) break;
        throw e;
      }
    }

    if (funcArena.algorithmSections.length === 0 && funcArena.externalDecl) {
      const extMatch = funcArena.externalDecl.match(/(?:external\s+"C"\s+)?(\w+)\s*=\s*(\w+)\s*\(([^)]*)\)/);
      if (extMatch) {
        const [, outName, cFuncName, argList] = extMatch;
        const cArgNames = argList ? argList.split(",").map((s: string) => s.trim()) : [];

        const C_MATH: Record<string, (...args: number[]) => number> = {
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          asin: Math.asin,
          acos: Math.acos,
          atan: Math.atan,
          atan2: Math.atan2,
          sinh: Math.sinh,
          cosh: Math.cosh,
          tanh: Math.tanh,
          exp: Math.exp,
          log: Math.log,
          log10: Math.log10,
          sqrt: Math.sqrt,
          ceil: Math.ceil,
          floor: Math.floor,
          fabs: Math.abs,
          abs: Math.abs,
          pow: Math.pow,
          fmod: (a: number, b: number) => a % b,
        };

        if (cFuncName && C_MATH[cFuncName]) {
          const fn = C_MATH[cFuncName]!;
          const resolvedArgs = cArgNames.map((argName) => {
            const v = env.get(argName);
            return typeof v === "number" ? v : 0;
          });
          const cResult = fn(...resolvedArgs);
          if (outName) env.set(outName, cResult);
        }
      }
    }

    if (outputs.length === 1) {
      const outName = outputs[0];
      return outName ? (env.get(outName) ?? null) : null;
    } else if (outputs.length > 1) {
      return outputs.map((outName) => env.get(outName) ?? null) as ArenaValue;
    }

    return null;
  } finally {
    currentCallDepth--;
  }
}
