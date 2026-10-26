// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepErrorCode } from "../errors.js";

export interface StepDiagnostic {
  code: string; // e.g. "T1001", "T1005"
  numericCode: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Pre-flight static linter for STEP (ISO 10303-21) exchange files.
 */
export function lintStepContent(content: string): StepDiagnostic[] {
  const diagnostics: StepDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  // 1. Check Framing
  const trimmed = content.trim();
  if (!trimmed.startsWith("ISO-10303-21;")) {
    diagnostics.push({
      code: `T${StepErrorCode.STEP_SYNTAX_ERROR.code}`,
      numericCode: StepErrorCode.STEP_SYNTAX_ERROR.code,
      rule: StepErrorCode.STEP_SYNTAX_ERROR.rule,
      severity: StepErrorCode.STEP_SYNTAX_ERROR.severity,
      message: StepErrorCode.STEP_SYNTAX_ERROR.message("Missing required header tag 'ISO-10303-21;'"),
      line: 1,
      column: 1,
    });
  }

  if (!trimmed.endsWith("END-ISO-10303-21;")) {
    diagnostics.push({
      code: `T${StepErrorCode.STEP_SYNTAX_ERROR.code}`,
      numericCode: StepErrorCode.STEP_SYNTAX_ERROR.code,
      rule: StepErrorCode.STEP_SYNTAX_ERROR.rule,
      severity: StepErrorCode.STEP_SYNTAX_ERROR.severity,
      message: StepErrorCode.STEP_SYNTAX_ERROR.message("Missing required closing tag 'END-ISO-10303-21;'"),
      line: lines.length,
      column: Math.max(1, lines[lines.length - 1]?.length ?? 1),
    });
  }

  // 2. Check HEADER section
  const hasHeader = /HEADER;/i.test(content) && /ENDSEC;/i.test(content);
  if (!hasHeader) {
    diagnostics.push({
      code: `T${StepErrorCode.MISSING_HEADER_SECTION.code}`,
      numericCode: StepErrorCode.MISSING_HEADER_SECTION.code,
      rule: StepErrorCode.MISSING_HEADER_SECTION.rule,
      severity: StepErrorCode.MISSING_HEADER_SECTION.severity,
      message: StepErrorCode.MISSING_HEADER_SECTION.message(),
      line: 1,
      column: 1,
    });
  } else {
    // Check FILE_SCHEMA inside HEADER
    const headerMatch = content.match(/HEADER;([\s\S]*?)ENDSEC;/i);
    if (headerMatch) {
      const headerBody = headerMatch[1] ?? "";
      if (!/FILE_SCHEMA/i.test(headerBody)) {
        diagnostics.push({
          code: `T${StepErrorCode.MISSING_SCHEMA_DECLARATION.code}`,
          numericCode: StepErrorCode.MISSING_SCHEMA_DECLARATION.code,
          rule: StepErrorCode.MISSING_SCHEMA_DECLARATION.rule,
          severity: StepErrorCode.MISSING_SCHEMA_DECLARATION.severity,
          message: StepErrorCode.MISSING_SCHEMA_DECLARATION.message(),
          line: 2,
          column: 1,
        });
      }
    }
  }

  // 3. Check DATA section & Entity References
  const dataMatch = content.match(/DATA;([\s\S]*?)ENDSEC;/i);
  if (!dataMatch) {
    diagnostics.push({
      code: `T${StepErrorCode.MISSING_DATA_SECTION.code}`,
      numericCode: StepErrorCode.MISSING_DATA_SECTION.code,
      rule: StepErrorCode.MISSING_DATA_SECTION.rule,
      severity: StepErrorCode.MISSING_DATA_SECTION.severity,
      message: StepErrorCode.MISSING_DATA_SECTION.message(),
      line: 1,
      column: 1,
    });
    return diagnostics;
  }

  const definedEntities = new Set<string>();
  const entityLineMap = new Map<string, number>();
  const referencedEntities: { id: string; line: number; col: number }[] = [];

  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l]!;
    // Match entity definition: #123 = ...
    const defMatch = lineText.match(/^\s*#([0-9]+)\s*=/);
    if (defMatch) {
      const eid = defMatch[1]!;
      if (definedEntities.has(eid)) {
        diagnostics.push({
          code: `T${StepErrorCode.DUPLICATE_ENTITY_ID.code}`,
          numericCode: StepErrorCode.DUPLICATE_ENTITY_ID.code,
          rule: StepErrorCode.DUPLICATE_ENTITY_ID.rule,
          severity: StepErrorCode.DUPLICATE_ENTITY_ID.severity,
          message: StepErrorCode.DUPLICATE_ENTITY_ID.message(eid),
          line: l + 1,
          column: lineText.indexOf(`#${eid}`) + 1,
        });
      } else {
        definedEntities.add(eid);
        entityLineMap.set(eid, l + 1);
      }
    }

    // Match referenced entities in RHS: (#456, ...)
    const eqIdx = lineText.indexOf("=");
    if (eqIdx !== -1) {
      const rhs = lineText.slice(eqIdx + 1);
      const refMatches = rhs.matchAll(/#([0-9]+)/g);
      for (const rm of refMatches) {
        if (rm[1]) {
          referencedEntities.push({
            id: rm[1],
            line: l + 1,
            col: eqIdx + 1 + (rm.index ?? 0) + 1,
          });
        }
      }
    }
  }

  if (definedEntities.size === 0) {
    diagnostics.push({
      code: `T${StepErrorCode.EMPTY_DATA_SECTION.code}`,
      numericCode: StepErrorCode.EMPTY_DATA_SECTION.code,
      rule: StepErrorCode.EMPTY_DATA_SECTION.rule,
      severity: StepErrorCode.EMPTY_DATA_SECTION.severity,
      message: StepErrorCode.EMPTY_DATA_SECTION.message(),
      line: 1,
      column: 1,
    });
  }

  // Verify all entity references resolve
  for (const ref of referencedEntities) {
    if (!definedEntities.has(ref.id)) {
      diagnostics.push({
        code: `T${StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code}`,
        numericCode: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code,
        rule: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.rule,
        severity: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.severity,
        message: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.message(ref.id),
        line: ref.line,
        column: ref.col,
      });
    }
  }

  return diagnostics;
}
