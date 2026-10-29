// SPDX-License-Identifier: AGPL-3.0-or-later

import { PsseErrorCode } from "../errors.js";
import type { PsseCase, PsseDiagnostic } from "../types.js";

/**
 * Validates a parsed PSS/E base case and returns semantic diagnostics.
 */
export function lintPsse(c: PsseCase): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];

  // Helper to add diagnostic
  function addDiag(
    severity: "error" | "warning" | "info",
    code: string,
    message: string,
    span?: { startOffset: number; endOffset: number; line: number; column: number },
  ) {
    diagnostics.push({
      severity,
      code,
      message,
      startOffset: span?.startOffset ?? 0,
      endOffset: span?.endOffset ?? 0,
      line: span?.line,
      column: span?.column,
    });
  }

  // 1. Check for Slack / Swing bus presence (P2002)
  let swingBusCount = 0;
  for (const b of c.buses.values()) {
    if (b.ide === 3) {
      swingBusCount++;
    }
  }
  if (swingBusCount === 0 && c.buses.size > 0) {
    addDiag(
      PsseErrorCode.MISSING_SLACK_BUS.severity,
      PsseErrorCode.MISSING_SLACK_BUS.code,
      PsseErrorCode.MISSING_SLACK_BUS.message(),
      c.header.span,
    );
  }

  // 2. Validate Generator limits (P3001, P3002, P3003)
  const genKeys = new Set<string>();
  for (const g of c.generators) {
    const key = `${g.i}:${g.id}`;
    if (genKeys.has(key)) {
      addDiag(
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.severity,
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.code,
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.message(g.id, g.i),
        g.span,
      );
    }
    genKeys.add(key);

    if (!c.buses.has(g.i)) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Generator", g.id, "", g.i),
        g.span,
      );
    }

    if (g.qb > g.qt) {
      addDiag(
        PsseErrorCode.GENERATOR_REACTIVE_LIMITS_INVERTED.severity,
        PsseErrorCode.GENERATOR_REACTIVE_LIMITS_INVERTED.code,
        PsseErrorCode.GENERATOR_REACTIVE_LIMITS_INVERTED.message(g.id, g.i, g.qb, g.qt),
        g.span,
      );
    }

    if (g.pb > g.pt) {
      addDiag(
        PsseErrorCode.GENERATOR_POWER_LIMITS_INVERTED.severity,
        PsseErrorCode.GENERATOR_POWER_LIMITS_INVERTED.code,
        PsseErrorCode.GENERATOR_POWER_LIMITS_INVERTED.message(g.id, g.i, g.pb, g.pt),
        g.span,
      );
    }

    if (g.stat === 1 && (g.vs < 0.8 || g.vs > 1.2)) {
      addDiag(
        PsseErrorCode.GENERATOR_SCHEDULED_VOLTAGE_BOUNDS.severity,
        PsseErrorCode.GENERATOR_SCHEDULED_VOLTAGE_BOUNDS.code,
        PsseErrorCode.GENERATOR_SCHEDULED_VOLTAGE_BOUNDS.message(g.id, g.vs),
        g.span,
      );
    }
  }

  // 3. Validate Loads
  for (const l of c.loads) {
    if (!c.buses.has(l.i)) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Load", l.id, "", l.i),
        l.span,
      );
    }
  }

  // 4. Validate Fixed Shunts
  for (const s of c.fixedShunts) {
    if (!c.buses.has(s.i)) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Fixed shunt", s.id, "", s.i),
        s.span,
      );
    }
  }

  // 5. Track connected branch counts per bus for isolated bus check (P2001)
  const connectedBranches = new Map<number, number>();
  for (const b of c.buses.keys()) {
    connectedBranches.set(b, 0);
  }

  // 6. Validate Branches (P1001, P1003, P4001, P4002)
  const branchKeys = new Set<string>();
  for (const br of c.branches) {
    const key = `${Math.min(br.i, br.j)}:${Math.max(br.i, br.j)}:${br.ckt}`;
    if (branchKeys.has(key)) {
      addDiag(
        "warning",
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.code,
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.branchMessage(br.i, br.j, br.ckt),
        br.span,
      );
    }
    branchKeys.add(key);

    const fromBus = c.buses.get(br.i);
    const toBus = c.buses.get(br.j);

    if (!fromBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Branch", br.ckt, "'from' ", br.i),
        br.span,
      );
    }
    if (!toBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Branch", br.ckt, "'to' ", br.j),
        br.span,
      );
    }

    if (fromBus && toBus && br.st === 1) {
      connectedBranches.set(br.i, (connectedBranches.get(br.i) ?? 0) + 1);
      connectedBranches.set(br.j, (connectedBranches.get(br.j) ?? 0) + 1);

      // Check base kV match
      if (Math.abs(fromBus.baseKv - toBus.baseKv) > 0.01 && fromBus.baseKv > 0 && toBus.baseKv > 0) {
        addDiag(
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.severity,
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.code,
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.message(br.ckt, br.i, fromBus.baseKv, br.j, toBus.baseKv),
          br.span,
        );
      }
    }

    if (br.x <= 0) {
      addDiag(
        PsseErrorCode.BRANCH_INVALID_REACTANCE.severity,
        PsseErrorCode.BRANCH_INVALID_REACTANCE.code,
        PsseErrorCode.BRANCH_INVALID_REACTANCE.message(br.ckt, br.i, br.j, br.x),
        br.span,
      );
    }
  }

  // 7. Validate Transformers (P1001, P4003)
  for (const t of c.transformers) {
    const fromBus = c.buses.get(t.i);
    const toBus = c.buses.get(t.j);
    if (!fromBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Transformer", t.ckt, "primary ", t.i),
        t.span,
      );
    }
    if (!toBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Transformer", t.ckt, "secondary ", t.j),
        t.span,
      );
    }
    if (t.k !== 0 && !c.buses.has(t.k)) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("3-winding transformer", t.ckt, "tertiary ", t.k),
        t.span,
      );
    }

    if (fromBus && toBus && t.stat === 1) {
      connectedBranches.set(t.i, (connectedBranches.get(t.i) ?? 0) + 1);
      connectedBranches.set(t.j, (connectedBranches.get(t.j) ?? 0) + 1);
    }

    if (t.windv1 > 0 && (t.windv1 < 0.7 || t.windv1 > 1.3)) {
      addDiag(
        PsseErrorCode.TRANSFORMER_TAP_OUT_OF_BOUNDS.severity,
        PsseErrorCode.TRANSFORMER_TAP_OUT_OF_BOUNDS.code,
        PsseErrorCode.TRANSFORMER_TAP_OUT_OF_BOUNDS.message(t.ckt, t.i, t.j, t.windv1),
        t.span,
      );
    }
  }

  // 8. Isolated bus check (P2001)
  for (const [busId, count] of connectedBranches.entries()) {
    const bus = c.buses.get(busId);
    if (bus && bus.ide !== 4 && count === 0) {
      addDiag(
        PsseErrorCode.ISOLATED_BUS.severity,
        PsseErrorCode.ISOLATED_BUS.code,
        PsseErrorCode.ISOLATED_BUS.message(bus.i, bus.name),
        bus.span,
      );
    }
  }

  return diagnostics;
}
