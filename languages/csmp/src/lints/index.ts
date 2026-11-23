// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis, Topological Sorter & Linter Engine for `@modelscript/csmp`.
 *
 * Implements diagnostic rules CSMP1001–CSMP5006 and Kahn/Tarjan topological
 * sorting for CSMP/360 & CSSL-67 `SORT` sections.
 */

import { CsmpErrorCode } from "../errors.js";
import type { CsmpAssignment, CsmpExpr, CsmpProgram, CsmpSpan } from "../types.js";

export interface CsmpDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export const VALID_CSMP_METHODS = new Set<string>([
  "RKS",
  "RKSFX",
  "RK4",
  "ADAMS",
  "MILNE",
  "SIMP",
  "TRAPZ",
  "RECT",
  "STIFF",
  "CENTRL",
]);

export const CSMP_BUILTIN_VARS = new Set<string>([
  "TIME",
  "DELT",
  "FINTIM",
  "PRDEL",
  "OUTDEL",
  "DELMIN",
  "DELMAX",
  "KEEP",
  "PI",
]);

export const CSMP_STD_FUNCTIONS = new Set<string>([
  // CSMP/360 standard dynamic & transfer blocks
  "INTGRL",
  "DERIV",
  "DELAY",
  "ZHOLD",
  "REALPL",
  "CMPXPL",
  "LEDLAG",
  "HYSTRS",
  "LIMIT",
  "DEADSP",
  "AFGEN",
  "NLFGEN",
  // Signal sources & switching
  "STEP",
  "RAMP",
  "IMPULS",
  "PULSE",
  "SINE",
  "INSW",
  "FCNSW",
  "COMPAR",
  "RST",
  "QNTZR",
  "HSTRSS",
  // Fortran / math intrinsics
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
  "ALOG10",
  "LOG",
  "LOG10",
  "SQRT",
  "ABS",
  "AMAX1",
  "AMIN1",
  "MAX",
  "MIN",
  "AMOD",
  "MOD",
  "SIGN",
  "INT",
  "FLOAT",
]);

/**
 * Collects all variable identifiers referenced in an expression.
 * When `skipStateCalls` is true, dependencies inside `INTGRL(ic, deriv)` (which break
 * algebraic feedback loops in CSMP/360 SORT sections) are excluded from algebraic edges.
 */
export function collectExprRefs(
  expr: CsmpExpr,
  out: Set<string>,
  options: { skipIntegratorAlgebraicDeps?: boolean; skipFunctionTableArg?: boolean } = {},
): void {
  switch (expr.kind) {
    case "number":
      return;
    case "ident":
      out.add(expr.name);
      return;
    case "unary":
      collectExprRefs(expr.operand, out, options);
      return;
    case "binary":
      collectExprRefs(expr.left, out, options);
      collectExprRefs(expr.right, out, options);
      return;
    case "call": {
      const callee = expr.callee.toUpperCase();
      // Integrators and state-holding transfer blocks break algebraic loops in SORT sections
      if (
        options.skipIntegratorAlgebraicDeps &&
        (callee === "INTGRL" || callee === "REALPL" || callee === "CMPXPL" || callee === "DELAY" || callee === "ZHOLD")
      ) {
        return;
      }
      for (let i = 0; i < expr.args.length; i++) {
        if (options.skipFunctionTableArg && i === 0 && (callee === "AFGEN" || callee === "NLFGEN")) {
          continue;
        }
        collectExprRefs(expr.args[i]!, out, options);
      }
      return;
    }
  }
}

/**
 * Collects all function/block call names in an expression.
 */
export function collectExprCalls(expr: CsmpExpr, out: Array<{ callee: string; argCount: number }>): void {
  switch (expr.kind) {
    case "number":
    case "ident":
      return;
    case "unary":
      collectExprCalls(expr.operand, out);
      return;
    case "binary":
      collectExprCalls(expr.left, out);
      collectExprCalls(expr.right, out);
      return;
    case "call":
      out.push({ callee: expr.callee.toUpperCase(), argCount: expr.args.length });
      for (const arg of expr.args) {
        collectExprCalls(arg, out);
      }
      return;
  }
}

