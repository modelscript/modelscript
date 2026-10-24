// SPDX-License-Identifier: AGPL-3.0-or-later

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
      "error",
      "P2002",
      "Power network base case contains 0 slack/swing buses (Bus Type 3). Power flow solution cannot be anchored.",
      c.header.span,
    );
  }

  // 2. Validate Generator limits (P3001, P3002, P3003)
  const genKeys = new Set<string>();
  for (const g of c.generators) {
    const key = `${g.i}:${g.id}`;
    if (genKeys.has(key)) {
      addDiag("error", "P1003", `Duplicate generator ID '${g.id}' at bus ${g.i}.`, g.span);
    }
    genKeys.add(key);

    if (!c.buses.has(g.i)) {
      addDiag("error", "P1001", `Generator '${g.id}' references non-existent bus ${g.i}.`, g.span);
    }

    if (g.qb > g.qt) {
      addDiag(
        "error",
        "P3001",
        `Generator '${g.id}' at bus ${g.i} has inverted reactive limits: Qmin (${g.qb} MVAR) > Qmax (${g.qt} MVAR).`,
        g.span,
      );
    }

    if (g.pb > g.pt) {
      addDiag(
        "error",
        "P3002",
        `Generator '${g.id}' at bus ${g.i} has inverted active power limits: Pmin (${g.pb} MW) > Pmax (${g.pt} MW).`,
        g.span,
      );
    }

    if (g.stat === 1 && (g.vs < 0.8 || g.vs > 1.2)) {
      addDiag(
        "warning",
        "P3003",
        `Generator '${g.id}' scheduled voltage Vs = ${g.vs} p.u. is outside the typical operating band [0.8, 1.2].`,
        g.span,
      );
    }
  }

  // 3. Validate Loads
  for (const l of c.loads) {
    if (!c.buses.has(l.i)) {
      addDiag("error", "P1001", `Load '${l.id}' references non-existent bus ${l.i}.`, l.span);
    }
  }

  // 4. Validate Fixed Shunts
  for (const s of c.fixedShunts) {
    if (!c.buses.has(s.i)) {
      addDiag("error", "P1001", `Fixed shunt '${s.id}' references non-existent bus ${s.i}.`, s.span);
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
        "P1003",
        `Duplicate transmission branch between bus ${br.i} and ${br.j} with circuit ID '${br.ckt}'.`,
        br.span,
      );
    }
    branchKeys.add(key);

    const fromBus = c.buses.get(br.i);
    const toBus = c.buses.get(br.j);

    if (!fromBus) {
      addDiag("error", "P1001", `Branch '${br.ckt}' references non-existent 'from' bus ${br.i}.`, br.span);
    }
    if (!toBus) {
      addDiag("error", "P1001", `Branch '${br.ckt}' references non-existent 'to' bus ${br.j}.`, br.span);
    }

    if (fromBus && toBus && br.st === 1) {
      connectedBranches.set(br.i, (connectedBranches.get(br.i) ?? 0) + 1);
      connectedBranches.set(br.j, (connectedBranches.get(br.j) ?? 0) + 1);

      // Check base kV match
      if (Math.abs(fromBus.baseKv - toBus.baseKv) > 0.01 && fromBus.baseKv > 0 && toBus.baseKv > 0) {
        addDiag(
          "warning",
          "P4002",
          `Branch '${br.ckt}' connects bus ${br.i} (${fromBus.baseKv} kV) to bus ${br.j} (${toBus.baseKv} kV) without a transformer.`,
          br.span,
        );
      }
    }

    if (br.x <= 0) {
      addDiag(
        "error",
        "P4001",
        `Transmission branch '${br.ckt}' between bus ${br.i} and ${br.j} has zero or negative reactance X = ${br.x} p.u.`,
        br.span,
      );
    }
  }

  // 7. Validate Transformers (P1001, P4003)
  for (const t of c.transformers) {
    const fromBus = c.buses.get(t.i);
    const toBus = c.buses.get(t.j);
    if (!fromBus) {
      addDiag("error", "P1001", `Transformer '${t.ckt}' references non-existent primary bus ${t.i}.`, t.span);
    }
    if (!toBus) {
      addDiag("error", "P1001", `Transformer '${t.ckt}' references non-existent secondary bus ${t.j}.`, t.span);
    }
    if (t.k !== 0 && !c.buses.has(t.k)) {
      addDiag(
        "error",
        "P1001",
        `3-winding transformer '${t.ckt}' references non-existent tertiary bus ${t.k}.`,
        t.span,
      );
    }

    if (fromBus && toBus && t.stat === 1) {
      connectedBranches.set(t.i, (connectedBranches.get(t.i) ?? 0) + 1);
      connectedBranches.set(t.j, (connectedBranches.get(t.j) ?? 0) + 1);
    }

    if (t.windv1 > 0 && (t.windv1 < 0.7 || t.windv1 > 1.3)) {
      addDiag(
        "warning",
        "P4003",
        `Transformer '${t.ckt}' between bus ${t.i} and ${t.j} has off-nominal tap ratio ${t.windv1} outside typical limits [0.7, 1.3].`,
        t.span,
      );
    }
  }

  // 8. Isolated bus check (P2001)
  for (const [busId, count] of connectedBranches.entries()) {
    const bus = c.buses.get(busId);
    if (bus && bus.ide !== 4 && count === 0) {
      addDiag(
        "warning",
        "P2001",
        `Bus ${bus.i} ('${bus.name}') is isolated with 0 in-service connecting branches or transformers.`,
        bus.span,
      );
    }
  }

  return diagnostics;
}
