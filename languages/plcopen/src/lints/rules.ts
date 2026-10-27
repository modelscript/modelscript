// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — IEC 61131-3 Pre-Flight Diagnostic Linter Rules.
 *
 * Conforms to OpenModelica diagnostic conventions:
 * 1. Single quotes for identifiers ('${name}').
 * 2. Period-terminated message.
 * 3. Exact error codes M7701–M7720.
 */

import type { PlcDiagnostic, PlcExpr, PlcPou, PlcProject, PlcRange, PlcStatement, PlcVariable } from "../types.js";

export const PlcErrorCode = {
  UNASSIGNED_VARIABLE_READ: {
    code: "M7701",
    severity: "error" as const,
    message: (name: string, pouName: string) =>
      `Variable '${name}' is read before being assigned or initialized in POU '${pouName}'.`,
  },
  CYCLIC_TASK_OVERRUN: {
    code: "M7702",
    severity: "warning" as const,
    message: (taskName: string, stmtCount: number, interval: string) =>
      `Computational complexity in task '${taskName}' (${stmtCount} statements) may exceed cycle time '${interval}'.`,
  },
  RECURSIVE_POU_CALL: {
    code: "M7703",
    severity: "error" as const,
    message: (calleeName: string, callerName: string) =>
      `Recursive invocation of POU '${calleeName}' detected in '${callerName}'. Recursion is prohibited in IEC 61131-3.`,
  },
  IO_MAPPING_COLLISION: {
    code: "M7704",
    severity: "error" as const,
    message: (address: string, var1: string, var2: string) =>
      `Hardware I/O address collision at '${address}': multiple variables ('${var1}', '${var2}') assigned to same output.`,
  },
  TYPE_MISMATCH_ASSIGNMENT: {
    code: "M7705",
    severity: "error" as const,
    message: (varName: string, expectedType: string, actualType: string) =>
      `Type mismatch in assignment to '${varName}': expected '${expectedType}', got '${actualType}'.`,
  },
  TIMER_PRESET_NEGATIVE: {
    code: "M7706",
    severity: "error" as const,
    message: (value: string, timerName: string) =>
      `Timer preset time '${value}' for '${timerName}' cannot be negative.`,
  },
  UNBOUNDED_LOOP_DETECTED: {
    code: "M7707",
    severity: "warning" as const,
    message: (pouName: string) =>
      `Loop in POU '${pouName}' does not have a deterministic bounded termination condition.`,
  },
  UNKNOWN_POU_TYPE: {
    code: "M7708",
    severity: "error" as const,
    message: (typeName: string, instanceName: string) =>
      `Unknown or unresolvable POU or function block type '${typeName}' instantiated in '${instanceName}'.`,
  },
  UNREACHABLE_CODE: {
    code: "M7709",
    severity: "warning" as const,
    message: (stmtKind: string, pouName: string) =>
      `Unreachable code detected after '${stmtKind}' statement in POU '${pouName}'.`,
  },
  INVALID_TASK_INTERVAL: {
    code: "M7710",
    severity: "error" as const,
    message: (taskName: string, interval: string) =>
      `Task '${taskName}' specifies invalid or non-positive periodic interval '${interval}'.`,
  },
};

const STANDARD_FUNCTION_BLOCKS = new Set([
  "ton",
  "tof",
  "tp",
  "ctu",
  "ctd",
  "ctud",
  "sr",
  "rs",
  "r_trig",
  "f_trig",
  "pid",
  "hysteresis",
  "integrator",
  "derivative",
]);

