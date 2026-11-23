// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for `@modelscript/gpss`.
 *
 * Implements diagnostic rules GPSS1001–GPSS5006 covering syntax, labels,
 * resource pairing (`SEIZE`/`RELEASE`, `QUEUE`/`DEPART`, `ENTER`/`LEAVE`),
 * `STORAGE` capacities, operand bounds, `TRANSFER` targets, and simulation termination.
 */

import { GpssErrorCode, type GpssDiagnostic } from "../errors.js";
import { parseGpss } from "../parser/gpss-parser.js";
import { GPSS_BLOCK_OPCODES, GPSS_CONTROL_OPCODES, type GpssModel, type GpssStatement } from "../types.js";

export { GpssErrorCode, type GpssDiagnostic };

function pushDiag(
  out: GpssDiagnostic[],
  spec: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  stmt?: Pick<GpssStatement, "line" | "column" | "startOffset" | "endOffset">,
  entityName?: string,
): void {
  out.push({
    code: spec.code,
    id: spec.id,
    rule: spec.rule,
    severity: spec.severity,
    message,
    line: stmt?.line ?? 1,
    column: stmt?.column ?? 1,
    startOffset: stmt?.startOffset,
    endOffset: stmt?.endOffset,
    entityName,
  });
}

function isNumericLiteral(token: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token.trim());
}

/**
 * Runs all GPSS static analysis rules on a parsed `GpssModel`.
 */
