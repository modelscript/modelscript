// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Pre-Flight Linter Engine for Fortran.
 *
 * Implements 15 diagnostic rules (M4070–M4084) covering syntax validation,
 * identifier matching, intent(in) immutability, data-flow, bounds,
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
  IDENTIFIER_MISMATCH: {
    code: 4080,
    id: "M4080",
    rule: "identifier-mismatch",
    severity: "error" as const,
    message: (unitKind: string, startName: string, endName: string) =>
      `End ${unitKind} identifier '${endName}' does not match '${startName}'.`,
  },
  INTENT_IN_MUTATION: {
    code: 4081,
    id: "M4081",
    rule: "intent-in-mutation",
    severity: "error" as const,
    message: (varName: string) => `Dummy argument '${varName}' declared with 'INTENT(IN)' cannot be modified.`,
  },
  INVALID_STATEMENT_SYNTAX: {
    code: 4082,
    id: "M4082",
    rule: "invalid-statement-syntax",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in Fortran statement: ${detail}.`,
  },
  UNCLOSED_BLOCK: {
    code: 4083,
    id: "M4083",
    rule: "unclosed-block",
    severity: "error" as const,
    message: (blockName: string) => `Unclosed or mismatched '${blockName}' block structure.`,
  },
  MATH_DOMAIN_VIOLATION: {
    code: 4084,
    id: "M4084",
    rule: "math-domain-violation",
    severity: "error" as const,
    message: (fnName: string, argVal: string) =>
      `Intrinsic math function '${fnName}' evaluated outside its real domain with argument '${argVal}'.`,
  },
};

function hasBalancedParens(line: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth < 0) return false;
      }
    }
  }
  return depth === 0;
}

/**
 * Runs all Fortran linter rules (M4070–M4084) across a Fortran source code string.
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

  // Pre-scan subroutine and function signatures for inter-procedural checks & user function recognition
  const userUnitSignatures = new Map<
    string,
    { kind: "SUBROUTINE" | "FUNCTION"; params: string[]; intents: Map<string, "in" | "out" | "inout"> }
  >();
  {
    let curUnit: {
      kind: "SUBROUTINE" | "FUNCTION";
      name: string;
      params: string[];
      intents: Map<string, "in" | "out" | "inout">;
    } | null = null;
    for (const raw of lines) {
      let t = raw.trim();
      if (t.startsWith("!")) continue;
      const ex = t.indexOf("!");
      if (ex >= 0) t = t.slice(0, ex).trim();
      if (!t) continue;
      const hdr =
        /^(?:(?:PURE|ELEMENTAL|RECURSIVE|REAL(?:\s*\([^)]*\))?|INTEGER(?:\s*\([^)]*\))?|DOUBLE\s+PRECISION|LOGICAL)\s+)*(SUBROUTINE|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/i.exec(
          t,
        );
      if (hdr) {
        const kind = hdr[1]!.toUpperCase() as "SUBROUTINE" | "FUNCTION";
        const name = hdr[2]!.toUpperCase();
        const params = (hdr[3] ?? "")
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        curUnit = { kind, name, params, intents: new Map() };
        userUnitSignatures.set(name, curUnit);
        continue;
      }
      if (/^END(?:\s+(?:SUBROUTINE|FUNCTION))?\b/i.test(t)) {
        curUnit = null;
        continue;
      }
      if (curUnit && t.includes("::")) {
        const parts = t.split("::");
        const attrPart = parts[0]!;
        const rhsPart = parts.slice(1).join("::");
        let intent: "in" | "out" | "inout" | null = null;
        if (/\bINTENT\s*\(\s*IN\s*OUT\s*\)/i.test(attrPart)) intent = "inout";
        else if (/\bINTENT\s*\(\s*OUT\s*\)/i.test(attrPart)) intent = "out";
        else if (/\bINTENT\s*\(\s*IN\s*\)/i.test(attrPart)) intent = "in";
        if (intent) {
          for (const d of splitTopLevelCommas(rhsPart)) {
            const idm = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(d.trim());
            if (idm) {
              curUnit.intents.set(idm[1]!.toUpperCase(), intent);
            }
          }
        }
      }
    }
  }

  const moduleDeclaredVars = new Set<string>();
  const moduleAssignedVars = new Set<string>();
  const moduleIntentInVars = new Set<string>();

  const declaredVars = new Set<string>();
  const assignedVars = new Set<string>();
  const subArgVars = new Set<string>();
  const intentInVars = new Set<string>();
  const intentOutOnlyVars = new Set<string>();
  const readVars = new Set<string>();
  let hasImplicitNone = false;
  let moduleHasImplicitNone = false;
  let inModuleHeader = false;
  let maxRealStorage = options?.numRealStates ?? 0;
  let maxIntStorage = options?.numIntStates ?? 0;
  const commonBlocks = new Map<string, string[]>();

  let insideDoLoop: { indexVar: string; startLine: number } | null = null;
  let sawUnconditionalReturn = false;

  const unitStack: { kind: string; name: string; line: number; col: number }[] = [];
  const controlStack: { kind: "IF" | "DO"; line: number; col: number }[] = [];

  const resetUnitScope = () => {
    declaredVars.clear();
    assignedVars.clear();
    subArgVars.clear();
    intentInVars.clear();
    intentOutOnlyVars.clear();
    readVars.clear();
    for (const v of moduleDeclaredVars) declaredVars.add(v);
    for (const v of moduleAssignedVars) assignedVars.add(v);
    for (const v of moduleIntentInVars) intentInVars.add(v);
    for (const [uName, sig] of userUnitSignatures.entries()) {
      if (sig.kind === "FUNCTION") {
        declaredVars.add(uName);
        assignedVars.add(uName);
      }
    }
    hasImplicitNone = moduleHasImplicitNone;
    insideDoLoop = null;
    sawUnconditionalReturn = false;
  };

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

    // Check balanced parentheses on the line
    if (!hasBalancedParens(trimmed)) {
      const col = rawLine.indexOf(trimmed) + 1;
      diagnostics.push({
        ...FortranErrorCode.INVALID_STATEMENT_SYNTAX,
        severity: FortranErrorCode.INVALID_STATEMENT_SYNTAX.severity,
        message: FortranErrorCode.INVALID_STATEMENT_SYNTAX.message("unbalanced parentheses in statement"),
        startOffset: lineStartOffset + col - 1,
        endOffset: lineStartOffset + col - 1 + trimmed.length,
        line: lineIdx + 1,
        column: col,
        endLine: lineIdx + 1,
        endColumn: col + trimmed.length,
      });
    }

    // 1. Dead Code After Return (M4074)
    if (sawUnconditionalReturn) {
      if (!/^(END\b|SUBROUTINE\b|FUNCTION\b|PROGRAM\b|MODULE\b|CONTAINS\b|ELSE\b|ELSEIF\b)/i.test(trimmed)) {
        const col = rawLine.indexOf(trimmed) + 1;
        diagnostics.push({
          ...FortranErrorCode.DEAD_CODE_AFTER_RETURN,
          severity: FortranErrorCode.DEAD_CODE_AFTER_RETURN.severity,
          message: FortranErrorCode.DEAD_CODE_AFTER_RETURN.message(),
          startOffset: lineStartOffset,
          endOffset: lineStartOffset + rawLine.length,
          line: lineIdx + 1,
          column: 1,
          endLine: lineIdx + 1,
          endColumn: col + trimmed.length,
        });
        sawUnconditionalReturn = false; // Only flag once per block
      } else {
        sawUnconditionalReturn = false;
      }
    }

    if (/^RETURN\b/i.test(trimmed)) {
      sawUnconditionalReturn = true;
    }

    if (/^CONTAINS\b/i.test(trimmed)) {
      inModuleHeader = false;
      continue;
    }

    // 2. Storage Directives & Limits (#STORAGE REAL:m INTEGER:n)
    const storageMatch = /#STORAGE\b(.*)/i.exec(trimmed);
    if (storageMatch) {
      const realM = /REAL\s*:\s*([0-9]+)/i.exec(storageMatch[1]!);
      if (realM) maxRealStorage = Math.max(maxRealStorage, parseInt(realM[1]!, 10));
      const intM = /INTEGER\s*:\s*([0-9]+)/i.exec(storageMatch[1]!);
      if (intM) maxIntStorage = Math.max(maxIntStorage, parseInt(intM[1]!, 10));
      continue;
    }

    // 3. IMPLICIT NONE & trailing-token syntax validation (M4082)
    const implicitMatch = /^IMPLICIT\s+NONE\b(.*)$/i.exec(trimmed);
    if (implicitMatch) {
      hasImplicitNone = true;
      if (inModuleHeader) moduleHasImplicitNone = true;
      const trailing = implicitMatch[1]!.trim();
      if (trailing.length > 0) {
        const col = rawLine.lastIndexOf(trailing) + 1;
        diagnostics.push({
          ...FortranErrorCode.INVALID_STATEMENT_SYNTAX,
          severity: FortranErrorCode.INVALID_STATEMENT_SYNTAX.severity,
          message: FortranErrorCode.INVALID_STATEMENT_SYNTAX.message(
            `unexpected trailing token '${trailing}' after 'IMPLICIT NONE'`,
          ),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + trailing.length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + trailing.length,
        });
      }
      continue;
    }

    // 4. Program Unit Header (SUBROUTINE, FUNCTION, MODULE, PROGRAM)
    const unitHeaderMatch =
      /^(?:(?:PURE|ELEMENTAL|RECURSIVE|REAL(?:\([^)]*\))?|INTEGER(?:\([^)]*\))?|DOUBLE\s+PRECISION|LOGICAL)\s+)*(SUBROUTINE|FUNCTION|MODULE|PROGRAM)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?(?:\s+(\S.*))?$/i.exec(
        trimmed,
      );
    if (unitHeaderMatch) {
      const unitKind = unitHeaderMatch[1]!.toUpperCase();
      const unitName = unitHeaderMatch[2]!;
      const paramStr = unitHeaderMatch[3];
      const trailing = (unitHeaderMatch[4] ?? "").trim();

      const col = rawLine.indexOf(unitName) + 1;
      unitStack.push({ kind: unitKind, name: unitName, line: lineIdx + 1, col });

      if (unitKind === "MODULE") {
        inModuleHeader = true;
        moduleDeclaredVars.clear();
        moduleAssignedVars.clear();
        moduleIntentInVars.clear();
        moduleHasImplicitNone = false;
        resetUnitScope();
      } else {
        inModuleHeader = false;
        resetUnitScope();
      }

      if (unitKind === "FUNCTION") {
        declaredVars.add(unitName.toUpperCase());
      }

      if (paramStr) {
        const args = paramStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const a of args) {
          declaredVars.add(a.toUpperCase());
          assignedVars.add(a.toUpperCase());
          subArgVars.add(a.toUpperCase());
        }
      }

      const resMatch = /^RESULT\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i.exec(trailing);
      if (resMatch) {
        declaredVars.add(resMatch[1]!.toUpperCase());
      } else if (trailing) {
        const tCol = rawLine.lastIndexOf(trailing) + 1;
        diagnostics.push({
          ...FortranErrorCode.INVALID_STATEMENT_SYNTAX,
          severity: FortranErrorCode.INVALID_STATEMENT_SYNTAX.severity,
          message: FortranErrorCode.INVALID_STATEMENT_SYNTAX.message(
            `unexpected token '${trailing}' in ${unitKind.toLowerCase()} header`,
          ),
          startOffset: lineStartOffset + tCol - 1,
          endOffset: lineStartOffset + tCol - 1 + trailing.length,
          line: lineIdx + 1,
          column: tCol,
          endLine: lineIdx + 1,
          endColumn: tCol + trailing.length,
        });
      }
      continue;
    }

    // 5. END Statement (END IF, END DO, END SUBROUTINE [name], etc.)
    const endIfMatch = /^(?:END\s+IF|ENDIF)\b(.*)$/i.exec(trimmed);
    if (endIfMatch) {
      if (controlStack.length === 0 || controlStack[controlStack.length - 1]!.kind !== "IF") {
        const col = rawLine.indexOf(trimmed) + 1;
        diagnostics.push({
          ...FortranErrorCode.UNCLOSED_BLOCK,
          severity: FortranErrorCode.UNCLOSED_BLOCK.severity,
          message: FortranErrorCode.UNCLOSED_BLOCK.message("END IF"),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + trimmed.length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + trimmed.length,
        });
      } else {
        controlStack.pop();
      }
      continue;
    }

    const endDoMatch = /^(?:END\s+DO|ENDDO)\b(.*)$/i.exec(trimmed);
    if (endDoMatch) {
      insideDoLoop = null;
      if (controlStack.length === 0 || controlStack[controlStack.length - 1]!.kind !== "DO") {
        const col = rawLine.indexOf(trimmed) + 1;
        diagnostics.push({
          ...FortranErrorCode.UNCLOSED_BLOCK,
          severity: FortranErrorCode.UNCLOSED_BLOCK.severity,
          message: FortranErrorCode.UNCLOSED_BLOCK.message("END DO"),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + trimmed.length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + trimmed.length,
        });
      } else {
        controlStack.pop();
      }
      continue;
    }

    const endUnitMatch = /^END(?:\s+(SUBROUTINE|FUNCTION|MODULE|PROGRAM))?(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s*$/i.exec(
      trimmed,
    );
    if (endUnitMatch) {
      const endKind = endUnitMatch[1]?.toUpperCase();
      const endName = endUnitMatch[2];
      const currentUnit = unitStack.pop();
      if (currentUnit) {
        if (endName && endName.toUpperCase() !== currentUnit.name.toUpperCase()) {
          const col = rawLine.lastIndexOf(endName) + 1;
          diagnostics.push({
            ...FortranErrorCode.IDENTIFIER_MISMATCH,
            severity: FortranErrorCode.IDENTIFIER_MISMATCH.severity,
            message: FortranErrorCode.IDENTIFIER_MISMATCH.message(
              currentUnit.kind.toLowerCase(),
              currentUnit.name,
              endName,
            ),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + endName.length,
            line: lineIdx + 1,
            column: col,
            endLine: lineIdx + 1,
            endColumn: col + endName.length,
          });
        } else if (endKind && endKind !== currentUnit.kind) {
          const col = rawLine.indexOf(endUnitMatch[1]!) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNCLOSED_BLOCK,
            severity: FortranErrorCode.UNCLOSED_BLOCK.severity,
            message: FortranErrorCode.UNCLOSED_BLOCK.message(`END ${endKind} (expected END ${currentUnit.kind})`),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + endKind.length,
            line: lineIdx + 1,
            column: col,
            endLine: lineIdx + 1,
            endColumn: col + endKind.length,
          });
        }
        if (currentUnit.kind === "MODULE") {
          inModuleHeader = false;
          moduleDeclaredVars.clear();
          moduleAssignedVars.clear();
          moduleIntentInVars.clear();
          moduleHasImplicitNone = false;
        }
      }
      continue;
    }

    const localMatch = /#LOCAL\s+(?:REAL|INTEGER)\b(.*)/i.exec(trimmed);
    if (localMatch) {
      const vars = localMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const v of vars) declaredVars.add(v.toUpperCase());
      continue;
    }

    if (trimmed.startsWith("#")) {
      continue;
    }

    // PARAMETER (NAME = VAL, ...)
    const paramStmtMatch = /^PARAMETER\s*\((.*)\)$/i.exec(trimmed);
    if (paramStmtMatch) {
      const pairs = splitTopLevelCommas(paramStmtMatch[1]!);
      for (const p of pairs) {
        const eq = p.indexOf("=");
        if (eq > 0) {
          const pName = p.slice(0, eq).trim().toUpperCase();
          declaredVars.add(pName);
          assignedVars.add(pName);
          intentInVars.add(pName);
          if (inModuleHeader) {
            moduleDeclaredVars.add(pName);
            moduleAssignedVars.add(pName);
            moduleIntentInVars.add(pName);
          }
        }
      }
      continue;
    }

    // ALLOCATE / DEALLOCATE statements
    const allocStmtMatch = /^(ALLOCATE|DEALLOCATE)\s*\((.*)\)$/i.exec(trimmed);
    if (allocStmtMatch) {
      const isAllocate = allocStmtMatch[1]!.toUpperCase() === "ALLOCATE";
      const items = splitTopLevelCommas(allocStmtMatch[2]!);
      for (const item of items) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/.exec(item.trim());
        if (m) {
          const arrName = m[1]!;
          const arrUpper = arrName.toUpperCase();
          if (hasImplicitNone && !declaredVars.has(arrUpper)) {
            const col = rawLine.indexOf(arrName) + 1;
            diagnostics.push({
              ...FortranErrorCode.UNDECLARED_VARIABLE,
              severity: FortranErrorCode.UNDECLARED_VARIABLE.severity,
              message: FortranErrorCode.UNDECLARED_VARIABLE.message(arrName),
              startOffset: lineStartOffset + col - 1,
              endOffset: lineStartOffset + col - 1 + arrName.length,
              line: lineIdx + 1,
              column: col,
              endLine: lineIdx + 1,
              endColumn: col + arrName.length,
            });
          }
          if (isAllocate) {
            assignedVars.add(arrUpper);
            if (m[2]) {
              for (const dm of splitTopLevelCommas(m[2])) {
                const num = parseInt(dm.trim(), 10);
                if (!isNaN(num) && num <= 0) {
                  const col = rawLine.indexOf(item) + 1;
                  diagnostics.push({
                    ...FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW,
                    severity: FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW.severity,
                    message: FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW.message(arrName, num),
                    startOffset: lineStartOffset + col - 1,
                    endOffset: lineStartOffset + col - 1 + item.length,
                    line: lineIdx + 1,
                    column: col,
                    endLine: lineIdx + 1,
                    endColumn: col + item.length,
                  });
                }
              }
            }
          }
        }
      }
      continue;
    }

    const typeDeclMatch =
      /^(?:REAL(?:\*[0-9]+|\s*\([^)]*\))?|INTEGER(?:\*[0-9]+|\s*\([^)]*\))?|DOUBLE\s+PRECISION|LOGICAL|COMPLEX|CHARACTER(?:\*[0-9]+|\s*\([^)]*\))?|DIMENSION)\b(.*)$/i.exec(
        trimmed,
      );
    if (
      typeDeclMatch &&
      !trimmed.toUpperCase().startsWith("REALPOLE") &&
      (!trimmed.includes("=") || trimmed.includes("::"))
    ) {
      const fullAfterType = typeDeclMatch[1]!;
      const doubleColonIdx = fullAfterType.indexOf("::");
      const attrPart = doubleColonIdx >= 0 ? fullAfterType.slice(0, doubleColonIdx) : "";
      const rhsDecls = doubleColonIdx >= 0 ? fullAfterType.slice(doubleColonIdx + 2) : fullAfterType;

      const isIntentInOnly = /\bINTENT\s*\(\s*IN\s*\)/i.test(attrPart);
      const isIntentOutOnly = /\bINTENT\s*\(\s*OUT\s*\)/i.test(attrPart);
      const isIntentInOut = /\bINTENT\s*\(\s*IN\s*OUT\s*\)/i.test(attrPart);
      const isParamAttr = /\bPARAMETER\b/i.test(attrPart);
      const hasDimensionAttr = /\bDIMENSION\s*\([^)]*\)/i.test(attrPart);

      if (hasDimensionAttr) {
        const attrDimMatch = /\bDIMENSION\s*\(([^)]*)\)/i.exec(attrPart);
        if (attrDimMatch) {
          for (const dm of attrDimMatch[1]!.split(",")) {
            const num = parseInt(dm.trim(), 10);
            if (!isNaN(num) && num <= 0) {
              const firstDeclId = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rhsDecls.trim())?.[1] ?? "array";
              const col = rawLine.indexOf(attrDimMatch[0]) + 1;
              diagnostics.push({
                ...FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW,
                severity: FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW.severity,
                message: FortranErrorCode.ARRAY_DIMENSION_UNDERFLOW.message(firstDeclId, num),
                startOffset: lineStartOffset + col - 1,
                endOffset: lineStartOffset + col - 1 + attrDimMatch[0].length,
                line: lineIdx + 1,
                column: col,
                endLine: lineIdx + 1,
                endColumn: col + attrDimMatch[0].length,
              });
            }
          }
        }
      }

      const decls = splitTopLevelCommas(rhsDecls);
      for (const d of decls) {
        const idMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(d);
        if (idMatch) {
          const varUpper = idMatch[1]!.toUpperCase();
          declaredVars.add(varUpper);
          if (inModuleHeader) moduleDeclaredVars.add(varUpper);

          // Fixed-size arrays are considered allocated/addressable container objects
          const openParen = d.indexOf("(");
          const closeParen = d.lastIndexOf(")");
          const hasFixedDims =
            (openParen !== -1 && closeParen > openParen && !d.slice(openParen + 1, closeParen).includes(":")) ||
            (hasDimensionAttr && !/\bALLOCATABLE\b/i.test(attrPart));

          if (d.includes("=") || isIntentInOnly || isIntentInOut || isParamAttr || hasFixedDims) {
            assignedVars.add(varUpper);
            if (inModuleHeader) moduleAssignedVars.add(varUpper);
          }
          if (isIntentInOnly || isParamAttr) {
            intentInVars.add(varUpper);
            if (inModuleHeader) moduleIntentInVars.add(varUpper);
          }
          if (isIntentOutOnly && !d.includes("=")) {
            intentOutOnlyVars.add(varUpper);
          }
        }

        // Array Dimension Underflow Check (M4078)
        const openParen = d.indexOf("(");
        const closeParen = d.lastIndexOf(")");
        if (openParen !== -1 && closeParen > openParen && idMatch) {
          const dims = d
            .slice(openParen + 1, closeParen)
            .split(",")
            .map((s) => s.trim());
          for (const dm of dims) {
            if (dm === ":") continue;
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
                endLine: lineIdx + 1,
                endColumn: col + d.length,
              });
            }
          }
        }
      }
      continue;
    }

    // 5. Common Block Checking (M4077)
    const commonMatch = /^COMMON\s*\/([A-Za-z0-9_]+)\/\s*(.*)/i.exec(trimmed);
    if (commonMatch) {
      const blockName = commonMatch[1]!.toUpperCase();
      const vars = commonMatch[2]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const v of vars) {
        declaredVars.add(v.toUpperCase());
        assignedVars.add(v.toUpperCase());
      }

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
            endLine: lineIdx + 1,
            endColumn: rawLine.length + 1,
          });
        }
      } else {
        commonBlocks.set(blockName, vars);
      }
      continue;
    }

    // 6. DO-Loop Tracking & Mutation (M4075)
    const doMatch = /^DO\b(?:\s+[0-9]+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/i.exec(trimmed);
    if (doMatch) {
      insideDoLoop = { indexVar: doMatch[1]!, startLine: lineIdx + 1 };
      controlStack.push({ kind: "DO", line: lineIdx + 1, col: rawLine.indexOf(trimmed) + 1 });
      declaredVars.add(doMatch[1]!.toUpperCase());
      assignedVars.add(doMatch[1]!.toUpperCase());
      continue;
    }

    // Track Block IF (IF (...) THEN)
    if (/^IF\s*\(.*\)\s*THEN\s*$/i.test(trimmed)) {
      controlStack.push({ kind: "IF", line: lineIdx + 1, col: rawLine.indexOf(trimmed) + 1 });
    }

    // 7. Division By Constant Zero (M4072)
    const divZeroMatch = /\/\s*(?:0(?:\.0*)?|\.0+)\b/.exec(trimmed);
    if (divZeroMatch && !trimmed.includes("(/") && !trimmed.includes("/)")) {
      const col = rawLine.indexOf(divZeroMatch[0]) + 1;
      diagnostics.push({
        ...FortranErrorCode.CONSTANT_DIVISION_BY_ZERO,
        severity: FortranErrorCode.CONSTANT_DIVISION_BY_ZERO.severity,
        message: FortranErrorCode.CONSTANT_DIVISION_BY_ZERO.message(),
        startOffset: lineStartOffset + col - 1,
        endOffset: lineStartOffset + col - 1 + divZeroMatch[0].length,
        line: lineIdx + 1,
        column: col,
        endLine: lineIdx + 1,
        endColumn: col + divZeroMatch[0].length,
      });
    }

    // 7b. Static Math Domain Violation (M4084): SQRT(<0), LOG(<=0), LOG10(<=0), ASIN(|x|>1), ACOS(|x|>1)
    const mathCallRegex =
      /\b(SQRT|LOG|LOG10|ALOG|ASIN|ACOS)\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*\)/gi;
    let mathMatch: RegExpExecArray | null;
    while ((mathMatch = mathCallRegex.exec(trimmed)) !== null) {
      const fnName = mathMatch[1]!.toUpperCase();
      const argStr = mathMatch[2]!;
      const val = parseFloat(argStr);
      const isInvalid =
        (fnName === "SQRT" && val < 0) ||
        ((fnName === "LOG" || fnName === "LOG10" || fnName === "ALOG") && val <= 0) ||
        ((fnName === "ASIN" || fnName === "ACOS") && (val < -1 || val > 1));
      if (isInvalid) {
        const col = rawLine.indexOf(mathMatch[0]) + 1;
        diagnostics.push({
          ...FortranErrorCode.MATH_DOMAIN_VIOLATION,
          severity: FortranErrorCode.MATH_DOMAIN_VIOLATION.severity,
          message: FortranErrorCode.MATH_DOMAIN_VIOLATION.message(mathMatch[1]!, argStr),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + mathMatch[0].length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + mathMatch[0].length,
        });
      }
    }

    // 8. Storage Bounds Checking (M4073)
    const stateMatch = /\b(STORF|STORI)\s*\(\s*([0-9]+)\s*\)/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = stateMatch.exec(trimmed)) !== null) {
      const arr = sMatch[1]!.toUpperCase();
      const idx = parseInt(sMatch[2]!, 10);
      const cap = arr === "STORF" ? maxRealStorage : maxIntStorage;
      if (cap > 0 && idx > cap) {
        const col = rawLine.indexOf(sMatch[0]) + 1;
        diagnostics.push({
          ...FortranErrorCode.STORAGE_BOUNDS_OVERFLOW,
          severity: FortranErrorCode.STORAGE_BOUNDS_OVERFLOW.severity,
          message: FortranErrorCode.STORAGE_BOUNDS_OVERFLOW.message(arr, idx, cap),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + sMatch[0].length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + sMatch[0].length,
        });
      }
    }

    // 9. Assignment, Intent(in) Mutation (M4081) & DO Loop Index Mutation (M4075)
    const eqIdx = trimmed.indexOf("=");
    let assignTarget: string | null = null;
    let assignSubscriptExpr = "";
    let assignRhs = "";
    if (eqIdx !== -1 && !/^(?:IF|ELSE\s*IF|DO)\b/i.test(trimmed)) {
      const lhs = trimmed.slice(0, eqIdx).trim();
      if (/^([A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z0-9_]+)$/.test(lhs)) {
        assignTarget = lhs;
        assignRhs = trimmed.slice(eqIdx + 1).trim();
      } else {
        const arrLhsMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/.exec(lhs);
        if (arrLhsMatch) {
          const baseName = arrLhsMatch[1]!;
          if (!/^(STORF|STORI|SD|S|X)$/i.test(baseName)) {
            assignTarget = baseName;
            assignSubscriptExpr = arrLhsMatch[2]!;
            assignRhs = trimmed.slice(eqIdx + 1).trim();
          }
        }
      }
    }
    if (assignTarget) {
      const target = assignTarget;
      const targetUpper = target.toUpperCase();
      const rhs = assignRhs;
      const rhsColStart = rawLine.indexOf(rhs, rawLine.indexOf("=") + 1);

      if (insideDoLoop && targetUpper === insideDoLoop.indexVar.toUpperCase() && !assignSubscriptExpr) {
        const col = rawLine.indexOf(target) + 1;
        diagnostics.push({
          ...FortranErrorCode.DO_LOOP_INDEX_MUTATION,
          severity: FortranErrorCode.DO_LOOP_INDEX_MUTATION.severity,
          message: FortranErrorCode.DO_LOOP_INDEX_MUTATION.message(target),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + target.length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + target.length,
        });
      }

      if (intentInVars.has(targetUpper)) {
        const col = rawLine.indexOf(target) + 1;
        diagnostics.push({
          ...FortranErrorCode.INTENT_IN_MUTATION,
          severity: FortranErrorCode.INTENT_IN_MUTATION.severity,
          message: FortranErrorCode.INTENT_IN_MUTATION.message(target),
          startOffset: lineStartOffset + col - 1,
          endOffset: lineStartOffset + col - 1 + target.length,
          line: lineIdx + 1,
          column: col,
          endLine: lineIdx + 1,
          endColumn: col + target.length,
        });
      }

      if (!target.startsWith("$")) {
        if (hasImplicitNone && !declaredVars.has(targetUpper)) {
          const col = rawLine.indexOf(target) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNDECLARED_VARIABLE,
            severity: FortranErrorCode.UNDECLARED_VARIABLE.severity,
            message: FortranErrorCode.UNDECLARED_VARIABLE.message(target),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + target.length,
            line: lineIdx + 1,
            column: col,
            endLine: lineIdx + 1,
            endColumn: col + target.length,
          });
        }
        assignedVars.add(targetUpper);
      }

      // Check RHS variables (and array LHS subscript expressions) for uninitialized / undeclared reads
      const combinedReadExpr = assignSubscriptExpr ? `${assignSubscriptExpr} , ${rhs}` : rhs;
      const rhsIdRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rhsIdRegex.exec(combinedReadExpr)) !== null) {
        const id = rMatch[1]!;
        const idUpper = id.toUpperCase();
        // Ignore math/array intrinsics, constants, keywords, scientific notation exponents
        if (
          /^(SQRT|SIN|COS|TAN|ASIN|ACOS|ATAN|ATAN2|EXP|LOG|LOG10|ALOG|ABS|MAX|MIN|MOD|SIGN|REAL|INT|DBLE|SUM|MAXVAL|MINVAL|SIZE|DOT_PRODUCT|MATMUL|TRANSPOSE|RESHAPE|ALLOCATED|LBOUND|UBOUND|SHAPE|TIME|DELT|FIRSTSTEP|STORF|STORI|NSTORF|NSTORI|S|SD|X|TRUE|FALSE|AND|OR|NOT|EQ|NE|LT|LE|GT|GE)$/i.test(
            id,
          )
        ) {
          continue;
        }
        if (rMatch.index > 0 && /[0-9.]/.test(combinedReadExpr[rMatch.index - 1]!)) {
          continue;
        }

        readVars.add(idUpper);

        if (hasImplicitNone && !declaredVars.has(idUpper)) {
          const col = rawLine.indexOf(id, rhsColStart >= 0 ? rhsColStart : 0) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNDECLARED_VARIABLE,
            severity: FortranErrorCode.UNDECLARED_VARIABLE.severity,
            message: FortranErrorCode.UNDECLARED_VARIABLE.message(id),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + id.length,
            line: lineIdx + 1,
            column: col,
            endLine: lineIdx + 1,
            endColumn: col + id.length,
          });
        } else if (!assignedVars.has(idUpper) && (declaredVars.has(idUpper) || !hasImplicitNone)) {
          // Uninitialized warning
          const col = rawLine.indexOf(id, rhsColStart >= 0 ? rhsColStart : 0) + 1;
          diagnostics.push({
            ...FortranErrorCode.UNINITIALIZED_VARIABLE,
            severity: FortranErrorCode.UNINITIALIZED_VARIABLE.severity,
            message: FortranErrorCode.UNINITIALIZED_VARIABLE.message(id),
            startOffset: lineStartOffset + col - 1,
            endOffset: lineStartOffset + col - 1 + id.length,
            line: lineIdx + 1,
            column: col,
            endLine: lineIdx + 1,
            endColumn: col + id.length,
          });
          assignedVars.add(idUpper); // Only warn once
        }
      }
      continue;
    }

    // 10. Obsolete Arithmetic IF (M4079)
    // Syntax: IF (expr) label1, label2, label3
    const arithIfMatch = /^IF\s*\([^)]+\)\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)$/i.exec(trimmed);
    if (arithIfMatch) {
      const col = rawLine.indexOf(trimmed) + 1;
      diagnostics.push({
        ...FortranErrorCode.OBSOLETE_ARITHMETIC_IF,
        severity: FortranErrorCode.OBSOLETE_ARITHMETIC_IF.severity,
        message: FortranErrorCode.OBSOLETE_ARITHMETIC_IF.message(),
        startOffset: lineStartOffset,
        endOffset: lineStartOffset + rawLine.length,
        line: lineIdx + 1,
        column: 1,
        endLine: lineIdx + 1,
        endColumn: col + trimmed.length,
      });
      continue;
    }

    // Check CALL statement for reading/mutating variables, inter-procedural INTENT(IN) violation, and syntax
    const callStmtMatch = /^CALL\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/i.exec(trimmed);
    if (callStmtMatch) {
      const calleeName = callStmtMatch[1]!.toUpperCase();
      const calleeSig = userUnitSignatures.get(calleeName);
      const argStr = callStmtMatch[2];
      if (argStr) {
        const callArgs = splitTopLevelCommas(argStr);
        for (let idx = 0; idx < callArgs.length; idx++) {
          const ca = callArgs[idx]!.trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ca)) {
            const caUpper = ca.toUpperCase();
            const formalName = calleeSig?.params[idx];
            const formalIntent = formalName ? calleeSig?.intents.get(formalName) : undefined;
            if (formalIntent === "out" || formalIntent === "inout") {
              if (intentInVars.has(caUpper)) {
                const col = rawLine.lastIndexOf(ca) + 1;
                diagnostics.push({
                  ...FortranErrorCode.INTENT_IN_MUTATION,
                  severity: FortranErrorCode.INTENT_IN_MUTATION.severity,
                  message: FortranErrorCode.INTENT_IN_MUTATION.message(ca),
                  startOffset: lineStartOffset + col - 1,
                  endOffset: lineStartOffset + col - 1 + ca.length,
                  line: lineIdx + 1,
                  column: col,
                  endLine: lineIdx + 1,
                  endColumn: col + ca.length,
                });
              }
              assignedVars.add(caUpper);
            } else if (!formalIntent) {
              // Built-in or untyped subroutine parameter may be output
              assignedVars.add(caUpper);
            }
          }
        }
      }
      continue;
    }

    // Check unrecognized statement syntax (M4082)
    const stmtEqIdx = trimmed.indexOf("=");
    const isAssignment =
      stmtEqIdx !== -1 && /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:\s*\([^)]*\))?$/.test(trimmed.slice(0, stmtEqIdx).trim());

    const isKnownStatement =
      /^(?:IF\s*\(|ELSE\s*IF\s*\(|ELSEIF\s*\(|ELSE\b|RETURN\b|CONTINUE\b|[0-9]+\s+CONTINUE\b|STOP\b|IMPLICIT\b|USE\b|CONTAINS\b|INTERFACE\b|SELECT\s+CASE\b|CASE\b|EXIT\b|CYCLE\b|ALLOCATE\b|DEALLOCATE\b|PUBLIC\b|PRIVATE\b|SAVE\b)/i.test(
        trimmed,
      ) || isAssignment;

    if (!isKnownStatement) {
      const col = rawLine.indexOf(trimmed) + 1;
      diagnostics.push({
        ...FortranErrorCode.INVALID_STATEMENT_SYNTAX,
        severity: FortranErrorCode.INVALID_STATEMENT_SYNTAX.severity,
        message: FortranErrorCode.INVALID_STATEMENT_SYNTAX.message(`unrecognized Fortran statement '${trimmed}'`),
        startOffset: lineStartOffset + col - 1,
        endOffset: lineStartOffset + col - 1 + trimmed.length,
        line: lineIdx + 1,
        column: col,
        endLine: lineIdx + 1,
        endColumn: col + trimmed.length,
      });
    }
  }

  // Check for unclosed control blocks (IF / DO) and program units (SUBROUTINE / FUNCTION / MODULE / PROGRAM)
  for (const unclosed of controlStack) {
    const lineIdx = unclosed.line - 1;
    const rawLine = lines[lineIdx] ?? "";
    const lineStartOffset = lineOffsets[lineIdx] ?? 0;
    diagnostics.push({
      ...FortranErrorCode.UNCLOSED_BLOCK,
      severity: FortranErrorCode.UNCLOSED_BLOCK.severity,
      message: FortranErrorCode.UNCLOSED_BLOCK.message(unclosed.kind),
      startOffset: lineStartOffset + unclosed.col - 1,
      endOffset: lineStartOffset + rawLine.length,
      line: unclosed.line,
      column: unclosed.col,
      endLine: unclosed.line,
      endColumn: rawLine.length + 1,
    });
  }

  for (const unclosedUnit of unitStack) {
    const lineIdx = unclosedUnit.line - 1;
    const rawLine = lines[lineIdx] ?? "";
    const lineStartOffset = lineOffsets[lineIdx] ?? 0;
    diagnostics.push({
      ...FortranErrorCode.UNCLOSED_BLOCK,
      severity: FortranErrorCode.UNCLOSED_BLOCK.severity,
      message: FortranErrorCode.UNCLOSED_BLOCK.message(`${unclosedUnit.kind} ${unclosedUnit.name}`),
      startOffset: lineStartOffset + unclosedUnit.col - 1,
      endOffset: lineStartOffset + rawLine.length,
      line: unclosedUnit.line,
      column: unclosedUnit.col,
      endLine: unclosedUnit.line,
      endColumn: rawLine.length + 1,
    });
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
            endLine: 1,
            endColumn: 10,
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