export function lintPlcProject(project: PlcProject): PlcDiagnostic[] {
  const diagnostics: PlcDiagnostic[] = [];
  const pouMap = new Map<string, PlcPou>();
  for (const p of project.pous) {
    pouMap.set(p.name.toLowerCase(), p);
  }

  // 1. Hardware I/O Collision Check (M7704)
  const outputAddressMap = new Map<string, { varName: string; range: PlcRange }>();
  for (const pou of project.pous) {
    for (const v of pou.variables) {
      if (v.address) {
        const addrUpper = v.address.toUpperCase();
        if (addrUpper.startsWith("%Q")) {
          const existing = outputAddressMap.get(addrUpper);
          if (existing) {
            diagnostics.push({
              code: PlcErrorCode.IO_MAPPING_COLLISION.code,
              severity: PlcErrorCode.IO_MAPPING_COLLISION.severity,
              message: PlcErrorCode.IO_MAPPING_COLLISION.message(v.address, existing.varName, v.name),
              range: v.range,
            });
          } else {
            outputAddressMap.set(addrUpper, { varName: v.name, range: v.range });
          }
        }
      }
    }
  }

  // 2. Task Intervals & Instances (M7710, M7708, M7702)
  for (const config of project.configurations) {
    for (const res of config.resources) {
      for (const task of res.tasks) {
        if (task.interval) {
          if (task.intervalMs !== undefined && task.intervalMs <= 0) {
            diagnostics.push({
              code: PlcErrorCode.INVALID_TASK_INTERVAL.code,
              severity: PlcErrorCode.INVALID_TASK_INTERVAL.severity,
              message: PlcErrorCode.INVALID_TASK_INTERVAL.message(task.name, task.interval),
              range: task.range ?? config.range ?? fallbackRange(),
            });
          }
        }

        // POU instance checks under task
        let taskStmtCount = 0;
        for (const inst of res.instances.filter((i) => i.taskName === task.name)) {
          const typeLower = inst.typeName.toLowerCase();
          const targetPou = pouMap.get(typeLower);
          if (!targetPou && !STANDARD_FUNCTION_BLOCKS.has(typeLower)) {
            diagnostics.push({
              code: PlcErrorCode.UNKNOWN_POU_TYPE.code,
              severity: PlcErrorCode.UNKNOWN_POU_TYPE.severity,
              message: PlcErrorCode.UNKNOWN_POU_TYPE.message(inst.typeName, inst.name),
              range: inst.range ?? config.range ?? fallbackRange(),
            });
          } else if (targetPou?.body.st) {
            taskStmtCount += countStatements(targetPou.body.st.statements);
          }
        }

        if (task.intervalMs !== undefined && task.intervalMs <= 10 && taskStmtCount > 100) {
          diagnostics.push({
            code: PlcErrorCode.CYCLIC_TASK_OVERRUN.code,
            severity: PlcErrorCode.CYCLIC_TASK_OVERRUN.severity,
            message: PlcErrorCode.CYCLIC_TASK_OVERRUN.message(
              task.name,
              taskStmtCount,
              task.interval ?? `${task.intervalMs}ms`,
            ),
            range: task.range ?? config.range ?? fallbackRange(),
          });
        }
      }

      // Check standalone instances
      for (const inst of res.instances.filter((i) => !i.taskName)) {
        const typeLower = inst.typeName.toLowerCase();
        if (!pouMap.has(typeLower) && !STANDARD_FUNCTION_BLOCKS.has(typeLower)) {
          diagnostics.push({
            code: PlcErrorCode.UNKNOWN_POU_TYPE.code,
            severity: PlcErrorCode.UNKNOWN_POU_TYPE.severity,
            message: PlcErrorCode.UNKNOWN_POU_TYPE.message(inst.typeName, inst.name),
            range: inst.range ?? config.range ?? fallbackRange(),
          });
        }
      }
    }
  }

  // 3. POU Body Checks
  for (const pou of project.pous) {
    if (pou.body.kind === "ST" && pou.body.st) {
      lintPouStatements(pou, pou.body.st.statements, pouMap, diagnostics);
    }
  }

  return diagnostics;
}

function lintPouStatements(
  pou: PlcPou,
  statements: PlcStatement[],
  pouMap: Map<string, PlcPou>,
  diagnostics: PlcDiagnostic[],
): void {
  const localVars = new Map<string, PlcVariable>();
  for (const v of pou.variables) {
    localVars.set(v.name.toLowerCase(), v);
  }

  const assignedVars = new Set<string>();
  // Inputs and parameters with initial values count as assigned
  for (const v of pou.variables) {
    if (v.scope === "input" || v.scope === "inOut" || v.initialValue !== undefined) {
      assignedVars.add(v.name.toLowerCase());
    }
  }

  checkStatementSequence(pou, statements, assignedVars, localVars, pouMap, diagnostics);
}

