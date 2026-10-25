// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Pre-Flight Linter Engine for Fortran.
 *
 * Implements 10 diagnostic rules (M4070–M4079) covering data-flow, bounds,
 * control-flow reachability, and state-storage analysis.
 */

export interface FortranDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
}

export const FortranErrorCode = {
  UNDECLARED_VARIABLE: {
    code: 4070,
    id: "M4070",
    rule: "undeclared-variable",
    severity: "error" as const,
    message: (varName: string) => `Variable '${varName}' referenced without declaration under strict typing.`,
  },
  UNINITIALIZED_VARIABLE: {
    code: 4071,
    id: "M4071",
    rule: "uninitialized-variable",
    severity: "warning" as const,
    message: (varName: string) => `Variable '${varName}' may be used before being assigned a value.`,
  },
  CONSTANT_DIVISION_BY_ZERO: {
    code: 4072,
    id: "M4072",
    rule: "constant-division-by-zero",
    severity: "error" as const,
    message: () => `Division by constant zero detected in arithmetic expression.`,
  },
  STORAGE_BOUNDS_OVERFLOW: {
    code: 4073,
    id: "M4073",
    rule: "storage-bounds-overflow",
    severity: "error" as const,
    message: (arrayName: string, index: number, maxCapacity: number) =>
      `Storage array index ${arrayName}(${index}) exceeds allocated capacity of ${maxCapacity}.`,
  },
  DEAD_CODE_AFTER_RETURN: {
    code: 4074,
    id: "M4074",
    rule: "dead-code-after-return",
    severity: "warning" as const,
    message: () => `Unreachable statements detected following unconditional RETURN.`,
  },
  DO_LOOP_INDEX_MUTATION: {
    code: 4075,
    id: "M4075",
    rule: "do-loop-index-mutation",
    severity: "error" as const,
    message: (indexVar: string) => `DO-loop index variable '${indexVar}' is modified within its loop body.`,
  },
  PROCEDURAL_ALGEBRAIC_LOOP: {
    code: 4076,
    id: "M4076",
    rule: "procedural-algebraic-loop",
    severity: "warning" as const,
    message: (cycleStr: string) =>
      `Algebraic cycle detected among procedural assignments without time-step lag: ${cycleStr}.`,
  },
  COMMON_BLOCK_MISMATCH: {
    code: 4077,
    id: "M4077",
    rule: "common-block-mismatch",
    severity: "error" as const,
    message: (blockName: string, reason: string) => `COMMON block '/${blockName}/' definition conflict: ${reason}.`,
  },
  ARRAY_DIMENSION_UNDERFLOW: {
    code: 4078,
    id: "M4078",
    rule: "array-dimension-underflow",
    severity: "error" as const,
    message: (arrName: string, dim: number) =>
      `Array '${arrName}' declared with non-positive dimension size (${dim} <= 0).`,
  },
  OBSOLETE_ARITHMETIC_IF: {
    code: 4079,
    id: "M4079",
    rule: "obsolete-arithmetic-if",
    severity: "info" as const,
    message: () => `Three-way arithmetic IF is obsolescent; prefer structured IF/THEN/ELSE.`,
  },
};

/**
 * Runs all 10 Fortran linter rules across a Fortran source code string.
 */
