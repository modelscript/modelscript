// SPDX-License-Identifier: AGPL-3.0-or-later

import { lookupMosisLayerRule } from "../catalog/cif-std-schemas.js";
import { CifErrorCode, type CifSeverity } from "../errors.js";
import type { CifCommand, CifDocument } from "../types.js";

export interface CifDiagnostic {
  id: string;
  code: string;
  rule: string;
  severity: CifSeverity;
  message: string;
  line: number;
  column: number;
  symbolId?: number | undefined;
  layer?: string | undefined;
}

export interface CifLintOptions {
  /**
   * Value of 1 Mead-Conway lambda (λ) in CIF units (centimicrons).
   * Default: `100` (1 λ = 1.0 µm = 100 CIF units).
   */
  lambdaCifUnits?: number;
  /**
   * Enable MOSIS SCMOS / Mead-Conway minimum-width DRC checks.
   * Default: `true`.
   */
  checkDrc?: boolean;
}

function checkCommandList(
  commands: CifCommand[],
  doc: CifDocument,
  scaleFactor: number,
  lambdaCifUnits: number,
  checkDrc: boolean,
  diags: CifDiagnostic[],
  symbolId?: number,
): void {
  let currentLayer: string | null = null;

  for (const cmd of commands) {
    if (cmd.kind === "L") {
      currentLayer = cmd.layer;
      continue;
    }

    if (cmd.kind === "C") {
      if (!doc.symbols.has(cmd.symbolId)) {
        diags.push({
          id: CifErrorCode.UNDEFINED_SYMBOL_CALL.code,
          code: CifErrorCode.UNDEFINED_SYMBOL_CALL.code,
          rule: CifErrorCode.UNDEFINED_SYMBOL_CALL.rule,
          severity: CifErrorCode.UNDEFINED_SYMBOL_CALL.severity,
          message: CifErrorCode.UNDEFINED_SYMBOL_CALL.message(cmd.symbolId),
          line: cmd.line,
          column: cmd.column,
          symbolId: cmd.symbolId,
        });
      }
      for (const t of cmd.transforms) {
        if (t.kind === "R" && t.x === 0 && t.y === 0) {
          diags.push({
            id: CifErrorCode.ZERO_ROTATION_VECTOR.code,
            code: CifErrorCode.ZERO_ROTATION_VECTOR.code,
            rule: CifErrorCode.ZERO_ROTATION_VECTOR.rule,
            severity: CifErrorCode.ZERO_ROTATION_VECTOR.severity,
            message: CifErrorCode.ZERO_ROTATION_VECTOR.message(`C ${cmd.symbolId} R`),
            line: cmd.line,
            column: cmd.column,
            symbolId,
          });
        }
      }
      continue;
    }

    if (cmd.kind === "B" || cmd.kind === "P" || cmd.kind === "R" || cmd.kind === "W") {
      if (!currentLayer) {
        diags.push({
          id: CifErrorCode.GEOMETRY_BEFORE_LAYER.code,
          code: CifErrorCode.GEOMETRY_BEFORE_LAYER.code,
          rule: CifErrorCode.GEOMETRY_BEFORE_LAYER.rule,
          severity: CifErrorCode.GEOMETRY_BEFORE_LAYER.severity,
          message: CifErrorCode.GEOMETRY_BEFORE_LAYER.message(cmd.kind),
          line: cmd.line,
          column: cmd.column,
          symbolId,
        });
      }

      const layerRule = currentLayer ? lookupMosisLayerRule(currentLayer) : undefined;

      if (cmd.kind === "B") {
        if (cmd.length <= 0 || cmd.width <= 0) {
          diags.push({
            id: CifErrorCode.NON_POSITIVE_BOX_DIM.code,
            code: CifErrorCode.NON_POSITIVE_BOX_DIM.code,
            rule: CifErrorCode.NON_POSITIVE_BOX_DIM.rule,
            severity: CifErrorCode.NON_POSITIVE_BOX_DIM.severity,
            message: CifErrorCode.NON_POSITIVE_BOX_DIM.message(cmd.length, cmd.width),
            line: cmd.line,
            column: cmd.column,
            symbolId,
            layer: currentLayer ?? undefined,
          });
        } else if (checkDrc && layerRule) {
          const minFeature = Math.min(cmd.length, cmd.width) * scaleFactor;
          const required = layerRule.minWidthLambda * lambdaCifUnits;
          if (minFeature + 1e-9 < required) {
            diags.push({
              id: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code,
              code: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code,
              rule: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.rule,
              severity: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.severity,
              message: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.message(
                layerRule.layer,
                minFeature,
                required,
                layerRule.minWidthLambda,
              ),
              line: cmd.line,
              column: cmd.column,
              symbolId,
              layer: layerRule.layer,
            });
          }
        }
        if (cmd.direction && cmd.direction.x === 0 && cmd.direction.y === 0) {
          diags.push({
            id: CifErrorCode.ZERO_ROTATION_VECTOR.code,
            code: CifErrorCode.ZERO_ROTATION_VECTOR.code,
            rule: CifErrorCode.ZERO_ROTATION_VECTOR.rule,
            severity: CifErrorCode.ZERO_ROTATION_VECTOR.severity,
            message: CifErrorCode.ZERO_ROTATION_VECTOR.message("B"),
            line: cmd.line,
            column: cmd.column,
            symbolId,
            layer: currentLayer ?? undefined,
          });
        }
      } else if (cmd.kind === "R") {
        if (cmd.diameter <= 0) {
          diags.push({
            id: CifErrorCode.NON_POSITIVE_ROUNDFLASH_DIM.code,
            code: CifErrorCode.NON_POSITIVE_ROUNDFLASH_DIM.code,
            rule: CifErrorCode.NON_POSITIVE_ROUNDFLASH_DIM.rule,
            severity: CifErrorCode.NON_POSITIVE_ROUNDFLASH_DIM.severity,
            message: CifErrorCode.NON_POSITIVE_ROUNDFLASH_DIM.message(cmd.diameter),
            line: cmd.line,
            column: cmd.column,
            symbolId,
            layer: currentLayer ?? undefined,
          });
        } else if (checkDrc && layerRule) {
          const scaledDiameter = cmd.diameter * scaleFactor;
          const required = layerRule.minWidthLambda * lambdaCifUnits;
          if (scaledDiameter + 1e-9 < required) {
            diags.push({
              id: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code,
              code: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code,
              rule: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.rule,
              severity: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.severity,
              message: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.message(
                layerRule.layer,
                scaledDiameter,
                required,
                layerRule.minWidthLambda,
              ),
              line: cmd.line,
              column: cmd.column,
              symbolId,
              layer: layerRule.layer,
            });
          }
        }
      } else if (cmd.kind === "W") {
        if (cmd.width <= 0 || cmd.points.length < 2) {
          diags.push({
            id: CifErrorCode.NON_POSITIVE_WIRE_DIM.code,
            code: CifErrorCode.NON_POSITIVE_WIRE_DIM.code,
            rule: CifErrorCode.NON_POSITIVE_WIRE_DIM.rule,
            severity: CifErrorCode.NON_POSITIVE_WIRE_DIM.severity,
            message: CifErrorCode.NON_POSITIVE_WIRE_DIM.message(cmd.width, cmd.points.length),
            line: cmd.line,
            column: cmd.column,
            symbolId,
            layer: currentLayer ?? undefined,
          });
        } else if (checkDrc && layerRule) {
          const scaledWidth = cmd.width * scaleFactor;
          const required = layerRule.minWidthLambda * lambdaCifUnits;
          if (scaledWidth + 1e-9 < required) {
            diags.push({
              id: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code,
              code: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code,
              rule: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.rule,
              severity: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.severity,
              message: CifErrorCode.DRC_MIN_WIDTH_VIOLATION.message(
                layerRule.layer,
                scaledWidth,
                required,
                layerRule.minWidthLambda,
              ),
              line: cmd.line,
              column: cmd.column,
              symbolId,
              layer: layerRule.layer,
            });
          }
        }
      } else if (cmd.kind === "P") {
        if (cmd.points.length < 3) {
          diags.push({
            id: CifErrorCode.DEGENERATE_POLYGON.code,
            code: CifErrorCode.DEGENERATE_POLYGON.code,
            rule: CifErrorCode.DEGENERATE_POLYGON.rule,
            severity: CifErrorCode.DEGENERATE_POLYGON.severity,
            message: CifErrorCode.DEGENERATE_POLYGON.message(cmd.points.length),
            line: cmd.line,
            column: cmd.column,
            symbolId,
            layer: currentLayer ?? undefined,
          });
        }
      }
    }
  }
}