export interface TopoSortResult {
  sorted: CsmpAssignment[];
  cycles: string[][];
}

/**
 * Topologically sorts a list of CSMP `SORT` statements so that every algebraic variable
 * is computed before it is used, while allowing state outputs (`INTGRL`, `REALPL`,
 * `CMPXPL`, `DELAY`, `ZHOLD`) to break feedback loops.
 */
export function topologicalSortEquations(statements: CsmpAssignment[]): TopoSortResult {
  const sortStmts = statements.filter((s) => s.sortMode === "SORT");
  const nosortStmts = statements.filter((s) => s.sortMode === "NOSORT");

  // Map target variable -> statement index in sortStmts (keep last if duplicate)
  const targetToIdx = new Map<string, number>();
  for (let i = 0; i < sortStmts.length; i++) {
    targetToIdx.set(sortStmts[i]!.target, i);
  }

  // Build adjacency list: depIdx -> [consumerIdx]
  const n = sortStmts.length;
  const inDegree = new Int32Array(n);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const stmt = sortStmts[i]!;
    const refs = new Set<string>();
    collectExprRefs(stmt.expr, refs, { skipIntegratorAlgebraicDeps: true, skipFunctionTableArg: true });

    for (const ref of refs) {
      const depIdx = targetToIdx.get(ref);
      if (depIdx !== undefined) {
        adj[depIdx]!.push(i);
        inDegree[i] = (inDegree[i] ?? 0) + 1;
      }
    }
  }

  // Kahn's algorithm (preserving original declaration order as tie-breaker)
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const ordered: CsmpAssignment[] = [];
  const visited = new Uint8Array(n);

  while (queue.length > 0) {
    const u = queue.shift()!;
    visited[u] = 1;
    ordered.push(sortStmts[u]!);
    for (const v of adj[u]!) {
      inDegree[v] = (inDegree[v] ?? 0) - 1;
      if (inDegree[v] === 0) {
        queue.push(v);
      }
    }
  }

  const cycles: string[][] = [];
  if (ordered.length < n) {
    const remaining: string[] = [];
    for (let i = 0; i < n; i++) {
      if (!visited[i]) {
        remaining.push(sortStmts[i]!.target);
        ordered.push(sortStmts[i]!);
      }
    }
    if (remaining.length > 0) {
      cycles.push(remaining);
    }
  }

  return {
    sorted: [...ordered, ...nosortStmts],
    cycles,
  };
}

function makeDiag(
  entry: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span?: CsmpSpan,
): CsmpDiagnostic {
  return {
    code: entry.code,
    id: entry.id,
    rule: entry.rule,
    severity: entry.severity,
    message,
    line: span?.line ?? 1,
    column: span?.column ?? 1,
    startOffset: span?.startOffset ?? 0,
    endOffset: span?.endOffset ?? 0,
  };
}

/**
 * Runs all static analysis and semantic lint rules (CSMP1001–CSMP5006) on a parsed `CsmpProgram`.
 */
