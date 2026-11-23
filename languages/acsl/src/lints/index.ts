// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for `@modelscript/acsl` (ACSL1001–ACSL5006).
 */

import { AcslErrorCode, type AcslDiagnostic } from "../errors.js";
import { parseAcsl } from "../parser/acsl-parser.js";
import type { AcslExpr, AcslProgram, AcslSectionKind } from "../types.js";

export { AcslErrorCode, type AcslDiagnostic };

const BUILTIN_IDENTIFIERS = new Set([
  "T",
  "TIME",
  "PI",
  "E",
  "TRUE",
  "FALSE",
  // Standard ACSL operators & math functions
  "INTEG",
  "LIMINT",
  "REALPL",
  "CMPXPL",
  "LEDLAG",
  "DELAY",
  "PULSE",
  "RAMP",
  "STEP",
  "BOUND",
  "DEAD",
  "QUANT",
  "SW",
  "RSW",
  "ZHOLD",
  "SIN",
  "COS",
  "TAN",
  "ASIN",
  "ACOS",
  "ATAN",
  "ATAN2",
  "SINH",
  "COSH",
  "TANH",
  "EXP",
  "ALOG",
  "LOG",
  "LOG10",
  "ALOG10",
  "SQRT",
  "ABS",
  "MOD",
  "AMOD",
  "MIN",
  "MAX",
  "AMIN1",
  "AMAX1",
  "SIGN",
  "INT",
  "NINT",
  "FLOOR",
  "CEIL",
  "POW",
]);

function collectReferencedIdents(expr: AcslExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "ident":
      out.add(expr.name.toUpperCase());
      break;
    case "unary":
      collectReferencedIdents(expr.operand, out);
      break;
    case "binary":
      collectReferencedIdents(expr.left, out);
      collectReferencedIdents(expr.right, out);
      break;
    case "call":
      for (const arg of expr.args) collectReferencedIdents(arg, out);
      break;
    default:
      break;
  }
}

function evalConstNumber(expr: AcslExpr | undefined, constants: Map<string, number>): number | undefined {
  if (!expr) return undefined;
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "ident":
      return constants.get(expr.name.toUpperCase());
    case "unary": {
      const v = evalConstNumber(expr.operand, constants);
      if (v === undefined) return undefined;
      if (expr.op === "-") return -v;
      if (expr.op === "+") return v;
      return undefined;
    }
    case "binary": {
      const l = evalConstNumber(expr.left, constants);
      const r = evalConstNumber(expr.right, constants);
      if (l === undefined || r === undefined) return undefined;
      if (expr.op === "+") return l + r;
      if (expr.op === "-") return l - r;
      if (expr.op === "*") return l * r;
      if (expr.op === "/") return r !== 0 ? l / r : undefined;
      if (expr.op === "**") return Math.pow(l, r);
      return undefined;
    }
    default:
      return undefined;
  }
}

function isValidSectionParent(child: AcslSectionKind, parent: AcslSectionKind | undefined): boolean {
  if (child === "PROGRAM") return parent === undefined;
  if (child === "INITIAL" || child === "DYNAMIC" || child === "TERMINAL") {
    return parent === undefined || parent === "PROGRAM";
  }
  if (child === "DERIVATIVE" || child === "DISCRETE") {
    return parent === undefined || parent === "PROGRAM" || parent === "DYNAMIC";
  }
  return true;
}

/**
 * Runs all static analysis and lint rules (`ACSL1001`–`ACSL5006`) on a parsed `AcslProgram`.
 */