export function lintFortranSource(
  source: string,
  options?: { numRealStates?: number; numIntStates?: number },
): FortranDiagnostic[] {
  const diagnostics: FortranDiagnostic[] = [];
  const lines = source.split(/\r?\n/);

  // Line offset mapping
  const lineOffsets: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineOffsets.push(lineOffsets[i]! + lines[i]!.length + 1);
  }

  const declaredVars = new Set<string>();
  const assignedVars = new Set<string>();
  const readVars = new Set<string>();
  let hasImplicitNone = false;
  let maxRealStorage = options?.numRealStates ?? 0;
  let maxIntStorage = options?.numIntStates ?? 0;
  const commonBlocks = new Map<string, string[]>();

  let insideDoLoop: { indexVar: string; startLine: number } | null = null;
  let sawUnconditionalReturn = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = lineOffsets[lineIdx]!;
    let trimmed = rawLine.trim();

    // Skip comment lines
    if (trimmed.startsWith("!") || (/^[Cc*]\s/.test(rawLine) && !trimmed.startsWith("CALL "))) {
      continue;
    }

    // Strip inline comments
    const exclam = trimmed.indexOf("!");
    if (exclam >= 0) {
      trimmed = trimmed.slice(0, exclam).trim();
    }
    if (!trimmed) continue;

    // 1. Dead Code After Return (M4074)
    if (sawUnconditionalReturn) {
      // Check if this line is an executable statement (not END or END SUBROUTINE)
      if (!/^(END\b|SUBROUTINE\b|FUNCTION\b)/i.test(trimmed)) {
        diagnostics.push({
          ...FortranErrorCode.DEAD_CODE_AFTER_RETURN,
          severity: FortranErrorCode.DEAD_CODE_AFTER_RETURN.severity,
          message: FortranErrorCode.DEAD_CODE_AFTER_RETURN.message(),
          startOffset: lineStartOffset,
          endOffset: lineStartOffset + rawLine.length,
          line: lineIdx + 1,
          column: 1,
        });
        sawUnconditionalReturn = false; // Only flag once per block
      } else {
        sawUnconditionalReturn = false;
      }
    }

    if (/^RETURN\b/i.test(trimmed)) {
      sawUnconditionalReturn = true;
    }

    // 2. Storage Directives & Limits (#STORAGE REAL:m INTEGER:n)
    const storageMatch = /#STORAGE\b(.*)/i.exec(trimmed);
    if (storageMatch) {
      const realM = /REAL\s*:\s*([0-9]+)/i.exec(storageMatch[1]!);
      if (realM) maxRealStorage = Math.max(maxRealStorage, parseInt(realM[1]!, 10));
      const intM = /INTEGER\s*:\s*([0-9]+)/i.exec(storageMatch[1]!);
      if (intM) maxIntStorage = Math.max(maxIntStorage, parseInt(intM[1]!, 10));
    }

    // 3. Declarations (IMPLICIT NONE, #LOCAL, REAL, INTEGER)
    if (/^IMPLICIT\s+NONE\b/i.test(trimmed)) {
      hasImplicitNone = true;
    }

    const localMatch = /#LOCAL\s+(?:REAL|INTEGER)\b(.*)/i.exec(trimmed);
    if (localMatch) {
      const vars = localMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const v of vars) declaredVars.add(v);
    }

    const typeDeclMatch = /^(?:REAL|INTEGER|DOUBLE\s+PRECISION|LOGICAL|DIMENSION)\b(?:\s*::)?\s*(.*)/i.exec(trimmed);
    if (typeDeclMatch && !trimmed.startsWith("REALPOLE") && !trimmed.includes("=")) {
      const decls = splitTopLevelCommas(typeDeclMatch[1]!);
      for (const d of decls) {
        const idMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(d);
        if (idMatch) declaredVars.add(idMatch[1]!);

        // 4. Array Dimension Underflow Check (M4078)
        const dimMatch = /\(([^)]+)\)/.exec(d);
        if (dimMatch && idMatch) {
          const dims = dimMatch[1]!.split(",").map((s) => s.trim());
          for (const dm of dims) {
            const num = parseInt(dm, 10);
            if (!isNaN(num) && num <= 0) {
              const col = rawLine.indexOf(d) + 1;
              diagnostics.push({
                ...FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW,
                severity: FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW.severity,
                message: FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW.message(idMatch[1]!, num),
                startOffset: lineStartOffset + col - 1,
                endOffset: lineStartOffset + col - 1 + d.length,
                line: lineIdx + 1,
                column: col,
              });
            }
          }
        }
      }
    }

    // 5. Common Block Checking (M4077)
    const commonMatch = /^COMMON\s*\/([A-Za-z0-9_]+)\/\s*(.*)/i.exec(trimmed);
    if (commonMatch) {
      const blockName = commonMatch[1]!.toUpperCase();
      const vars = commonMatch[2]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const v of vars) declaredVars.add(v);

      if (commonBlocks.has(blockName)) {
        const existing = commonBlocks.get(blockName)!;
        if (existing.length !== vars.length) {
          diagnostics.push({
            ...FortranErrorCode.COMMON_BLOCK_MISMATCH,
            severity: FortranErrorCode.COMMON_BLOCK_MISMATCH.severity,
            message: FortranErrorCode.COMMON_BLOCK_MISMATCH.message(
              blockName,
              `Length mismatch: previously declared with ${existing.length} elements, here with ${vars.length}`,
            ),
            startOffset: lineStartOffset,
            endOffset: lineStartOffset + rawLine.length,
            line: lineIdx + 1,
            column: 1,
          });
        }
      } else {
        commonBlocks.set(blockName, vars);
      }
    }

    // 6. DO-Loop Tracking & Mutation (M4075)
    const doMatch = /^DO\b(?:\s+[0-9]+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/i.exec(trimmed);
    if (doMatch) {
      insideDoLoop = { indexVar: doMatch[1]!, startLine: lineIdx + 1 };
      declaredVars.add(doMatch[1]!);
      assignedVars.add(doMatch[1]!);
    } else if (/^(END\s*DO|ENDDO)\b/i.test(trimmed)) {
      insideDoLoop = null;
    }

    // 7. Division By Constant Zero (M4072)
    const divZeroMatch = /\/\s*(?:0(?:\.0*)?|\.0+)\b/.exec(trimmed);
    if (divZeroMatch) {
      const col = trimmed.indexOf(divZeroMatch[0]) + 1;
      diagnostics.push({
        ...FortranErrorCode.CONSTANT_DIVISION_BY_ZERO,
        severity: FortranErrorCode.CONSTANT_DIVISION_BY_ZERO.severity,
        message: FortranErrorCode.CONSTANT_DIVISION_BY_ZERO.message(),
        startOffset: lineStartOffset + col - 1,
        endOffset: lineStartOffset + col - 1 + divZeroMatch[0].length,
        line: lineIdx + 1,
        column: col,
      });
    }

    // 8. Storage Bounds Checking (M4073)
    const stateMatch = /\b(STORF|STORI)\s*\(\s*([0-9]+)\s*\)/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = stateMatch.exec(trimmed)) !== null) {
      const arr = sMatch[1]!.toUpperCase();
      const idx = parseInt(sMatch[2]!, 10);
      const cap = arr === "STORF" ? maxRealStorage : maxIntStorage;
      if (cap > 0 && idx > cap) {
        const col = trimmed.indexOf(sMatch[0]) + 1;
        diagnostics.push({
          ...FortranErrorCode.STORAGE_BOUNDS_OVERFLOW,
          severity: FortranErrorCode.STORAGE_BOUNDS_OVERFLOW.severity,
          message: FortranErrorCode.STORAGE_BOUNDS_OVERFLOW.message(arr, idx, cap),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + sMatch[0].length,
          line: lineIdx + 1,
          column: col,
        });
      }
    }

    // 9. Assignment & DO Loop Index Mutation (M4075)
    const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(trimmed);
    if (assignMatch) {
      const target = assignMatch[1]!;
      const rhs = assignMatch[2]!;

      if (insideDoLoop && target.toUpperCase() === insideDoLoop.indexVar.toUpperCase()) {
        const col = rawLine.indexOf(target) + 1;
        diagnostics.push({
          ...FortranErrorCode.DO_LOOP_INDEX_MUTATION,
          severity: FortranErrorCode.DO_LOOP_INDEX_MUTATION.severity,
          message: FortranErrorCode.DO_LOOP_INDEX_MUTATION.message(target),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + target.length,
          line: lineIdx + 1,
          column: col,
        });
      }

      if (!target.startsWith("$")) {
        if (hasImplicitNone && !declaredVars.has(target)) {
          const col = rawLine.indexOf(target) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNDECLARED_VARIABLE,
            severity: FortranErrorCode.UNDECLARED_VARIABLE.severity,
            message: FortranErrorCode.UNDECLARED_VARIABLE.message(target),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + target.length,
            line: lineIdx + 1,
            column: col,
          });
        }
        assignedVars.add(target);
      }

      // Check RHS variables for uninitialized / undeclared reads
      const rhsIdRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rhsIdRegex.exec(rhs)) !== null) {
        const id = rMatch[1]!;
        // Ignore math intrinsics, constants, keywords
        if (/^(SQRT|SIN|COS|TAN|EXP|LOG|ABS|MAX|MIN|MOD|SIGN|ATAN|ATAN2|TIME|DELT|FIRSTSTEP)$/i.test(id)) {
          continue;
        }

        readVars.add(id);

        if (hasImplicitNone && !declaredVars.has(id)) {
          const col = rawLine.indexOf(id, assignMatch[0].indexOf(rhs)) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNDECLARED_VARIABLE,
            severity: FortranErrorCode.UNDECLARED_VARIABLE.severity,
            message: FortranErrorCode.UNDECLARED_VARIABLE.message(id),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + id.length,
            line: lineIdx + 1,
            column: col,
          });
        } else if (!assignedVars.has(id) && (declaredVars.has(id) || !hasImplicitNone)) {
          // Uninitialized warning
          const col = rawLine.indexOf(id, assignMatch[0].indexOf(rhs)) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNINITIALIZED_VARIABLE,
            severity: FortranErrorCode.UNINITIALIZED_VARIABLE.severity,
            message: FortranErrorCode.UNINITIALIZED_VARIABLE.message(id),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + id.length,
            line: lineIdx + 1,
            column: col,
          });
          assignedVars.add(id); // Only warn once
        }
      }
    }

    // 10. Obsolete Arithmetic IF (M4079)
    // Syntax: IF (expr) label1, label2, label3
    const arithIfMatch = /^IF\s*\([^)]+\)\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)$/i.exec(trimmed);
    if (arithIfMatch) {
      diagnostics.push({
        ...FortranErrorCode.OBSOLETE_ARITHMETIC_IF,
        severity: FortranErrorCode.OBSOLETE_ARITHMETIC_IF.severity,
        message: FortranErrorCode.OBSOLETE_ARITHMETIC_IF.message(),
        startOffset: lineStartOffset,
        endOffset: lineStartOffset + rawLine.length,
        line: lineIdx + 1,
        column: 1,
      });
    }
  }

  // 11. Procedural Algebraic Loop Detection (M4076)
  // Check if variable A depends on B and B depends on A within procedural assignments
  const dependencies = new Map<string, Set<string>>();
  for (const line of lines) {
    const trimmed = line.trim();
    const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (assignMatch) {
      const lhs = assignMatch[1]!.toUpperCase();
      const rhs = assignMatch[2]!;
      if (!dependencies.has(lhs)) dependencies.set(lhs, new Set());

      const rhsIdRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = rhsIdRegex.exec(rhs)) !== null) {
        const id = m[1]!.toUpperCase();
        if (id !== lhs && !/^(SQRT|SIN|COS|TAN|EXP|LOG|ABS|TIME|DELT)$/i.test(id)) {
          dependencies.get(lhs)!.add(id);
        }
      }
    }
  }

  for (const [varA, depsA] of dependencies.entries()) {
    for (const varB of depsA) {
      if (dependencies.has(varB) && dependencies.get(varB)!.has(varA)) {
        // Direct circular loop A -> B -> A
        if (varA < varB) {
          diagnostics.push({
            ...FortranErrorCode.PROCEDURAL_ALGEBRAIC_LOOP,
            severity: FortranErrorCode.PROCEDURAL_ALGEBRAIC_LOOP.severity,
            message: FortranErrorCode.PROCEDURAL_ALGEBRAIC_LOOP.message(`${varA} <-> ${varB}`),
            startOffset: 0,
            endOffset: Math.min(source.length, 10),
            line: 1,
            column: 1,
          });
        }
      }
    }
  }

  return diagnostics;
}

export const lintFortran = lintFortranSource;

function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