export function lintCsmp(program: CsmpProgram): CsmpDiagnostic[] {
  const diags: CsmpDiagnostic[] = [];

  // 1. Propagate parser / structural errors (CSMP1001, CSMP1002, CSMP1003)
  for (const err of program.errors) {
    const entry =
      err.code === CsmpErrorCode.MISMATCHED_MACRO.id
        ? CsmpErrorCode.MISMATCHED_MACRO
        : err.code === CsmpErrorCode.MISMATCHED_PROCEDURE.id
          ? CsmpErrorCode.MISMATCHED_PROCEDURE
          : CsmpErrorCode.SYNTAX_ERROR;
    diags.push(makeDiag(entry, err.message, err.span));
  }

  // 2. Duplicate PARAM / CONST / INCON declarations (CSMP2001)
  const seenDecls = new Set<string>();
  for (const decl of program.allDataDecls) {
    if (seenDecls.has(decl.name)) {
      diags.push(
        makeDiag(
          CsmpErrorCode.DUPLICATE_DECLARATION,
          CsmpErrorCode.DUPLICATE_DECLARATION.message(decl.name, decl.kind),
          decl.span,
        ),
      );
    } else {
      seenDecls.add(decl.name);
    }
  }

  // 3. Collect all defined symbols in the program
  const definedVars = new Set<string>([...CSMP_BUILTIN_VARS, ...seenDecls, ...program.fixedVars]);
  for (const s of program.initialStatements) definedVars.add(s.target);
  for (const s of program.dynamicStatements) definedVars.add(s.target);
  for (const s of program.terminalStatements) definedVars.add(s.target);
  for (const p of program.procedures) {
    for (const out of p.outputs) definedVars.add(out);
  }

  // 4. Check duplicate assignments in SORT section (CSMP3002) & algebraic loops (CSMP3001)
  const sortTargets = new Map<string, CsmpSpan>();
  for (const stmt of program.dynamicStatements) {
    if (stmt.sortMode === "SORT") {
      if (sortTargets.has(stmt.target)) {
        diags.push(
          makeDiag(
            CsmpErrorCode.DUPLICATE_SORT_ASSIGNMENT,
            CsmpErrorCode.DUPLICATE_SORT_ASSIGNMENT.message(stmt.target),
            stmt.span,
          ),
        );
      } else {
        sortTargets.set(stmt.target, stmt.span);
      }
    }
  }

  const topo = topologicalSortEquations(program.dynamicStatements);
  for (const cycle of topo.cycles) {
    const firstTarget = cycle[0];
    const span = firstTarget ? sortTargets.get(firstTarget) : undefined;
    diags.push(makeDiag(CsmpErrorCode.ALGEBRAIC_LOOP, CsmpErrorCode.ALGEBRAIC_LOOP.message(cycle.join(" -> ")), span));
  }

  // 5. Validate TIMER parameters (CSMP4001)
  const t = program.timer;
  if (t.fintim !== undefined && t.fintim <= 0) {
    diags.push(
      makeDiag(
        CsmpErrorCode.INVALID_TIMER,
        CsmpErrorCode.INVALID_TIMER.message(`FINTIM must be > 0 (got ${t.fintim})`),
        t.span,
      ),
    );
  }
  if (t.delt !== undefined && t.delt <= 0) {
    diags.push(
      makeDiag(
        CsmpErrorCode.INVALID_TIMER,
        CsmpErrorCode.INVALID_TIMER.message(`DELT must be > 0 (got ${t.delt})`),
        t.span,
      ),
    );
  }
  if (t.fintim !== undefined && t.delt !== undefined && t.delt > t.fintim) {
    diags.push(
      makeDiag(
        CsmpErrorCode.INVALID_TIMER,
        CsmpErrorCode.INVALID_TIMER.message(`DELT (${t.delt}) exceeds FINTIM (${t.fintim})`),
        t.span,
      ),
    );
  }
  if (t.prdel !== undefined && t.prdel <= 0) {
    diags.push(
      makeDiag(
        CsmpErrorCode.INVALID_TIMER,
        CsmpErrorCode.INVALID_TIMER.message(`PRDEL must be > 0 (got ${t.prdel})`),
        t.span,
      ),
    );
  }
  if (t.outdel !== undefined && t.outdel <= 0) {
    diags.push(
      makeDiag(
        CsmpErrorCode.INVALID_TIMER,
        CsmpErrorCode.INVALID_TIMER.message(`OUTDEL must be > 0 (got ${t.outdel})`),
        t.span,
      ),
    );
  }
  if (t.delmin !== undefined && t.delmax !== undefined && t.delmin > t.delmax) {
    diags.push(
      makeDiag(
        CsmpErrorCode.INVALID_TIMER,
        CsmpErrorCode.INVALID_TIMER.message(`DELMIN (${t.delmin}) exceeds DELMAX (${t.delmax})`),
        t.span,
      ),
    );
  }

  // 6. Validate METHOD name (CSMP4002)
  if (program.method !== undefined && !VALID_CSMP_METHODS.has(program.method.toUpperCase())) {
    diags.push(
      makeDiag(CsmpErrorCode.INVALID_METHOD, CsmpErrorCode.INVALID_METHOD.message(program.method), program.methodSpan),
    );
  }

  // 7. Validate FUNCTION tables (CSMP5002)
  for (const [name, tbl] of program.functionTables) {
    if (tbl.rawValues.length < 4 || tbl.rawValues.length % 2 !== 0) {
      diags.push(
        makeDiag(
          CsmpErrorCode.INVALID_FUNCTION_TABLE,
          CsmpErrorCode.INVALID_FUNCTION_TABLE.message(
            name,
            `requires an even number of at least 4 coordinates (got ${tbl.rawValues.length})`,
          ),
          tbl.span,
        ),
      );
      continue;
    }
    for (let i = 1; i < tbl.points.length; i++) {
      if (tbl.points[i]!.x <= tbl.points[i - 1]!.x) {
        diags.push(
          makeDiag(
            CsmpErrorCode.INVALID_FUNCTION_TABLE,
            CsmpErrorCode.INVALID_FUNCTION_TABLE.message(
              name,
              `abscissa values must be strictly increasing (${tbl.points[i - 1]!.x} >= ${tbl.points[i]!.x})`,
            ),
            tbl.span,
          ),
        );
        break;
      }
    }
  }

  // 8. Check variable references (CSMP2002), INTGRL placement & arity (CSMP5001, CSMP5004), unknown functions (CSMP5006)
  const referencedVars = new Set<string>();
  const allStatements = [...program.initialStatements, ...program.dynamicStatements, ...program.terminalStatements];

  for (const stmt of allStatements) {
    const refs = new Set<string>();
    collectExprRefs(stmt.expr, refs, { skipFunctionTableArg: true });
    for (const ref of refs) {
      referencedVars.add(ref);
      if (!definedVars.has(ref) && !program.functionTables.has(ref)) {
        diags.push(
          makeDiag(CsmpErrorCode.UNDEFINED_VARIABLE, CsmpErrorCode.UNDEFINED_VARIABLE.message(ref), stmt.span),
        );
      }
    }

    const calls: Array<{ callee: string; argCount: number }> = [];
    collectExprCalls(stmt.expr, calls);
    for (const call of calls) {
      if (call.callee === "INTGRL") {
        if (call.argCount !== 2) {
          diags.push(
            makeDiag(
              CsmpErrorCode.INVALID_INTGRL_ARITY,
              CsmpErrorCode.INVALID_INTGRL_ARITY.message(stmt.target, call.argCount),
              stmt.span,
            ),
          );
        }
        if (stmt.section !== "DYNAMIC") {
          diags.push(
            makeDiag(
              CsmpErrorCode.INTGRL_OUTSIDE_DYNAMIC,
              CsmpErrorCode.INTGRL_OUTSIDE_DYNAMIC.message(stmt.target, stmt.section),
              stmt.span,
            ),
          );
        }
      } else if (!CSMP_STD_FUNCTIONS.has(call.callee) && !program.macros.has(call.callee)) {
        diags.push(
          makeDiag(CsmpErrorCode.UNKNOWN_FUNCTION, CsmpErrorCode.UNKNOWN_FUNCTION.message(call.callee), stmt.span),
        );
      }
    }
  }

  // Also count references inside PRINT / PRTPLT / PROCEDURE bodies
  for (const v of program.printVars) referencedVars.add(v);
  for (const v of program.prtpltVars) referencedVars.add(v);
  for (const proc of program.procedures) {
    for (const inp of proc.inputs) referencedVars.add(inp);
    for (const s of proc.body) collectExprRefs(s.expr, referencedVars, { skipFunctionTableArg: true });
  }

  // 9. Missing END statement warning (CSMP5003)
  if (!program.hasEnd) {
    diags.push(makeDiag(CsmpErrorCode.MISSING_END, CsmpErrorCode.MISSING_END.message()));
  }

  // 10. Unused parameter/constant info (CSMP5005)
  for (const decl of program.allDataDecls) {
    if (!referencedVars.has(decl.name)) {
      diags.push(
        makeDiag(CsmpErrorCode.UNUSED_PARAMETER, CsmpErrorCode.UNUSED_PARAMETER.message(decl.name), decl.span),
      );
    }
  }

  return diags;
}
