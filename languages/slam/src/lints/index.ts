// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Linter Engine for `@modelscript/slam` (SLAM1001–SLAM5006).
 */

import { SlamErrorCode, type SlamDiagnostic } from "../errors.js";
import type { SlamModel } from "../types.js";

const VALID_DETECT_DIRECTIONS = new Set(["XP", "XN", "X", "P", "N", "POSITIVE", "NEGATIVE", "EITHER"]);

export { SlamErrorCode, type SlamDiagnostic };

/**
 * Runs all SLAM II static analysis and semantic validation rules on a parsed `SlamModel`.
 */
export function lintSlam(model: SlamModel): SlamDiagnostic[] {
  const diagnostics: SlamDiagnostic[] = [];

  // SLAM1001: Syntax errors recorded by the parser
  for (const err of model.syntaxErrors) {
    diagnostics.push({
      code: SlamErrorCode.SYNTAX_ERROR.code,
      id: SlamErrorCode.SYNTAX_ERROR.id,
      rule: SlamErrorCode.SYNTAX_ERROR.rule,
      severity: SlamErrorCode.SYNTAX_ERROR.severity,
      message: SlamErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.span.line,
      column: err.span.column,
      endLine: err.span.endLine,
      endColumn: err.span.endColumn,
      startOffset: err.span.startOffset,
      endOffset: err.span.endOffset,
    });
  }

  // SLAM3001: Unmatched NETWORK / ENDNETWORK
  if (model.hasNetwork && !model.hasEndNetwork) {
    const span = model.networkSpan;
    diagnostics.push({
      code: SlamErrorCode.UNMATCHED_NETWORK.code,
      id: SlamErrorCode.UNMATCHED_NETWORK.id,
      rule: SlamErrorCode.UNMATCHED_NETWORK.rule,
      severity: SlamErrorCode.UNMATCHED_NETWORK.severity,
      message: SlamErrorCode.UNMATCHED_NETWORK.message("'NETWORK' has no matching 'ENDNETWORK'"),
      line: span?.line ?? 1,
      column: span?.column ?? 1,
      endLine: span?.endLine,
      endColumn: span?.endColumn,
    });
  } else if (!model.hasNetwork && model.hasEndNetwork) {
    const span = model.endNetworkSpan;
    diagnostics.push({
      code: SlamErrorCode.UNMATCHED_NETWORK.code,
      id: SlamErrorCode.UNMATCHED_NETWORK.id,
      rule: SlamErrorCode.UNMATCHED_NETWORK.rule,
      severity: SlamErrorCode.UNMATCHED_NETWORK.severity,
      message: SlamErrorCode.UNMATCHED_NETWORK.message("'ENDNETWORK' has no preceding 'NETWORK'"),
      line: span?.line ?? 1,
      column: span?.column ?? 1,
      endLine: span?.endLine,
      endColumn: span?.endColumn,
    });
  }

  // SLAM3002: Missing FIN
  if (!model.hasFin) {
    diagnostics.push({
      code: SlamErrorCode.MISSING_FIN.code,
      id: SlamErrorCode.MISSING_FIN.id,
      rule: SlamErrorCode.MISSING_FIN.rule,
      severity: SlamErrorCode.MISSING_FIN.severity,
      message: SlamErrorCode.MISSING_FIN.message(),
      line: 1,
      column: 1,
    });
  }

  // SLAM4001: Invalid CONTINUOUS NNEQD / NNEQS count and step bounds
  if (model.continuous) {
    const c = model.continuous;
    if (c.nnequations < 0 || !Number.isInteger(c.nnequations)) {
      diagnostics.push({
        code: SlamErrorCode.INVALID_CONTINUOUS_COUNT.code,
        id: SlamErrorCode.INVALID_CONTINUOUS_COUNT.id,
        rule: SlamErrorCode.INVALID_CONTINUOUS_COUNT.rule,
        severity: SlamErrorCode.INVALID_CONTINUOUS_COUNT.severity,
        message: SlamErrorCode.INVALID_CONTINUOUS_COUNT.message(
          `NNEQD (${c.nnequations}) must be a non-negative integer`,
        ),
        line: c.span.line,
        column: c.span.column,
      });
    }
    if (c.nnstates < 0 || !Number.isInteger(c.nnstates)) {
      diagnostics.push({
        code: SlamErrorCode.INVALID_CONTINUOUS_COUNT.code,
        id: SlamErrorCode.INVALID_CONTINUOUS_COUNT.id,
        rule: SlamErrorCode.INVALID_CONTINUOUS_COUNT.rule,
        severity: SlamErrorCode.INVALID_CONTINUOUS_COUNT.severity,
        message: SlamErrorCode.INVALID_CONTINUOUS_COUNT.message(`NNEQS (${c.nnstates}) must be a non-negative integer`),
        line: c.span.line,
        column: c.span.column,
      });
    }
    if (c.nnequations === 0 && c.nnstates === 0) {
      diagnostics.push({
        code: SlamErrorCode.INVALID_CONTINUOUS_COUNT.code,
        id: SlamErrorCode.INVALID_CONTINUOUS_COUNT.id,
        rule: SlamErrorCode.INVALID_CONTINUOUS_COUNT.rule,
        severity: SlamErrorCode.INVALID_CONTINUOUS_COUNT.severity,
        message: SlamErrorCode.INVALID_CONTINUOUS_COUNT.message(
          "NNEQD + NNEQS must be greater than zero in a CONTINUOUS statement",
        ),
        line: c.span.line,
        column: c.span.column,
      });
    }
    if (c.dtmin <= 0 || c.dtmax < c.dtmin) {
      diagnostics.push({
        code: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.code,
        id: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.id,
        rule: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.rule,
        severity: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.severity,
        message: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.message(
          `invalid step bounds DTMIN=${c.dtmin}, DTMAX=${c.dtmax} (require 0 < DTMIN <= DTMAX)`,
        ),
        line: c.span.line,
        column: c.span.column,
      });
    }
  }

  // SLAM5006 & SLAM4001: Check state equations against CONTINUOUS declaration
  for (const eq of model.stateEquations) {
    if (!model.continuous) {
      diagnostics.push({
        code: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.code,
        id: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.id,
        rule: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.rule,
        severity: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.severity,
        message: SlamErrorCode.UNDECLARED_CONTINUOUS_STATE.message(
          `${eq.lhsKind}(${eq.index}) defined without a CONTINUOUS control statement`,
        ),
        line: eq.span.line,
        column: eq.span.column,
      });
    } else {
      const totalStates = model.continuous.nnequations + model.continuous.nnstates;
      if (eq.lhsKind === "DD" && (eq.index < 1 || eq.index > model.continuous.nnequations)) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_CONTINUOUS_COUNT.code,
          id: SlamErrorCode.INVALID_CONTINUOUS_COUNT.id,
          rule: SlamErrorCode.INVALID_CONTINUOUS_COUNT.rule,
          severity: SlamErrorCode.INVALID_CONTINUOUS_COUNT.severity,
          message: SlamErrorCode.INVALID_CONTINUOUS_COUNT.message(
            `DD(${eq.index}) exceeds declared NNEQD=${model.continuous.nnequations}`,
          ),
          line: eq.span.line,
          column: eq.span.column,
        });
      } else if (eq.lhsKind === "SS" && (eq.index < 1 || eq.index > totalStates)) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_CONTINUOUS_COUNT.code,
          id: SlamErrorCode.INVALID_CONTINUOUS_COUNT.id,
          rule: SlamErrorCode.INVALID_CONTINUOUS_COUNT.rule,
          severity: SlamErrorCode.INVALID_CONTINUOUS_COUNT.severity,
          message: SlamErrorCode.INVALID_CONTINUOUS_COUNT.message(
            `SS(${eq.index}) exceeds declared NNEQD+NNEQS=${totalStates}`,
          ),
          line: eq.span.line,
          column: eq.span.column,
        });
      }
    }
  }

  // Check duplicate labels and validate each network node
  const seenLabels = new Set<string>();
  for (const node of model.nodes) {
    if (node.label) {
      if (seenLabels.has(node.label)) {
        diagnostics.push({
          code: SlamErrorCode.DUPLICATE_NODE_LABEL.code,
          id: SlamErrorCode.DUPLICATE_NODE_LABEL.id,
          rule: SlamErrorCode.DUPLICATE_NODE_LABEL.rule,
          severity: SlamErrorCode.DUPLICATE_NODE_LABEL.severity,
          message: SlamErrorCode.DUPLICATE_NODE_LABEL.message(node.label),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      } else {
        seenLabels.add(node.label);
      }
    }

    // SLAM2001: Undefined resource in AWAIT / FREE
    if (node.type === "AWAIT" || node.type === "FREE") {
      const refName = node.resourceName;
      if (refName && !model.resources.has(refName) && !(node.type === "AWAIT" && model.gates.has(refName))) {
        diagnostics.push({
          code: SlamErrorCode.UNDEFINED_RESOURCE.code,
          id: SlamErrorCode.UNDEFINED_RESOURCE.id,
          rule: SlamErrorCode.UNDEFINED_RESOURCE.rule,
          severity: SlamErrorCode.UNDEFINED_RESOURCE.severity,
          message: SlamErrorCode.UNDEFINED_RESOURCE.message(refName, node.type),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }

    // SLAM2003: Undefined gate in OPEN / CLOSE
    if (node.type === "OPEN" || node.type === "CLOSE") {
      const gName = node.gateName;
      if (gName && !model.gates.has(gName)) {
        diagnostics.push({
          code: SlamErrorCode.UNDEFINED_GATE.code,
          id: SlamErrorCode.UNDEFINED_GATE.id,
          rule: SlamErrorCode.UNDEFINED_GATE.rule,
          severity: SlamErrorCode.UNDEFINED_GATE.severity,
          message: SlamErrorCode.UNDEFINED_GATE.message(gName, node.type),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }

    // SLAM2002: Undefined target node label
    if (node.targetLabel && !model.labels.has(node.targetLabel)) {
      diagnostics.push({
        code: SlamErrorCode.UNDEFINED_NODE_LABEL.code,
        id: SlamErrorCode.UNDEFINED_NODE_LABEL.id,
        rule: SlamErrorCode.UNDEFINED_NODE_LABEL.rule,
        severity: SlamErrorCode.UNDEFINED_NODE_LABEL.severity,
        message: SlamErrorCode.UNDEFINED_NODE_LABEL.message(node.targetLabel),
        line: node.span.line,
        column: node.span.column,
        nodeId: node.id,
      });
    }

    // SLAM4002: Invalid DETECT threshold crossing direction
    if (node.type === "DETECT") {
      const dir = node.detectDirection ?? "";
      if (!VALID_DETECT_DIRECTIONS.has(dir.toUpperCase())) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_DETECT_DIRECTION.code,
          id: SlamErrorCode.INVALID_DETECT_DIRECTION.id,
          rule: SlamErrorCode.INVALID_DETECT_DIRECTION.rule,
          severity: SlamErrorCode.INVALID_DETECT_DIRECTION.severity,
          message: SlamErrorCode.INVALID_DETECT_DIRECTION.message(dir),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }

    // SLAM5001: CREATE parameter checks
    if (node.type === "CREATE") {
      if (node.maxCreations !== undefined && node.maxCreations <= 0) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_CREATE_PARAM.code,
          id: SlamErrorCode.INVALID_CREATE_PARAM.id,
          rule: SlamErrorCode.INVALID_CREATE_PARAM.rule,
          severity: SlamErrorCode.INVALID_CREATE_PARAM.severity,
          message: SlamErrorCode.INVALID_CREATE_PARAM.message(`MC (${node.maxCreations}) must be positive`),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }

    // SLAM5002: RESOURCE capacity checks
    if (node.type === "RESOURCE") {
      const cap = node.resourceUnits ?? 1;
      if (cap <= 0 || !Number.isInteger(cap)) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_RESOURCE_CAPACITY.code,
          id: SlamErrorCode.INVALID_RESOURCE_CAPACITY.id,
          rule: SlamErrorCode.INVALID_RESOURCE_CAPACITY.rule,
          severity: SlamErrorCode.INVALID_RESOURCE_CAPACITY.severity,
          message: SlamErrorCode.INVALID_RESOURCE_CAPACITY.message(node.resourceName ?? node.id, cap),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }

    // SLAM5003: QUEUE parameter checks
    if (node.type === "QUEUE") {
      if (node.capacity !== undefined && node.capacity < 0) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_QUEUE_PARAM.code,
          id: SlamErrorCode.INVALID_QUEUE_PARAM.id,
          rule: SlamErrorCode.INVALID_QUEUE_PARAM.rule,
          severity: SlamErrorCode.INVALID_QUEUE_PARAM.severity,
          message: SlamErrorCode.INVALID_QUEUE_PARAM.message(`queue capacity (${node.capacity}) cannot be negative`),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }

    // SLAM5004: ACTIVITY parameter checks
    if (node.type === "ACTIVITY") {
      if (node.probability !== undefined && (node.probability < 0 || node.probability > 1)) {
        diagnostics.push({
          code: SlamErrorCode.INVALID_ACTIVITY_PARAM.code,
          id: SlamErrorCode.INVALID_ACTIVITY_PARAM.id,
          rule: SlamErrorCode.INVALID_ACTIVITY_PARAM.rule,
          severity: SlamErrorCode.INVALID_ACTIVITY_PARAM.severity,
          message: SlamErrorCode.INVALID_ACTIVITY_PARAM.message(
            `branch probability ${node.probability} must lie in [0, 1]`,
          ),
          line: node.span.line,
          column: node.span.column,
          nodeId: node.id,
        });
      }
    }
  }

  return diagnostics;
}
