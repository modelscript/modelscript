// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Static Analysis & Linter Engine (MPS1001–MPS5006).
 */

import { MpsErrorCode } from "../errors.js";
import { parseMps } from "../parser/mps-parser.js";
import type { MpsModel } from "../types.js";

export { MpsErrorCode };

export interface MpsDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  symbol?: string | undefined;
}

/**
 * Runs all MPS1001–MPS5006 static analysis checks on a parsed MpsModel or raw MPS source string.
 */
export function lintMps(input: MpsModel | string): MpsDiagnostic[] {
  const model = typeof input === "string" ? parseMps(input) : input;
  const diags: MpsDiagnostic[] = [];

  // 1. Structural card presence checks (MPS1002–MPS1004)
  if (!model.hasNameCard) {
    diags.push({
      code: MpsErrorCode.MISSING_NAME.code,
      id: MpsErrorCode.MISSING_NAME.id,
      rule: MpsErrorCode.MISSING_NAME.rule,
      severity: MpsErrorCode.MISSING_NAME.severity,
      message: MpsErrorCode.MISSING_NAME.message(),
      line: 1,
      column: 1,
    });
  }

  if (!model.hasRowsSection) {
    diags.push({
      code: MpsErrorCode.MISSING_ROWS.code,
      id: MpsErrorCode.MISSING_ROWS.id,
      rule: MpsErrorCode.MISSING_ROWS.rule,
      severity: MpsErrorCode.MISSING_ROWS.severity,
      message: MpsErrorCode.MISSING_ROWS.message(),
      line: 1,
      column: 1,
    });
  }

  if (!model.hasEndataCard) {
    diags.push({
      code: MpsErrorCode.MISSING_ENDATA.code,
      id: MpsErrorCode.MISSING_ENDATA.id,
      rule: MpsErrorCode.MISSING_ENDATA.rule,
      severity: MpsErrorCode.MISSING_ENDATA.severity,
      message: MpsErrorCode.MISSING_ENDATA.message(),
    });
  }

  // 2. Forward parse-time issues (MPS1001, MPS2001–MPS2006, MPS3001–MPS3002, MPS5005–MPS5006)
  for (const issue of model.parseIssues) {
    const loc = {
      line: issue.span?.line,
      column: issue.span?.column,
      startOffset: issue.span?.startOffset,
      endOffset: issue.span?.endOffset,
    };

    switch (issue.kind) {
      case "syntax-error":
        diags.push({
          code: MpsErrorCode.SYNTAX_ERROR.code,
          id: MpsErrorCode.SYNTAX_ERROR.id,
          rule: MpsErrorCode.SYNTAX_ERROR.rule,
          severity: MpsErrorCode.SYNTAX_ERROR.severity,
          message: MpsErrorCode.SYNTAX_ERROR.message(issue.message),
          ...loc,
        });
        break;
      case "duplicate-row":
        diags.push({
          code: MpsErrorCode.DUPLICATE_ROW.code,
          id: MpsErrorCode.DUPLICATE_ROW.id,
          rule: MpsErrorCode.DUPLICATE_ROW.rule,
          severity: MpsErrorCode.DUPLICATE_ROW.severity,
          message: MpsErrorCode.DUPLICATE_ROW.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "invalid-row-type":
        diags.push({
          code: MpsErrorCode.INVALID_ROW_TYPE.code,
          id: MpsErrorCode.INVALID_ROW_TYPE.id,
          rule: MpsErrorCode.INVALID_ROW_TYPE.rule,
          severity: MpsErrorCode.INVALID_ROW_TYPE.severity,
          message: MpsErrorCode.INVALID_ROW_TYPE.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "undefined-row-columns": {
        const [rowName = "", colName = ""] = (issue.symbol ?? "").split("|");
        diags.push({
          code: MpsErrorCode.UNDEFINED_ROW_IN_COLUMNS.code,
          id: MpsErrorCode.UNDEFINED_ROW_IN_COLUMNS.id,
          rule: MpsErrorCode.UNDEFINED_ROW_IN_COLUMNS.rule,
          severity: MpsErrorCode.UNDEFINED_ROW_IN_COLUMNS.severity,
          message: MpsErrorCode.UNDEFINED_ROW_IN_COLUMNS.message(rowName, colName),
          symbol: rowName,
          ...loc,
        });
        break;
      }
      case "undefined-row-rhs":
        diags.push({
          code: MpsErrorCode.UNDEFINED_ROW_IN_RHS.code,
          id: MpsErrorCode.UNDEFINED_ROW_IN_RHS.id,
          rule: MpsErrorCode.UNDEFINED_ROW_IN_RHS.rule,
          severity: MpsErrorCode.UNDEFINED_ROW_IN_RHS.severity,
          message: MpsErrorCode.UNDEFINED_ROW_IN_RHS.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "undefined-row-ranges":
        diags.push({
          code: MpsErrorCode.UNDEFINED_ROW_IN_RANGES.code,
          id: MpsErrorCode.UNDEFINED_ROW_IN_RANGES.id,
          rule: MpsErrorCode.UNDEFINED_ROW_IN_RANGES.rule,
          severity: MpsErrorCode.UNDEFINED_ROW_IN_RANGES.severity,
          message: MpsErrorCode.UNDEFINED_ROW_IN_RANGES.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "undefined-col-bounds":
        diags.push({
          code: MpsErrorCode.UNDEFINED_COLUMN_IN_BOUNDS.code,
          id: MpsErrorCode.UNDEFINED_COLUMN_IN_BOUNDS.id,
          rule: MpsErrorCode.UNDEFINED_COLUMN_IN_BOUNDS.rule,
          severity: MpsErrorCode.UNDEFINED_COLUMN_IN_BOUNDS.severity,
          message: MpsErrorCode.UNDEFINED_COLUMN_IN_BOUNDS.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "undefined-col-quadobj":
        diags.push({
          code: MpsErrorCode.UNDEFINED_COLUMN_IN_QUADOBJ.code,
          id: MpsErrorCode.UNDEFINED_COLUMN_IN_QUADOBJ.id,
          rule: MpsErrorCode.UNDEFINED_COLUMN_IN_QUADOBJ.rule,
          severity: MpsErrorCode.UNDEFINED_COLUMN_IN_QUADOBJ.severity,
          message: MpsErrorCode.UNDEFINED_COLUMN_IN_QUADOBJ.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "invalid-bound-type":
        diags.push({
          code: MpsErrorCode.INVALID_BOUND_TYPE.code,
          id: MpsErrorCode.INVALID_BOUND_TYPE.id,
          rule: MpsErrorCode.INVALID_BOUND_TYPE.rule,
          severity: MpsErrorCode.INVALID_BOUND_TYPE.severity,
          message: MpsErrorCode.INVALID_BOUND_TYPE.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
      case "duplicate-column-entry": {
        const [colName = "", rowName = ""] = (issue.symbol ?? "").split("|");
        diags.push({
          code: MpsErrorCode.DUPLICATE_COLUMN_ENTRY.code,
          id: MpsErrorCode.DUPLICATE_COLUMN_ENTRY.id,
          rule: MpsErrorCode.DUPLICATE_COLUMN_ENTRY.rule,
          severity: MpsErrorCode.DUPLICATE_COLUMN_ENTRY.severity,
          message: MpsErrorCode.DUPLICATE_COLUMN_ENTRY.message(colName, rowName),
          symbol: colName,
          ...loc,
        });
        break;
      }
      case "range-on-objective":
        diags.push({
          code: MpsErrorCode.RANGE_ON_OBJECTIVE_ROW.code,
          id: MpsErrorCode.RANGE_ON_OBJECTIVE_ROW.id,
          rule: MpsErrorCode.RANGE_ON_OBJECTIVE_ROW.rule,
          severity: MpsErrorCode.RANGE_ON_OBJECTIVE_ROW.severity,
          message: MpsErrorCode.RANGE_ON_OBJECTIVE_ROW.message(issue.symbol ?? ""),
          symbol: issue.symbol,
          ...loc,
        });
        break;
    }
  }

  // 3. Bound consistency & MIP checks (MPS4001–MPS4002, MPS5004)
  for (const col of model.columns.values()) {
    if (col.lb > col.ub + 1e-12) {
      diags.push({
        code: MpsErrorCode.CONTRADICTORY_BOUNDS.code,
        id: MpsErrorCode.CONTRADICTORY_BOUNDS.id,
        rule: MpsErrorCode.CONTRADICTORY_BOUNDS.rule,
        severity: MpsErrorCode.CONTRADICTORY_BOUNDS.severity,
        message: MpsErrorCode.CONTRADICTORY_BOUNDS.message(col.name, col.lb, col.ub),
        symbol: col.name,
        line: col.span?.line,
        column: col.span?.column,
      });
    }

    if (col.varType === "integer" && !Number.isFinite(col.lb) && !Number.isFinite(col.ub)) {
      diags.push({
        code: MpsErrorCode.FREE_VARIABLE_IN_MIP.code,
        id: MpsErrorCode.FREE_VARIABLE_IN_MIP.id,
        rule: MpsErrorCode.FREE_VARIABLE_IN_MIP.rule,
        severity: MpsErrorCode.FREE_VARIABLE_IN_MIP.severity,
        message: MpsErrorCode.FREE_VARIABLE_IN_MIP.message(col.name),
        symbol: col.name,
        line: col.span?.line,
        column: col.span?.column,
      });
    }
  }

  if (model.unclosedIntorgLine !== undefined) {
    diags.push({
      code: MpsErrorCode.UNMATCHED_INTEGER_MARKER.code,
      id: MpsErrorCode.UNMATCHED_INTEGER_MARKER.id,
      rule: MpsErrorCode.UNMATCHED_INTEGER_MARKER.rule,
      severity: MpsErrorCode.UNMATCHED_INTEGER_MARKER.severity,
      message: MpsErrorCode.UNMATCHED_INTEGER_MARKER.message(),
      line: model.unclosedIntorgLine,
      column: 1,
    });
  }

  // 4. Semantic formulation checks (MPS5001–MPS5003)
  if (model.hasRowsSection && !model.objectiveRow) {
    diags.push({
      code: MpsErrorCode.MISSING_OBJECTIVE_ROW.code,
      id: MpsErrorCode.MISSING_OBJECTIVE_ROW.id,
      rule: MpsErrorCode.MISSING_OBJECTIVE_ROW.rule,
      severity: MpsErrorCode.MISSING_OBJECTIVE_ROW.severity,
      message: MpsErrorCode.MISSING_OBJECTIVE_ROW.message(),
      line: 1,
      column: 1,
    });
  }

  if (model.columns.size === 0) {
    diags.push({
      code: MpsErrorCode.EMPTY_PROBLEM.code,
      id: MpsErrorCode.EMPTY_PROBLEM.id,
      rule: MpsErrorCode.EMPTY_PROBLEM.rule,
      severity: MpsErrorCode.EMPTY_PROBLEM.severity,
      message: MpsErrorCode.EMPTY_PROBLEM.message(),
      line: 1,
      column: 1,
    });
  }

  // Check for empty constraint rows
  const rowNonZeros = new Set<string>();
  for (const col of model.columns.values()) {
    for (const e of col.entries) {
      if (Math.abs(e.coeff) > 1e-15) {
        rowNonZeros.add(e.rowName);
      }
    }
  }

  for (const row of model.rows.values()) {
    if (row.type !== "N" && !rowNonZeros.has(row.name)) {
      diags.push({
        code: MpsErrorCode.EMPTY_CONSTRAINT_ROW.code,
        id: MpsErrorCode.EMPTY_CONSTRAINT_ROW.id,
        rule: MpsErrorCode.EMPTY_CONSTRAINT_ROW.rule,
        severity: MpsErrorCode.EMPTY_CONSTRAINT_ROW.severity,
        message: MpsErrorCode.EMPTY_CONSTRAINT_ROW.message(row.name),
        symbol: row.name,
        line: row.span?.line,
        column: row.span?.column,
      });
    }
  }

  return diags;
}