function checkStatementSequence(
  pou: PlcPou,
  statements: PlcStatement[],
  assignedVars: Set<string>,
  localVars: Map<string, PlcVariable>,
  pouMap: Map<string, PlcPou>,
  diagnostics: PlcDiagnostic[],
): void {
  let terminated = false;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt) continue;

    if (terminated && stmt.kind !== "empty") {
      diagnostics.push({
        code: PlcErrorCode.UNREACHABLE_CODE.code,
        severity: PlcErrorCode.UNREACHABLE_CODE.severity,
        message: PlcErrorCode.UNREACHABLE_CODE.message(statements[i - 1]?.kind ?? "termination", pou.name),
        range: stmt.range,
      });
      break; // Only report once per block
    }

    if (stmt.kind === "return" || stmt.kind === "exit") {
      terminated = true;
      continue;
    }

    if (stmt.kind === "assignment") {
      // Check expression for unassigned variable reads
      checkExpressionReads(stmt.value, assignedVars, localVars, pou.name, diagnostics);

      // Check type compatibility
      if (stmt.target.kind === "identifier") {
        const targetName = stmt.target.name;
        const targetVar = localVars.get(targetName.toLowerCase());
        if (targetVar) {
          checkAssignmentTypes(targetVar, stmt.value, diagnostics);
        }
        assignedVars.add(targetName.toLowerCase());
      }
    } else if (stmt.kind === "if") {
      checkExpressionReads(stmt.condition, assignedVars, localVars, pou.name, diagnostics);
      const thenAssigned = new Set(assignedVars);
      checkStatementSequence(pou, stmt.thenStatements, thenAssigned, localVars, pouMap, diagnostics);

      for (const branch of stmt.elsifs) {
        checkExpressionReads(branch.condition, assignedVars, localVars, pou.name, diagnostics);
        const elifAssigned = new Set(assignedVars);
        checkStatementSequence(pou, branch.statements, elifAssigned, localVars, pouMap, diagnostics);
      }

      if (stmt.elseStatements.length > 0) {
        const elseAssigned = new Set(assignedVars);
        checkStatementSequence(pou, stmt.elseStatements, elseAssigned, localVars, pouMap, diagnostics);
      }
    } else if (stmt.kind === "case") {
      checkExpressionReads(stmt.selector, assignedVars, localVars, pou.name, diagnostics);
      for (const c of stmt.cases) {
        const caseAssigned = new Set(assignedVars);
        checkStatementSequence(pou, c.statements, caseAssigned, localVars, pouMap, diagnostics);
      }
      if (stmt.elseStatements.length > 0) {
        const elseAssigned = new Set(assignedVars);
        checkStatementSequence(pou, stmt.elseStatements, elseAssigned, localVars, pouMap, diagnostics);
      }
    } else if (stmt.kind === "for") {
      checkExpressionReads(stmt.start, assignedVars, localVars, pou.name, diagnostics);
      checkExpressionReads(stmt.end, assignedVars, localVars, pou.name, diagnostics);
      if (stmt.step) checkExpressionReads(stmt.step, assignedVars, localVars, pou.name, diagnostics);
      assignedVars.add(stmt.variable.toLowerCase());
      const forAssigned = new Set(assignedVars);
      checkStatementSequence(pou, stmt.statements, forAssigned, localVars, pouMap, diagnostics);
    } else if (stmt.kind === "while") {
      checkExpressionReads(stmt.condition, assignedVars, localVars, pou.name, diagnostics);
      // Check for infinite loop (WHILE TRUE DO ...)
      if (stmt.condition.kind === "literal" && stmt.condition.value === true) {
        const hasExit = hasExitOrReturn(stmt.statements);
        if (!hasExit) {
          diagnostics.push({
            code: PlcErrorCode.UNBOUNDED_LOOP_DETECTED.code,
            severity: PlcErrorCode.UNBOUNDED_LOOP_DETECTED.severity,
            message: PlcErrorCode.UNBOUNDED_LOOP_DETECTED.message(pou.name),
            range: stmt.range,
          });
        }
      }
      const whileAssigned = new Set(assignedVars);
      checkStatementSequence(pou, stmt.statements, whileAssigned, localVars, pouMap, diagnostics);
    } else if (stmt.kind === "repeat") {
      checkExpressionReads(stmt.condition, assignedVars, localVars, pou.name, diagnostics);
      const repeatAssigned = new Set(assignedVars);
      checkStatementSequence(pou, stmt.statements, repeatAssigned, localVars, pouMap, diagnostics);
    } else if (stmt.kind === "call") {
      // 1. Recursive call check (M7703)
      if (stmt.callee.toLowerCase() === pou.name.toLowerCase()) {
        diagnostics.push({
          code: PlcErrorCode.RECURSIVE_POU_CALL.code,
          severity: PlcErrorCode.RECURSIVE_POU_CALL.severity,
          message: PlcErrorCode.RECURSIVE_POU_CALL.message(stmt.callee, pou.name),
          range: stmt.range,
        });
      }

      // 2. Timer preset check (M7706)
      const calleeVar = localVars.get(stmt.callee.toLowerCase());
      const resolvedType = (calleeVar?.dataType ?? stmt.callee).toLowerCase();
      if (
        resolvedType === "ton" ||
        resolvedType === "tof" ||
        resolvedType === "tp" ||
        stmt.callee.toLowerCase().startsWith("ton") ||
        stmt.callee.toLowerCase().startsWith("tof") ||
        stmt.callee.toLowerCase().startsWith("tp")
      ) {
        for (const arg of stmt.args) {
          if (arg.name?.toUpperCase() === "PT") {
            if (arg.expr.kind === "literal") {
              const valStr = String(arg.expr.value);
              const rawStr = arg.expr.raw;
              if (valStr.startsWith("-") || rawStr.startsWith("T#-") || rawStr.startsWith("t#-")) {
                diagnostics.push({
                  code: PlcErrorCode.TIMER_PRESET_NEGATIVE.code,
                  severity: PlcErrorCode.TIMER_PRESET_NEGATIVE.severity,
                  message: PlcErrorCode.TIMER_PRESET_NEGATIVE.message(rawStr, stmt.callee),
                  range: arg.expr.range,
                });
              }
            }
          }
        }
      }

      // Check args
      for (const arg of stmt.args) {
        if (arg.direction === "in") {
          checkExpressionReads(arg.expr, assignedVars, localVars, pou.name, diagnostics);
        } else if (arg.expr.kind === "identifier") {
          assignedVars.add(arg.expr.name.toLowerCase());
        }
      }
    }
  }
}

