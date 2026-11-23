// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for MIT DYNAMO (`DYN1001`–`DYN5006`).
 */

import { DynamoErrorCode } from "../errors.js";
import { extractExprRefs } from "../parser/index.js";
import type { DynamoEquation, DynamoModel } from "../types.js";

export { DynamoErrorCode };

export interface DynamoDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
  symbol?: string | undefined;
}

const BUILTIN_SYMBOLS = new Set<string>(["TIME", "DT", "LENGTH", "PRTPER", "PLTPER"]);

const BUILTIN_FUNCTIONS = new Set<string>([
  "SMOOTH",
  "SMTH1",
  "DLINF1",
  "SMOOTH1",
  "DLINF3",
  "SMTH3",
  "DELAY1",
  "DEL1",
  "DELAY3",
  "DEL3",
  "TABLE",
  "TAB",
  "TABHL",
  "TABLEHL",
  "CLIP",
  "FIFGE",
  "SWITCH",
  "FIFZE",
  "STEP",
  "PULSE",
  "RAMP",
  "EXP",
  "LOGN",
  "LN",
  "LOG",
  "SQRT",
  "SIN",
  "COS",
  "TAN",
  "ABS",
  "MAX",
  "MIN",
  "POW",
]);

function makeDiag(
  entry: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span: { line: number; column: number; startOffset: number; endOffset: number },
  symbol?: string,
): DynamoDiagnostic {
  return {
    code: entry.code,
    id: entry.id,
    rule: entry.rule,
    severity: entry.severity,
    message,
    line: span.line,
    column: span.column,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
    symbol,
  };
}

/**
 * Runs all DYNAMO static analysis rules (`DYN1001`–`DYN5006`) on a parsed `DynamoModel`.
 */