function detectCallCycles(doc: CifDocument, diags: CifDiagnostic[]): void {
  const visited = new Set<number>();
  const inStack = new Set<number>();
  const reportedCycles = new Set<string>();

  const dfs = (symId: number, path: number[]): void => {
    visited.add(symId);
    inStack.add(symId);
    const sym = doc.symbols.get(symId);
    if (sym) {
      for (const cmd of sym.commands) {
        if (cmd.kind !== "C") continue;
        const target = cmd.symbolId;
        if (inStack.has(target)) {
          const cycleStart = path.indexOf(target);
          const cycleNodes = [...path.slice(cycleStart >= 0 ? cycleStart : 0), target];
          const key = cycleNodes.join("->");
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key);
            diags.push({
              id: CifErrorCode.RECURSIVE_SYMBOL_CYCLE.code,
              code: CifErrorCode.RECURSIVE_SYMBOL_CYCLE.code,
              rule: CifErrorCode.RECURSIVE_SYMBOL_CYCLE.rule,
              severity: CifErrorCode.RECURSIVE_SYMBOL_CYCLE.severity,
              message: CifErrorCode.RECURSIVE_SYMBOL_CYCLE.message(cycleNodes.map((n) => `DS ${n}`).join(" -> ")),
              line: cmd.line,
              column: cmd.column,
              symbolId: symId,
            });
          }
        } else if (!visited.has(target) && doc.symbols.has(target)) {
          dfs(target, [...path, target]);
        }
      }
    }
    inStack.delete(symId);
  };

  for (const symId of doc.symbolOrder) {
    if (!visited.has(symId)) {
      dfs(symId, [symId]);
    }
  }
}

