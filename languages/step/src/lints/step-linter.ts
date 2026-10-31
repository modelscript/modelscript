// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepErrorCode } from "../errors.js";
import { parseStepReferences, scanStepEntities } from "../schema.js";

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

const SUPPORTED_STEP_SCHEMA_RE =
  /AP203|AP214|AP242|AUTOMOTIVE_DESIGN|CONFIG_CONTROL_DESIGN|MANAGED_MODEL_BASED_3D_ENGINEERING|\b(?:203|214|242)\b/i;

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = Math.max(0, low - 1);
  return {
    line: lineIdx + 1,
    column: offset - (lineStarts[lineIdx] ?? 0) + 1,
  };
}

/**
 * Pre-flight static linter for STEP (ISO 10303-21) exchange files.
 */
export function lintStepContent(content: string): StepDiagnostic[] {
  const diagnostics: StepDiagnostic[] = [];
  const lines = content.split(/\r?\n/);
  const lineStarts = computeLineStarts(content);

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
  const upperContent = content.toUpperCase();
  const headerIdx = upperContent.indexOf("HEADER;");
  const headerEndIdx = headerIdx !== -1 ? upperContent.indexOf("ENDSEC;", headerIdx + 7) : -1;
  const hasHeader = headerIdx !== -1 && headerEndIdx !== -1;
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
    const headerBody = content.slice(headerIdx + 7, headerEndIdx);
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
    } else {
      const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(headerBody);
      const schemaName = schemaMatch?.[1]?.trim();
      if (schemaName && !SUPPORTED_STEP_SCHEMA_RE.test(schemaName)) {
        const pos = offsetToLineCol(headerIdx + 7 + (schemaMatch?.index ?? 0), lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.UNSUPPORTED_AP_SCHEMA.code}`,
          numericCode: StepErrorCode.UNSUPPORTED_AP_SCHEMA.code,
          rule: StepErrorCode.UNSUPPORTED_AP_SCHEMA.rule,
          severity: StepErrorCode.UNSUPPORTED_AP_SCHEMA.severity,
          message: StepErrorCode.UNSUPPORTED_AP_SCHEMA.message(schemaName),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  // 3. Check DATA section & Entity References
  const dataIdx = upperContent.indexOf("DATA;");
  const dataEndIdx = dataIdx !== -1 ? upperContent.indexOf("ENDSEC;", dataIdx + 5) : -1;
  const hasData = dataIdx !== -1 && dataEndIdx !== -1;
  if (!hasData) {
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

  const dataBaseOffset = dataIdx + 5;
  const dataBody = content.slice(dataBaseOffset, dataEndIdx);
  const entities = scanStepEntities(dataBody);
  const { references } = parseStepReferences(dataBody);

  const definedEntities = new Set<string>();
  for (const ent of entities) {
    const eid = ent.id.startsWith("#") ? ent.id.slice(1) : ent.id;
    if (definedEntities.has(ent.id)) {
      const pos = offsetToLineCol(dataBaseOffset + ent.startOffset, lineStarts);
      diagnostics.push({
        code: `T${StepErrorCode.DUPLICATE_ENTITY_ID.code}`,
        numericCode: StepErrorCode.DUPLICATE_ENTITY_ID.code,
        rule: StepErrorCode.DUPLICATE_ENTITY_ID.rule,
        severity: StepErrorCode.DUPLICATE_ENTITY_ID.severity,
        message: StepErrorCode.DUPLICATE_ENTITY_ID.message(eid),
        line: pos.line,
        column: pos.column,
      });
    } else {
      definedEntities.add(ent.id);
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

  // Verify all entity references resolve (ignoring # inside strings and /* ... */ comments)
  for (const ref of references) {
    if (!definedEntities.has(ref.id)) {
      const eid = ref.id.startsWith("#") ? ref.id.slice(1) : ref.id;
      const pos = offsetToLineCol(dataBaseOffset + ref.startOffset, lineStarts);
      diagnostics.push({
        code: `T${StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code}`,
        numericCode: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code,
        rule: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.rule,
        severity: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.severity,
        message: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.message(eid),
        line: pos.line,
        column: pos.column,
      });
    }
  }

  return diagnostics;
}