export function lintAcsl(program: AcslProgram): AcslDiagnostic[] {
  const diags: AcslDiagnostic[] = [];

  // 1. Parse & END mismatch errors (ACSL1001, ACSL1002)
  for (const err of program.parseErrors) {
    if (err.code === "ACSL1002") {
      diags.push({
        code: AcslErrorCode.MISMATCHED_END.code,
        id: AcslErrorCode.MISMATCHED_END.id,
        rule: AcslErrorCode.MISMATCHED_END.rule,
        severity: AcslErrorCode.MISMATCHED_END.severity,
        message: err.message,
        startOffset: err.startOffset,
        endOffset: err.endOffset,
        line: err.line,
        column: err.column,
      });
    } else {
      diags.push({
        code: AcslErrorCode.SYNTAX_ERROR.code,
        id: AcslErrorCode.SYNTAX_ERROR.id,
        rule: AcslErrorCode.SYNTAX_ERROR.rule,
        severity: AcslErrorCode.SYNTAX_ERROR.severity,
        message: AcslErrorCode.SYNTAX_ERROR.message(err.message),
        startOffset: err.startOffset,
        endOffset: err.endOffset,
        line: err.line,
        column: err.column,
      });
    }
  }

  // 2. Section placement (ACSL3001)
  for (const sec of program.sections) {
    if (!isValidSectionParent(sec.kind, sec.parentKind)) {
      diags.push({
        code: AcslErrorCode.INVALID_SECTION_PLACEMENT.code,
        id: AcslErrorCode.INVALID_SECTION_PLACEMENT.id,
        rule: AcslErrorCode.INVALID_SECTION_PLACEMENT.rule,
        severity: AcslErrorCode.INVALID_SECTION_PLACEMENT.severity,
        message: AcslErrorCode.INVALID_SECTION_PLACEMENT.message(sec.kind, sec.parentKind ?? "TOP_LEVEL"),
        startOffset: sec.startOffset,
        endOffset: sec.endOffset,
        line: sec.line,
        column: sec.column,
      });
    }
  }

  // 3. Duplicate declarations (ACSL2001) & collect defined symbols
  const declaredSymbols = new Set<string>();
  const definedSymbols = new Set<string>(BUILTIN_IDENTIFIERS);
  const constants = new Map<string, number>();

  for (const decl of program.declarations) {
    const key = decl.name.toUpperCase();
    if (declaredSymbols.has(key)) {
      diags.push({
        code: AcslErrorCode.DUPLICATE_SYMBOL.code,
        id: AcslErrorCode.DUPLICATE_SYMBOL.id,
        rule: AcslErrorCode.DUPLICATE_SYMBOL.rule,
        severity: AcslErrorCode.DUPLICATE_SYMBOL.severity,
        message: AcslErrorCode.DUPLICATE_SYMBOL.message(decl.name),
        startOffset: decl.startOffset,
        endOffset: decl.endOffset,
        line: decl.line,
        column: decl.column,
        symbol: decl.name,
      });
    } else {
      declaredSymbols.add(key);
      definedSymbols.add(key);
    }
    const val = evalConstNumber(decl.initialValue, constants);
    if (val !== undefined) constants.set(key, val);
  }

  for (const tbl of program.tables) {
    const key = tbl.name.toUpperCase();
    if (declaredSymbols.has(key)) {
      diags.push({
        code: AcslErrorCode.DUPLICATE_SYMBOL.code,
        id: AcslErrorCode.DUPLICATE_SYMBOL.id,
        rule: AcslErrorCode.DUPLICATE_SYMBOL.rule,
        severity: AcslErrorCode.DUPLICATE_SYMBOL.severity,
        message: AcslErrorCode.DUPLICATE_SYMBOL.message(tbl.name),
        startOffset: tbl.startOffset,
        endOffset: tbl.endOffset,
        line: tbl.line,
        column: tbl.column,
        symbol: tbl.name,
      });
    } else {
      declaredSymbols.add(key);
      definedSymbols.add(key);
    }
    // ACSL5005: table dimension mismatch
    if (tbl.breakpoints.length !== tbl.values.length) {
      diags.push({
        code: AcslErrorCode.TABLE_DIMENSION_MISMATCH.code,
        id: AcslErrorCode.TABLE_DIMENSION_MISMATCH.id,
        rule: AcslErrorCode.TABLE_DIMENSION_MISMATCH.rule,
        severity: AcslErrorCode.TABLE_DIMENSION_MISMATCH.severity,
        message: AcslErrorCode.TABLE_DIMENSION_MISMATCH.message(tbl.name, tbl.breakpoints.length, tbl.values.length),
        startOffset: tbl.startOffset,
        endOffset: tbl.endOffset,
        line: tbl.line,
        column: tbl.column,
        symbol: tbl.name,
      });
    }
  }

  for (const mac of program.macros) {
    definedSymbols.add(mac.name.toUpperCase());
  }

  for (const assign of program.assignments) {
    definedSymbols.add(assign.target.toUpperCase());
  }

  if (program.derivt) {
    definedSymbols.add(program.derivt.name.toUpperCase());
  }

  // 4. Integrator checks (ACSL4001: uninitialized integrator, ACSL5004: duplicate state assignment)
  const stateVars = new Set<string>();
  const derivStateCounts = new Map<string, number>();

  for (const integ of program.integrators) {
    const key = integ.stateVar.toUpperCase();
    stateVars.add(key);
    if (!integ.initialCondExpr) {
      diags.push({
        code: AcslErrorCode.UNINITIALIZED_INTEGRATOR.code,
        id: AcslErrorCode.UNINITIALIZED_INTEGRATOR.id,
        rule: AcslErrorCode.UNINITIALIZED_INTEGRATOR.rule,
        severity: AcslErrorCode.UNINITIALIZED_INTEGRATOR.severity,
        message: AcslErrorCode.UNINITIALIZED_INTEGRATOR.message(integ.stateVar),
        startOffset: integ.startOffset,
        endOffset: integ.endOffset,
        line: integ.line,
        column: integ.column,
        symbol: integ.stateVar,
      });
    }
  }

  for (const assign of program.assignments) {
    if (assign.section === "DERIVATIVE" && !assign.procedural) {
      const key = assign.target.toUpperCase();
      if (stateVars.has(key)) {
        const count = (derivStateCounts.get(key) ?? 0) + 1;
        derivStateCounts.set(key, count);
        if (count > 1) {
          diags.push({
            code: AcslErrorCode.DUPLICATE_STATE_ASSIGNMENT.code,
            id: AcslErrorCode.DUPLICATE_STATE_ASSIGNMENT.id,
            rule: AcslErrorCode.DUPLICATE_STATE_ASSIGNMENT.rule,
            severity: AcslErrorCode.DUPLICATE_STATE_ASSIGNMENT.severity,
            message: AcslErrorCode.DUPLICATE_STATE_ASSIGNMENT.message(assign.target),
            startOffset: assign.startOffset,
            endOffset: assign.endOffset,
            line: assign.line,
            column: assign.column,
            symbol: assign.target,
          });
        }
      }
    }
  }

  // 5. CINTERVAL / MAXTERVAL positivity (ACSL4002, ACSL4003)
  if (program.cinterval) {
    const val = evalConstNumber(program.cinterval.expr, constants);
    if (val !== undefined && val <= 0) {
      diags.push({
        code: AcslErrorCode.NON_POSITIVE_CINTERVAL.code,
        id: AcslErrorCode.NON_POSITIVE_CINTERVAL.id,
        rule: AcslErrorCode.NON_POSITIVE_CINTERVAL.rule,
        severity: AcslErrorCode.NON_POSITIVE_CINTERVAL.severity,
        message: AcslErrorCode.NON_POSITIVE_CINTERVAL.message(val),
        startOffset: program.cinterval.span.startOffset,
        endOffset: program.cinterval.span.endOffset,
        line: program.cinterval.span.line,
        column: program.cinterval.span.column,
        symbol: program.cinterval.name,
      });
    }
  }

  if (program.maxterval) {
    const val = evalConstNumber(program.maxterval.expr, constants);
    if (val !== undefined && val <= 0) {
      diags.push({
        code: AcslErrorCode.NON_POSITIVE_MAXTERVAL.code,
        id: AcslErrorCode.NON_POSITIVE_MAXTERVAL.id,
        rule: AcslErrorCode.NON_POSITIVE_MAXTERVAL.rule,
        severity: AcslErrorCode.NON_POSITIVE_MAXTERVAL.severity,
        message: AcslErrorCode.NON_POSITIVE_MAXTERVAL.message(val),
        startOffset: program.maxterval.span.startOffset,
        endOffset: program.maxterval.span.endOffset,
        line: program.maxterval.span.line,
        column: program.maxterval.span.column,
        symbol: program.maxterval.name,
      });
    }
  }

  // 6. ALGORITHM code check (ACSL5002)
  if (program.algorithm && (program.algorithm.code < 1 || program.algorithm.code > 9)) {
    diags.push({
      code: AcslErrorCode.UNKNOWN_ALGORITHM.code,
      id: AcslErrorCode.UNKNOWN_ALGORITHM.id,
      rule: AcslErrorCode.UNKNOWN_ALGORITHM.rule,
      severity: AcslErrorCode.UNKNOWN_ALGORITHM.severity,
      message: AcslErrorCode.UNKNOWN_ALGORITHM.message(program.algorithm.code),
      startOffset: program.algorithm.span.startOffset,
      endOffset: program.algorithm.span.endOffset,
      line: program.algorithm.span.line,
      column: program.algorithm.span.column,
    });
  }

  // 7. TERMT checks (ACSL5003)
  for (const termt of program.termts) {
    if (termt.condition.kind === "boolean" && termt.condition.value === false) {
      diags.push({
        code: AcslErrorCode.INVALID_TERMT_CONDITION.code,
        id: AcslErrorCode.INVALID_TERMT_CONDITION.id,
        rule: AcslErrorCode.INVALID_TERMT_CONDITION.rule,
        severity: AcslErrorCode.INVALID_TERMT_CONDITION.severity,
        message: AcslErrorCode.INVALID_TERMT_CONDITION.message("condition is empty or constant .FALSE."),
        startOffset: termt.startOffset,
        endOffset: termt.endOffset,
        line: termt.line,
        column: termt.column,
      });
    }
  }

  // 8. SCHEDULE target check (ACSL5006)
  const discreteNames = new Set(program.discreteBlocks.map((b) => b.name.toUpperCase()));
  for (const sched of program.schedules) {
    if (!discreteNames.has(sched.targetDiscrete.toUpperCase())) {
      diags.push({
        code: AcslErrorCode.SCHEDULE_MISSING_TARGET.code,
        id: AcslErrorCode.SCHEDULE_MISSING_TARGET.id,
        rule: AcslErrorCode.SCHEDULE_MISSING_TARGET.rule,
        severity: AcslErrorCode.SCHEDULE_MISSING_TARGET.severity,
        message: AcslErrorCode.SCHEDULE_MISSING_TARGET.message(sched.targetDiscrete),
        startOffset: sched.startOffset,
        endOffset: sched.endOffset,
        line: sched.line,
        column: sched.column,
        symbol: sched.targetDiscrete,
      });
    }
  }

  // 9. Undefined variable references (ACSL2002)
  const reportedUndef = new Set<string>();
  const checkExprRefs = (
    expr: AcslExpr,
    span: { startOffset: number; endOffset: number; line: number; column: number },
  ) => {
    const refs = new Set<string>();
    collectReferencedIdents(expr, refs);
    for (const ref of refs) {
      if (!definedSymbols.has(ref) && !reportedUndef.has(`${span.line}:${ref}`)) {
        reportedUndef.add(`${span.line}:${ref}`);
        diags.push({
          code: AcslErrorCode.UNDEFINED_VARIABLE.code,
          id: AcslErrorCode.UNDEFINED_VARIABLE.id,
          rule: AcslErrorCode.UNDEFINED_VARIABLE.rule,
          severity: AcslErrorCode.UNDEFINED_VARIABLE.severity,
          message: AcslErrorCode.UNDEFINED_VARIABLE.message(ref),
          startOffset: span.startOffset,
          endOffset: span.endOffset,
          line: span.line,
          column: span.column,
          symbol: ref,
        });
      }
    }
  };

  for (const assign of program.assignments) {
    checkExprRefs(assign.expr, assign);
  }
  for (const termt of program.termts) {
    checkExprRefs(termt.condition, termt);
  }
  for (const sched of program.schedules) {
    checkExprRefs(sched.expr, sched);
  }

  // 10. Cyclic algebraic loop detection in DERIVATIVE (ACSL5001)
  // State variables produced by INTEG / LIMINT / REALPL / CMPXPL / LEDLAG / DELAY break algebraic loops.
  const dynamicCallTargets = new Set<string>(stateVars);
  const algebraicDeps = new Map<string, Set<string>>();
  const algebraicSpan = new Map<string, { startOffset: number; endOffset: number; line: number; column: number }>();

  for (const assign of program.assignments) {
    if (assign.section !== "DERIVATIVE" || assign.procedural) continue;
    const lhs = assign.target.toUpperCase();
    if (
      assign.expr.kind === "call" &&
      (assign.expr.callee === "INTEG" ||
        assign.expr.callee === "LIMINT" ||
        assign.expr.callee === "REALPL" ||
        assign.expr.callee === "CMPXPL" ||
        assign.expr.callee === "LEDLAG" ||
        assign.expr.callee === "DELAY")
    ) {
      dynamicCallTargets.add(lhs);
      continue;
    }
    const refs = new Set<string>();
    collectReferencedIdents(assign.expr, refs);
    algebraicDeps.set(lhs, refs);
    algebraicSpan.set(lhs, assign);
  }

  // DFS cycle detection over algebraic variables only
  const color = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const pathStack: string[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (node: string): void => {
    color.set(node, 1);
    pathStack.push(node);
    const deps = algebraicDeps.get(node);
    if (deps) {
      for (const dep of deps) {
        if (dynamicCallTargets.has(dep) || !algebraicDeps.has(dep)) continue;
        const c = color.get(dep) ?? 0;
        if (c === 1) {
          const cycleStart = pathStack.indexOf(dep);
          const cycleNodes = [...pathStack.slice(cycleStart), dep];
          const sig = [...new Set(cycleNodes)].sort().join(",");
          if (!reportedCycles.has(sig)) {
            reportedCycles.add(sig);
            const sp = algebraicSpan.get(node);
            diags.push({
              code: AcslErrorCode.CYCLIC_ALGEBRAIC_LOOP.code,
              id: AcslErrorCode.CYCLIC_ALGEBRAIC_LOOP.id,
              rule: AcslErrorCode.CYCLIC_ALGEBRAIC_LOOP.rule,
              severity: AcslErrorCode.CYCLIC_ALGEBRAIC_LOOP.severity,
              message: AcslErrorCode.CYCLIC_ALGEBRAIC_LOOP.message(cycleNodes.join(" -> ")),
              startOffset: sp?.startOffset,
              endOffset: sp?.endOffset,
              line: sp?.line,
              column: sp?.column,
              symbol: node,
            });
          }
        } else if (c === 0) {
          dfs(dep);
        }
      }
    }
    pathStack.pop();
    color.set(node, 2);
  };

  for (const node of algebraicDeps.keys()) {
    if ((color.get(node) ?? 0) === 0) {
      dfs(node);
    }
  }

  return diags;
}

/**
 * Convenience wrapper that parses and lints ACSL source text directly.
 */
export function lintAcslSource(source: string): AcslDiagnostic[] {
  return lintAcsl(parseAcsl(source));
}