/**
 * Validates a parsed CIF 2.0 document for syntax, structural, semantic, call-cycle, and DRC errors.
 */
export function lintCif(doc: CifDocument, options?: CifLintOptions): CifDiagnostic[] {
  const lambdaCifUnits = options?.lambdaCifUnits ?? 100;
  const checkDrc = options?.checkDrc ?? true;
  const diags: CifDiagnostic[] = [];

  // 1. Parse / syntax errors (CIF1001)
  for (const err of doc.parseErrors) {
    diags.push({
      id: CifErrorCode.SYNTAX_ERROR.code,
      code: CifErrorCode.SYNTAX_ERROR.code,
      rule: CifErrorCode.SYNTAX_ERROR.rule,
      severity: CifErrorCode.SYNTAX_ERROR.severity,
      message: CifErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // 2. Missing E terminator (CIF1002)
  if (!doc.hasEndCommand) {
    const lastCmd = doc.allCommands[doc.allCommands.length - 1];
    diags.push({
      id: CifErrorCode.MISSING_END_COMMAND.code,
      code: CifErrorCode.MISSING_END_COMMAND.code,
      rule: CifErrorCode.MISSING_END_COMMAND.rule,
      severity: CifErrorCode.MISSING_END_COMMAND.severity,
      message: CifErrorCode.MISSING_END_COMMAND.message(),
      line: lastCmd?.line ?? 1,
      column: lastCmd?.column ?? 1,
    });
  }

  // 3. Unmatched DF (CIF2002)
  for (const df of doc.unmatchedDefFinishes) {
    diags.push({
      id: CifErrorCode.UNMATCHED_DF.code,
      code: CifErrorCode.UNMATCHED_DF.code,
      rule: CifErrorCode.UNMATCHED_DF.rule,
      severity: CifErrorCode.UNMATCHED_DF.severity,
      message: CifErrorCode.UNMATCHED_DF.message(),
      line: df.line,
      column: df.column,
    });
  }

  // 4. Nested DS (CIF2003)
  for (const nested of doc.nestedDefStarts) {
    diags.push({
      id: CifErrorCode.NESTED_DS.code,
      code: CifErrorCode.NESTED_DS.code,
      rule: CifErrorCode.NESTED_DS.rule,
      severity: CifErrorCode.NESTED_DS.severity,
      message: CifErrorCode.NESTED_DS.message(nested.id, nested.parentId),
      line: nested.line,
      column: nested.column,
      symbolId: nested.id,
    });
  }

  // 5. Duplicate symbol IDs (CIF2004)
  for (const dup of doc.duplicateSymbolIds) {
    diags.push({
      id: CifErrorCode.DUPLICATE_SYMBOL_ID.code,
      code: CifErrorCode.DUPLICATE_SYMBOL_ID.code,
      rule: CifErrorCode.DUPLICATE_SYMBOL_ID.rule,
      severity: CifErrorCode.DUPLICATE_SYMBOL_ID.severity,
      message: CifErrorCode.DUPLICATE_SYMBOL_ID.message(dup.id),
      line: dup.line,
      column: dup.column,
      symbolId: dup.id,
    });
  }

  // 6. Per-symbol checks (unmatched DS, scale factor, body commands)
  for (const sym of doc.symbols.values()) {
    if (!sym.closed) {
      diags.push({
        id: CifErrorCode.UNMATCHED_DS.code,
        code: CifErrorCode.UNMATCHED_DS.code,
        rule: CifErrorCode.UNMATCHED_DS.rule,
        severity: CifErrorCode.UNMATCHED_DS.severity,
        message: CifErrorCode.UNMATCHED_DS.message(sym.id),
        line: sym.startLine,
        column: 1,
        symbolId: sym.id,
      });
    }
    if (sym.scaleA <= 0 || sym.scaleB <= 0) {
      diags.push({
        id: CifErrorCode.INVALID_SCALE_FACTOR.code,
        code: CifErrorCode.INVALID_SCALE_FACTOR.code,
        rule: CifErrorCode.INVALID_SCALE_FACTOR.rule,
        severity: CifErrorCode.INVALID_SCALE_FACTOR.severity,
        message: CifErrorCode.INVALID_SCALE_FACTOR.message(sym.id, sym.scaleA, sym.scaleB),
        line: sym.startLine,
        column: 1,
        symbolId: sym.id,
      });
    }
    const scaleFactor = sym.scaleA > 0 && sym.scaleB > 0 ? sym.scaleA / sym.scaleB : 1;
    checkCommandList(sym.commands, doc, scaleFactor, lambdaCifUnits, checkDrc, diags, sym.id);
  }

  // 7. Top-level commands
  checkCommandList(doc.topLevelCommands, doc, 1, lambdaCifUnits, checkDrc, diags);

  // 8. Recursive symbol call cycle detection (CIF3002)
  detectCallCycles(doc, diags);

  return diags;
}

export { CifErrorCode };
