// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Safety Rules for C.
 *
 * Implements 10 targeted diagnostics M8401–M8410 for procedural C blocks,
 * S-functions, PSCAD C segments, and control algorithms.
 */

import { CErrorCode } from "../errors.js";

export interface CDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  col?: number | undefined;
}

export interface CLintOptions {
  declaredBounds?: Record<string, number> | undefined;
}

export function lintCSource(source: string, options: CLintOptions = {}): CDiagnostic[] {
  const diags: CDiagnostic[] = [];
  const lines = source.split(/\r?\n/);

  // 1. M8402: Constant division or modulo by zero: / 0 or % 0
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    if (/[/%]\s*(?:0(?:\.0*)?)(?![0-9])/.test(line)) {
      diags.push({
        code: CErrorCode.CONSTANT_DIVISION_BY_ZERO.code,
        rule: CErrorCode.CONSTANT_DIVISION_BY_ZERO.rule,
        severity: CErrorCode.CONSTANT_DIVISION_BY_ZERO.severity,
        message: CErrorCode.CONSTANT_DIVISION_BY_ZERO.message(),
        line: idx + 1,
      });
    }
  }

  // 2. M8405: Assignment in conditional: if (x = y) instead of ==
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    // Match if (var = expr) where not ==, <=, >=, !=
    const ifAssignMatch = /\bif\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*([^)]+)\)/.exec(line);
    if (ifAssignMatch) {
      diags.push({
        code: CErrorCode.ASSIGNMENT_IN_CONDITIONAL.code,
        rule: CErrorCode.ASSIGNMENT_IN_CONDITIONAL.rule,
        severity: CErrorCode.ASSIGNMENT_IN_CONDITIONAL.severity,
        message: CErrorCode.ASSIGNMENT_IN_CONDITIONAL.message(),
        line: idx + 1,
      });
    }
  }

  // 3. M8404: Unreachable code after unconditional return or break
  let sawReturn = false;
  let inFunction = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!.trim();
    if (line.includes("{")) inFunction = true;
    if (line.includes("}")) {
      sawReturn = false;
      inFunction = false;
    }
    if (sawReturn && line && !line.startsWith("//") && !line.startsWith("}")) {
      diags.push({
        code: CErrorCode.UNREACHABLE_CODE.code,
        rule: CErrorCode.UNREACHABLE_CODE.rule,
        severity: CErrorCode.UNREACHABLE_CODE.severity,
        message: CErrorCode.UNREACHABLE_CODE.message(),
        line: idx + 1,
      });
      sawReturn = false; // Only flag once per block
    }
    if (inFunction && /^\s*(?:return\b|break;|continue;)/.test(line)) {
      sawReturn = true;
    }
  }

  // 4. M8407: Null pointer dereference: *NULL or NULL->field
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    if (/\*\(?NULL\)?\b|NULL\s*->/.test(line)) {
      diags.push({
        code: CErrorCode.NULL_POINTER_DEREFERENCE.code,
        rule: CErrorCode.NULL_POINTER_DEREFERENCE.rule,
        severity: CErrorCode.NULL_POINTER_DEREFERENCE.severity,
        message: CErrorCode.NULL_POINTER_DEREFERENCE.message("NULL"),
        line: idx + 1,
      });
    }
  }

  // 5. M8403: Array bounds overflow with constant index
  const bounds = options.declaredBounds ?? {};
  // Extract local array declarations like double arr[5];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const declMatch = /(?:double|float|int|short|long)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([0-9]+)\s*\]/.exec(line);
    if (declMatch) {
      bounds[declMatch[1]!] = parseInt(declMatch[2]!, 10);
    }

    // Check array accesses: arr[idx]
    const accessMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([0-9]+)\s*\]/g;
    for (const m of line.matchAll(accessMatch)) {
      const arrName = m[1]!;
      const accessIdx = parseInt(m[2]!, 10);
      const declaredSize = bounds[arrName];
      if (declaredSize !== undefined && accessIdx >= declaredSize) {
        diags.push({
          code: CErrorCode.ARRAY_BOUNDS_OVERFLOW.code,
          rule: CErrorCode.ARRAY_BOUNDS_OVERFLOW.rule,
          severity: CErrorCode.ARRAY_BOUNDS_OVERFLOW.severity,
          message: CErrorCode.ARRAY_BOUNDS_OVERFLOW.message(arrName, accessIdx, declaredSize),
          line: idx + 1,
        });
      }
    }
  }

  // 6. M8401: Uninitialized variable read
  // Track declared local variables vs initialized variables
  const declaredVars = new Set<string>();
  const initializedVars = new Set<string>();
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    // Declaration without initialization: double x;
    const uninitDecl = /^\s*(?:double|float|int|long)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
    for (const m of line.matchAll(uninitDecl)) {
      declaredVars.add(m[1]!);
    }

    // Declaration with initialization: double x = expr;
    const initDecl = /^\s*(?:double|float|int|long)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    for (const m of line.matchAll(initDecl)) {
      initializedVars.add(m[1]!);
    }

    // Check reads on RHS before LHS assignment
    const assignIdx = line.indexOf("=");
    if (assignIdx > 0 && !line.includes("==")) {
      const lhs = line.slice(0, assignIdx);
      const rhs = line.slice(assignIdx + 1);
      // Variables read on RHS
      for (const d of declaredVars) {
        if (!initializedVars.has(d)) {
          const varRe = new RegExp(`\\b${d}\\b`);
          if (varRe.test(rhs) && !varRe.test(lhs)) {
            diags.push({
              code: CErrorCode.UNINITIALIZED_VARIABLE.code,
              rule: CErrorCode.UNINITIALIZED_VARIABLE.rule,
              severity: CErrorCode.UNINITIALIZED_VARIABLE.severity,
              message: CErrorCode.UNINITIALIZED_VARIABLE.message(d),
              line: idx + 1,
            });
            break;
          }
        }
      }
      // LHS now considered initialized
      const lhsVar = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(lhs);
      if (lhsVar) initializedVars.add(lhsVar[1]!);
    }
  }

  // 7. M8406: Procedural algebraic cycle detection
  // Detect direct cross-assignments x = y; y = x; without state delays
  const depGraph = new Map<string, Set<string>>();
  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0 && !line.includes("==") && !line.includes("(") && !line.includes("[")) {
      const lhsMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(line.slice(0, eqIdx));
      if (lhsMatch) {
        const lhsVar = lhsMatch[1]!;
        const rhs = line.slice(eqIdx + 1);
        const rhsVars = rhs.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
        if (!depGraph.has(lhsVar)) depGraph.set(lhsVar, new Set());
        for (const rv of rhsVars) {
          if (rv !== lhsVar) depGraph.get(lhsVar)!.add(rv);
        }
      }
    }
  }

  // Find 2-cycles: a -> b and b -> a
  for (const [a, bSet] of depGraph.entries()) {
    for (const b of bSet) {
      if (depGraph.get(b)?.has(a) && a < b) {
        diags.push({
          code: CErrorCode.ALGEBRAIC_CYCLE.code,
          rule: CErrorCode.ALGEBRAIC_CYCLE.rule,
          severity: CErrorCode.ALGEBRAIC_CYCLE.severity,
          message: CErrorCode.ALGEBRAIC_CYCLE.message(`${a} <-> ${b}`),
        });
      }
    }
  }

  // 8. M8408: Prototype mismatch
  // Detect prototype foo(double, double) vs implementation foo(double)
  const prototypes = new Map<string, number>();
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const protoMatch = /^\s*(?:extern\s+)?(?:void|double|int)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*;/g.exec(line);
    if (protoMatch) {
      const fnName = protoMatch[1]!;
      const params = protoMatch[2]!.trim() ? protoMatch[2]!.split(",").length : 0;
      prototypes.set(fnName, params);
    }

    const defMatch = /^\s*(?:void|double|int)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/g.exec(line);
    if (defMatch) {
      const fnName = defMatch[1]!;
      const params = defMatch[2]!.trim() ? defMatch[2]!.split(",").length : 0;
      if (prototypes.has(fnName)) {
        const expected = prototypes.get(fnName)!;
        if (expected !== params) {
          diags.push({
            code: CErrorCode.PROTOTYPE_MISMATCH.code,
            rule: CErrorCode.PROTOTYPE_MISMATCH.rule,
            severity: CErrorCode.PROTOTYPE_MISMATCH.severity,
            message: CErrorCode.PROTOTYPE_MISMATCH.message(
              fnName,
              `${expected} parameter(s)`,
              `${params} parameter(s)`,
            ),
            line: idx + 1,
          });
        }
      }
    }
  }

  // 9. M8409: Missing return value in non-void function
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const fnDefMatch = /^\s*(double|int|float)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g.exec(line);
    if (fnDefMatch) {
      const retType = fnDefMatch[1]!;
      const fnName = fnDefMatch[2]!;
      // Scan forward to ending brace
      let bodyLines: string[] = [];
      let depth = 1;
      let j = idx + 1;
      while (j < lines.length && depth > 0) {
        if (lines[j]!.includes("{")) depth++;
        if (lines[j]!.includes("}")) depth--;
        if (depth > 0) bodyLines.push(lines[j]!);
        j++;
      }
      const hasReturn = bodyLines.some((l) => /\breturn\b/.test(l));
      if (!hasReturn) {
        diags.push({
          code: CErrorCode.MISSING_RETURN_VALUE.code,
          rule: CErrorCode.MISSING_RETURN_VALUE.rule,
          severity: CErrorCode.MISSING_RETURN_VALUE.severity,
          message: CErrorCode.MISSING_RETURN_VALUE.message(fnName, retType),
          line: idx + 1,
        });
      }
    }
  }

  // 10. M8410: Implicit lossy conversion (float/double literal assigned to int variable)
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lossyMatch = /^\s*int\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9]+\.[0-9]+)\s*;/g.exec(line);
    if (lossyMatch) {
      diags.push({
        code: CErrorCode.IMPLICIT_LOSSY_CONVERSION.code,
        rule: CErrorCode.IMPLICIT_LOSSY_CONVERSION.rule,
        severity: CErrorCode.IMPLICIT_LOSSY_CONVERSION.severity,
        message: CErrorCode.IMPLICIT_LOSSY_CONVERSION.message("double", "int"),
        line: idx + 1,
      });
    }
  }

  return diags;
}