function checkExpressionReads(
  expr: PlcExpr,
  assignedVars: Set<string>,
  localVars: Map<string, PlcVariable>,
  pouName: string,
  diagnostics: PlcDiagnostic[],
): void {
  if (expr.kind === "identifier") {
    const nameLower = expr.name.toLowerCase();
    // Don't warn on hardware address variables or unknown globals
    const declaredVar = localVars.get(nameLower);
    if (declaredVar && declaredVar.scope === "local") {
      if (!assignedVars.has(nameLower)) {
        diagnostics.push({
          code: PlcErrorCode.UNASSIGNED_VARIABLE_READ.code,
          severity: PlcErrorCode.UNASSIGNED_VARIABLE_READ.severity,
          message: PlcErrorCode.UNASSIGNED_VARIABLE_READ.message(expr.name, pouName),
          range: expr.range,
        });
      }
    }
  } else if (expr.kind === "binary") {
    checkExpressionReads(expr.left, assignedVars, localVars, pouName, diagnostics);
    checkExpressionReads(expr.right, assignedVars, localVars, pouName, diagnostics);
  } else if (expr.kind === "unary") {
    checkExpressionReads(expr.argument, assignedVars, localVars, pouName, diagnostics);
  } else if (expr.kind === "member") {
    checkExpressionReads(expr.object, assignedVars, localVars, pouName, diagnostics);
  } else if (expr.kind === "index") {
    checkExpressionReads(expr.array, assignedVars, localVars, pouName, diagnostics);
    for (const idx of expr.indices) {
      checkExpressionReads(idx, assignedVars, localVars, pouName, diagnostics);
    }
  } else if (expr.kind === "call") {
    for (const arg of expr.args) {
      checkExpressionReads(arg.expr, assignedVars, localVars, pouName, diagnostics);
    }
  }
}

function checkAssignmentTypes(targetVar: PlcVariable, value: PlcExpr, diagnostics: PlcDiagnostic[]): void {
  const targetType = targetVar.dataType.toUpperCase();
  if (value.kind === "literal") {
    if (
      (targetType === "BOOL" && value.literalType !== "bool") ||
      ((targetType === "INT" || targetType === "DINT" || targetType === "REAL" || targetType === "LREAL") &&
        value.literalType === "string") ||
      (targetType === "STRING" && value.literalType !== "string")
    ) {
      diagnostics.push({
        code: PlcErrorCode.TYPE_MISMATCH_ASSIGNMENT.code,
        severity: PlcErrorCode.TYPE_MISMATCH_ASSIGNMENT.severity,
        message: PlcErrorCode.TYPE_MISMATCH_ASSIGNMENT.message(targetVar.name, targetType, value.literalType),
        range: value.range,
      });
    }
  }
}

function hasExitOrReturn(statements: PlcStatement[]): boolean {
  for (const s of statements) {
    if (s.kind === "exit" || s.kind === "return") return true;
    if (s.kind === "if") {
      if (hasExitOrReturn(s.thenStatements) || hasExitOrReturn(s.elseStatements)) {
        return true;
      }
    }
  }
  return false;
}

function countStatements(statements: PlcStatement[]): number {
  let count = 0;
  for (const s of statements) {
    count++;
    if (s.kind === "if") {
      count += countStatements(s.thenStatements);
      for (const el of s.elsifs) count += countStatements(el.statements);
      count += countStatements(s.elseStatements);
    } else if (s.kind === "while" || s.kind === "repeat" || s.kind === "for") {
      count += countStatements(s.statements);
    } else if (s.kind === "case") {
      for (const c of s.cases) count += countStatements(c.statements);
      count += countStatements(s.elseStatements);
    }
  }
  return count;
}

function fallbackRange(): PlcRange {
  return {
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 1,
    startOffset: 0,
    endOffset: 0,
  };
}