export function lintGpss(model: GpssModel): GpssDiagnostic[] {
  const diagnostics: GpssDiagnostic[] = [];

  // 1. Parser syntax errors (GPSS1001)
  for (const err of model.syntaxErrors) {
    pushDiag(diagnostics, GpssErrorCode.SYNTAX_ERROR, GpssErrorCode.SYNTAX_ERROR.message(err.message), err);
  }

  // 2. Duplicate labels (GPSS2001) and unknown opcodes (GPSS1002)
  const seenLabels = new Map<string, GpssStatement>();
  for (const stmt of model.statements) {
    const isKnown = GPSS_BLOCK_OPCODES.has(stmt.opcode) || GPSS_CONTROL_OPCODES.has(stmt.opcode);
    if (!isKnown && model.syntaxErrors.every((e) => e.line !== stmt.line)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNKNOWN_OPCODE,
        GpssErrorCode.UNKNOWN_OPCODE.message(stmt.opcode),
        stmt,
        stmt.opcode,
      );
    }

    if (stmt.label && GPSS_BLOCK_OPCODES.has(stmt.opcode)) {
      if (seenLabels.has(stmt.label)) {
        pushDiag(
          diagnostics,
          GpssErrorCode.DUPLICATE_LABEL,
          GpssErrorCode.DUPLICATE_LABEL.message(stmt.label),
          stmt,
          stmt.label,
        );
      } else {
        seenLabels.set(stmt.label, stmt);
      }
    }
  }

  // 3. Track paired resources (SEIZE/RELEASE, QUEUE/DEPART, ENTER/LEAVE)
  const seized = new Map<string, GpssStatement>();
  const released = new Map<string, GpssStatement>();
  const queued = new Map<string, GpssStatement>();
  const departed = new Map<string, GpssStatement>();
  const entered = new Map<string, GpssStatement>();
  const left = new Map<string, GpssStatement>();

  let hasGenerate = false;
  let hasTerminate = false;
  let hasPositiveTerminate = false;

  for (let i = 0; i < model.blocks.length; i++) {
    const stmt = model.blocks[i]!;
    const opA = (stmt.operands[0] ?? "").trim();
    const opB = (stmt.operands[1] ?? "").trim();
    const opC = (stmt.operands[2] ?? "").trim();
    const entityA = opA.toUpperCase();

    // Unreachable block check (GPSS5006)
    if (i > 0 && !stmt.label) {
      const prev = model.blocks[i - 1]!;
      const prevIsUnconditionalTransfer =
        prev.opcode === "TRANSFER" && (prev.operands[0] ?? "").trim() === "" && (prev.operands[1] ?? "").trim() !== "";
      const prevIsTerminate = prev.opcode === "TERMINATE";
      if ((prevIsUnconditionalTransfer || prevIsTerminate) && stmt.opcode !== "GENERATE") {
        pushDiag(
          diagnostics,
          GpssErrorCode.UNREACHABLE_BLOCK,
          GpssErrorCode.UNREACHABLE_BLOCK.message(stmt.opcode, stmt.line),
          stmt,
          stmt.opcode,
        );
      }
    }

    switch (stmt.opcode) {
      case "GENERATE": {
        hasGenerate = true;
        if (opA && isNumericLiteral(opA) && Number(opA) < 0) {
          pushDiag(
            diagnostics,
            GpssErrorCode.INVALID_GENERATE_OPERAND,
            GpssErrorCode.INVALID_GENERATE_OPERAND.message(`mean interarrival time '${opA}' must be >= 0`),
            stmt,
          );
        }
        if (opB && isNumericLiteral(opB)) {
          const spread = Number(opB);
          if (spread < 0) {
            pushDiag(
              diagnostics,
              GpssErrorCode.INVALID_GENERATE_OPERAND,
              GpssErrorCode.INVALID_GENERATE_OPERAND.message(`spread '${opB}' must be >= 0`),
              stmt,
            );
          } else if (opA && isNumericLiteral(opA) && spread > Number(opA)) {
            pushDiag(
              diagnostics,
              GpssErrorCode.INVALID_GENERATE_OPERAND,
              GpssErrorCode.INVALID_GENERATE_OPERAND.message(`spread '${opB}' exceeds mean '${opA}'`),
              stmt,
            );
          }
        }
        break;
      }

      case "ADVANCE": {
        if (opA && isNumericLiteral(opA) && Number(opA) < 0) {
          pushDiag(
            diagnostics,
            GpssErrorCode.INVALID_ADVANCE_OPERAND,
            GpssErrorCode.INVALID_ADVANCE_OPERAND.message(`mean service time '${opA}' must be >= 0`),
            stmt,
          );
        }
        if (opB && isNumericLiteral(opB) && Number(opB) < 0) {
          pushDiag(
            diagnostics,
            GpssErrorCode.INVALID_ADVANCE_OPERAND,
            GpssErrorCode.INVALID_ADVANCE_OPERAND.message(`spread '${opB}' must be >= 0`),
            stmt,
          );
        }
        break;
      }

      case "SEIZE":
        if (entityA && !seized.has(entityA)) seized.set(entityA, stmt);
        break;

      case "RELEASE":
        if (entityA && !released.has(entityA)) released.set(entityA, stmt);
        break;

      case "QUEUE":
        if (entityA && !queued.has(entityA)) queued.set(entityA, stmt);
        break;

      case "DEPART":
        if (entityA && !departed.has(entityA)) departed.set(entityA, stmt);
        break;

      case "ENTER":
        if (entityA && !entered.has(entityA)) entered.set(entityA, stmt);
        if (entityA && !model.storages.has(entityA)) {
          pushDiag(
            diagnostics,
            GpssErrorCode.UNDEFINED_STORAGE,
            GpssErrorCode.UNDEFINED_STORAGE.message(entityA),
            stmt,
            entityA,
          );
        }
        break;

      case "LEAVE":
        if (entityA && !left.has(entityA)) left.set(entityA, stmt);
        break;

      case "TRANSFER": {
        // Validate statistical probability if A is numeric
        if (opA && isNumericLiteral(opA)) {
          const p = Number(opA);
          if (p <= 0 || p >= 1) {
            pushDiag(
              diagnostics,
              GpssErrorCode.INVALID_TRANSFER_PROBABILITY,
              GpssErrorCode.INVALID_TRANSFER_PROBABILITY.message(opA),
              stmt,
            );
          }
        }
        // Validate target labels B and C
        for (const target of [opB, opC]) {
          if (!target) continue;
          const targetUpper = target.toUpperCase();
          if (!isNumericLiteral(targetUpper) && !model.labels.has(targetUpper)) {
            pushDiag(
              diagnostics,
              GpssErrorCode.UNDEFINED_TRANSFER_TARGET,
              GpssErrorCode.UNDEFINED_TRANSFER_TARGET.message(targetUpper),
              stmt,
              targetUpper,
            );
          }
        }
        break;
      }

      case "SPLIT": {
        if (opB && !isNumericLiteral(opB) && !model.labels.has(opB.toUpperCase())) {
          pushDiag(
            diagnostics,
            GpssErrorCode.UNDEFINED_TRANSFER_TARGET,
            GpssErrorCode.UNDEFINED_TRANSFER_TARGET.message(opB.toUpperCase()),
            stmt,
            opB.toUpperCase(),
          );
        }
        break;
      }

      case "TEST": {
        if (opC && !isNumericLiteral(opC) && !model.labels.has(opC.toUpperCase())) {
          pushDiag(
            diagnostics,
            GpssErrorCode.UNDEFINED_TRANSFER_TARGET,
            GpssErrorCode.UNDEFINED_TRANSFER_TARGET.message(opC.toUpperCase()),
            stmt,
            opC.toUpperCase(),
          );
        }
        break;
      }

      case "GATE": {
        if (opB && !isNumericLiteral(opB) && !model.labels.has(opB.toUpperCase())) {
          pushDiag(
            diagnostics,
            GpssErrorCode.UNDEFINED_TRANSFER_TARGET,
            GpssErrorCode.UNDEFINED_TRANSFER_TARGET.message(opB.toUpperCase()),
            stmt,
            opB.toUpperCase(),
          );
        }
        break;
      }

      case "TERMINATE": {
        hasTerminate = true;
        if (opA && isNumericLiteral(opA) && Number(opA) > 0) {
          hasPositiveTerminate = true;
        }
        break;
      }

      default:
        break;
    }
  }

  // 4. Unmatched SEIZE / RELEASE (GPSS3001)
  for (const [fac, stmt] of seized) {
    if (!released.has(fac)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNMATCHED_SEIZE_RELEASE,
        GpssErrorCode.UNMATCHED_SEIZE_RELEASE.message(fac, "RELEASE"),
        stmt,
        fac,
      );
    }
  }
  for (const [fac, stmt] of released) {
    if (!seized.has(fac)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNMATCHED_SEIZE_RELEASE,
        GpssErrorCode.UNMATCHED_SEIZE_RELEASE.message(fac, "SEIZE"),
        stmt,
        fac,
      );
    }
  }

  // 5. Unmatched QUEUE / DEPART (GPSS3002)
  for (const [q, stmt] of queued) {
    if (!departed.has(q)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNMATCHED_QUEUE_DEPART,
        GpssErrorCode.UNMATCHED_QUEUE_DEPART.message(q, "DEPART"),
        stmt,
        q,
      );
    }
  }
  for (const [q, stmt] of departed) {
    if (!queued.has(q)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNMATCHED_QUEUE_DEPART,
        GpssErrorCode.UNMATCHED_QUEUE_DEPART.message(q, "QUEUE"),
        stmt,
        q,
      );
    }
  }

  // 6. Unmatched ENTER / LEAVE (GPSS3003)
  for (const [s, stmt] of entered) {
    if (!left.has(s)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNMATCHED_ENTER_LEAVE,
        GpssErrorCode.UNMATCHED_ENTER_LEAVE.message(s, "LEAVE"),
        stmt,
        s,
      );
    }
  }
  for (const [s, stmt] of left) {
    if (!entered.has(s)) {
      pushDiag(
        diagnostics,
        GpssErrorCode.UNMATCHED_ENTER_LEAVE,
        GpssErrorCode.UNMATCHED_ENTER_LEAVE.message(s, "ENTER"),
        stmt,
        s,
      );
    }
  }

  // 7. Non-positive STORAGE capacity (GPSS4001)
  for (const [name, def] of model.storages) {
    if (!Number.isFinite(def.capacity) || def.capacity <= 0) {
      pushDiag(
        diagnostics,
        GpssErrorCode.NON_POSITIVE_STORAGE_CAPACITY,
        GpssErrorCode.NON_POSITIVE_STORAGE_CAPACITY.message(name, def.capacity),
        { line: def.line, column: 1, startOffset: def.startOffset, endOffset: def.endOffset },
        name,
      );
    }
  }

  // 8. Simulation control & termination checks (GPSS5001–GPSS5004)
  if (!model.hasStart) {
    pushDiag(diagnostics, GpssErrorCode.MISSING_START, GpssErrorCode.MISSING_START.message());
  }
  if (!hasTerminate) {
    pushDiag(diagnostics, GpssErrorCode.MISSING_TERMINATE, GpssErrorCode.MISSING_TERMINATE.message());
  } else if (!hasPositiveTerminate) {
    pushDiag(diagnostics, GpssErrorCode.ZERO_TERMINATE_DECREMENT, GpssErrorCode.ZERO_TERMINATE_DECREMENT.message());
  }
  if (!hasGenerate && model.blocks.length > 0) {
    pushDiag(diagnostics, GpssErrorCode.MISSING_GENERATE, GpssErrorCode.MISSING_GENERATE.message());
  }

  return diagnostics;
}

/**
 * Convenience helper to parse and lint GPSS source text directly.
 */
export function lintGpssSource(source: string): GpssDiagnostic[] {
  return lintGpss(parseGpss(source));
}