export function lintDynamo(model: DynamoModel): DynamoDiagnostic[] {
  const diagnostics: DynamoDiagnostic[] = [];

  // 1. DYN1001: Syntax errors recorded by the parser
  for (const err of model.errors) {
    diagnostics.push(
      makeDiag(DynamoErrorCode.SYNTAX_ERROR, DynamoErrorCode.SYNTAX_ERROR.message(err.message), err.span),
    );
  }

  // Track declarations for symbol resolution, duplicates, and initial checks
  const definedSymbols = new Set<string>(BUILTIN_SYMBOLS);
  const nonInitialDefs = new Map<string, DynamoEquation>();
  const initialDefs = new Map<string, DynamoEquation>();
  const levelDefs: DynamoEquation[] = [];
  const auxDefs = new Map<string, DynamoEquation>();

  // 2. DYN2002: Duplicate equation definitions & collect symbol table
  for (const eq of model.equations) {
    definedSymbols.add(eq.name);

    if (eq.kind === "N") {
      if (initialDefs.has(eq.name)) {
        diagnostics.push(
          makeDiag(
            DynamoErrorCode.DUPLICATE_EQUATION,
            DynamoErrorCode.DUPLICATE_EQUATION.message(eq.name, eq.kind),
            eq.span,
            eq.name,
          ),
        );
      } else {
        initialDefs.set(eq.name, eq);
      }
    } else {
      if (nonInitialDefs.has(eq.name)) {
        diagnostics.push(
          makeDiag(
            DynamoErrorCode.DUPLICATE_EQUATION,
            DynamoErrorCode.DUPLICATE_EQUATION.message(eq.name, eq.kind),
            eq.span,
            eq.name,
          ),
        );
      } else {
        nonInitialDefs.set(eq.name, eq);
      }
      if (eq.kind === "L") levelDefs.push(eq);
      if (eq.kind === "A") auxDefs.set(eq.name, eq);
    }
  }

  // 3. DYN3001: Invalid time subscript for equation type (LHS and RHS)
  for (const eq of model.equations) {
    if (eq.kind === "L" || eq.kind === "A" || eq.kind === "S") {
      if (eq.subscript !== "K") {
        diagnostics.push(
          makeDiag(
            DynamoErrorCode.INVALID_TIME_SUBSCRIPT,
            DynamoErrorCode.INVALID_TIME_SUBSCRIPT.message(eq.name, eq.kind, eq.subscript ?? "<none>", "'.K'"),
            eq.span,
            eq.name,
          ),
        );
      }
    } else if (eq.kind === "R") {
      if (eq.subscript !== "KL") {
        diagnostics.push(
          makeDiag(
            DynamoErrorCode.INVALID_TIME_SUBSCRIPT,
            DynamoErrorCode.INVALID_TIME_SUBSCRIPT.message(eq.name, eq.kind, eq.subscript ?? "<none>", "'.KL'"),
            eq.span,
            eq.name,
          ),
        );
      }
    } else if (eq.kind === "N" || eq.kind === "C" || eq.kind === "T") {
      if (eq.subscript !== undefined) {
        diagnostics.push(
          makeDiag(
            DynamoErrorCode.INVALID_TIME_SUBSCRIPT,
            DynamoErrorCode.INVALID_TIME_SUBSCRIPT.message(eq.name, eq.kind, eq.subscript, "no time subscript"),
            eq.span,
            eq.name,
          ),
        );
      }
    }

    // Check RHS references for undefined symbols (DYN2001) and invalid RHS subscripts (DYN3001)
    if (eq.expr) {
      const refs = extractExprRefs(eq.expr);
      for (const ref of refs) {
        if (!definedSymbols.has(ref.name) && !BUILTIN_FUNCTIONS.has(ref.name)) {
          diagnostics.push(
            makeDiag(
              DynamoErrorCode.UNDEFINED_SYMBOL,
              DynamoErrorCode.UNDEFINED_SYMBOL.message(ref.name),
              eq.span,
              ref.name,
            ),
          );
        }

        if (ref.subscript !== undefined) {
          if (eq.kind === "R" && ref.subscript === "KL") {
            diagnostics.push(
              makeDiag(
                DynamoErrorCode.INVALID_TIME_SUBSCRIPT,
                DynamoErrorCode.INVALID_TIME_SUBSCRIPT.message(ref.name, eq.kind, ref.subscript, "'.K' or '.JK'"),
                eq.span,
                ref.name,
              ),
            );
          } else if (eq.kind === "A" && (ref.subscript === "KL" || ref.subscript === "J")) {
            diagnostics.push(
              makeDiag(
                DynamoErrorCode.INVALID_TIME_SUBSCRIPT,
                DynamoErrorCode.INVALID_TIME_SUBSCRIPT.message(ref.name, eq.kind, ref.subscript, "'.K' or '.JK'"),
                eq.span,
                ref.name,
              ),
            );
          } else if (eq.kind === "N" || eq.kind === "C") {
            diagnostics.push(
              makeDiag(
                DynamoErrorCode.INVALID_TIME_SUBSCRIPT,
                DynamoErrorCode.INVALID_TIME_SUBSCRIPT.message(ref.name, eq.kind, ref.subscript, "no time subscript"),
                eq.span,
                ref.name,
              ),
            );
          }
        }
      }
    }
  }

  // 4. DYN4001: Missing 'N' initial equation for 'L' level
  for (const lvl of levelDefs) {
    if (!initialDefs.has(lvl.name)) {
      diagnostics.push(
        makeDiag(
          DynamoErrorCode.MISSING_LEVEL_INITIAL,
          DynamoErrorCode.MISSING_LEVEL_INITIAL.message(lvl.name),
          lvl.span,
          lvl.name,
        ),
      );
    }
  }

  // 5. DYN4002: Non-positive SPEC DT / LENGTH
  const specSpan = model.spec.span ?? { line: 1, column: 1, startOffset: 0, endOffset: 0 };
  if (model.spec.dt !== undefined && model.spec.dt <= 0) {
    diagnostics.push(
      makeDiag(
        DynamoErrorCode.NON_POSITIVE_SPEC,
        DynamoErrorCode.NON_POSITIVE_SPEC.message("DT", model.spec.dt),
        specSpan,
        "DT",
      ),
    );
  }
  if (model.spec.length !== undefined && model.spec.length <= 0) {
    diagnostics.push(
      makeDiag(
        DynamoErrorCode.NON_POSITIVE_SPEC,
        DynamoErrorCode.NON_POSITIVE_SPEC.message("LENGTH", model.spec.length),
        specSpan,
        "LENGTH",
      ),
    );
  }

  // 6. DYN5006: Simultaneous auxiliary cycle detection (3-color DFS on A -> A edges)
  const color = new Map<string, 0 | 1 | 2>(); // 0 = unvisited, 1 = visiting, 2 = done
  const stack: string[] = [];
  const reportedCycles = new Set<string>();

  function dfs(node: string): void {
    color.set(node, 1);
    stack.push(node);

    const eq = auxDefs.get(node);
    if (eq?.expr) {
      const refs = extractExprRefs(eq.expr);
      for (const ref of refs) {
        if (!auxDefs.has(ref.name)) continue;
        // References with .JK or .J break simultaneity; .K or unsubscripted are simultaneous
        if (ref.subscript === "J" || ref.subscript === "JK") continue;
        const c = color.get(ref.name) ?? 0;
        if (c === 1) {
          const cycleStart = stack.indexOf(ref.name);
          const cycleNodes = [...stack.slice(cycleStart), ref.name];
          const canonical = [...new Set(cycleNodes)].sort().join(",");
          if (!reportedCycles.has(canonical)) {
            reportedCycles.add(canonical);
            diagnostics.push(
              makeDiag(
                DynamoErrorCode.SIMULTANEOUS_AUXILIARY_CYCLE,
                DynamoErrorCode.SIMULTANEOUS_AUXILIARY_CYCLE.message(cycleNodes.join(" -> ")),
                eq.span,
                node,
              ),
            );
          }
        } else if (c === 0) {
          dfs(ref.name);
        }
      }
    }

    stack.pop();
    color.set(node, 2);
  }

  for (const auxName of auxDefs.keys()) {
    if ((color.get(auxName) ?? 0) === 0) {
      dfs(auxName);
    }
  }

  return diagnostics;
}
