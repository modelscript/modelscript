// SPDX-License-Identifier: AGPL-3.0-or-later

import { SparseTripletBuilder, sparseLuFactor, sparseLuSolve } from "@modelscript/runtime";
import { lowerPsseToDae } from "../dae/psse-to-dae.js";
import { PsseErrorCode } from "../errors.js";
import { DYR_MODEL_SCHEMAS } from "../parser/dyr-parser.js";
import { analyzeSmallSignalStability } from "../solver/small-signal.js";
import type { PsseCase, PsseDiagnostic, PsseDyrRecord } from "../types.js";

/**
 * Validates a parsed PSS/E base case (and optional `.dyr` dynamics) and returns semantic diagnostics.
 */
export function lintPsse(c: PsseCase): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];

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

  const sbase = c.header.sbase > 0 ? c.header.sbase : 100.0;

  if (c.unterminatedSection) {
    addDiag(
      PsseErrorCode.UNTERMINATED_RAW_SECTION.severity,
      PsseErrorCode.UNTERMINATED_RAW_SECTION.code,
      PsseErrorCode.UNTERMINATED_RAW_SECTION.message(c.unterminatedSection.section),
      c.unterminatedSection.span ?? c.header.span,
    );
  }

  if (c.areas.length > 0) {
    const declaredAreas = new Set(c.areas.map((a) => a.i));
    for (const b of c.buses.values()) {
      if (b.area > 0 && !declaredAreas.has(b.area)) {
        addDiag(
          PsseErrorCode.INVALID_AREA_REF.severity,
          PsseErrorCode.INVALID_AREA_REF.code,
          PsseErrorCode.INVALID_AREA_REF.message(`Bus ${b.i}`, b.area),
          b.span,
        );
      }
    }
  }

  // 1. Check for Slack / Swing bus presence (P2002, P2003) and bus voltage bounds (P2004, P2005)
  let swingBusCount = 0;
  for (const b of c.buses.values()) {
    if (b.ide === 3) {
      swingBusCount++;
    }
    if (b.ide !== 4) {
      if (b.vm < 0.8 || b.vm > 1.2) {
        addDiag(
          PsseErrorCode.VOLTAGE_OUT_OF_BOUNDS.severity,
          PsseErrorCode.VOLTAGE_OUT_OF_BOUNDS.code,
          PsseErrorCode.VOLTAGE_OUT_OF_BOUNDS.message(b.i, b.vm),
          b.span,
        );
      }
      if (b.vm < 0.9 || b.vm > 1.1) {
        addDiag(
          PsseErrorCode.SUBSTATION_VOLTAGE_VIOLATION_NERC.severity,
          PsseErrorCode.SUBSTATION_VOLTAGE_VIOLATION_NERC.code,
          PsseErrorCode.SUBSTATION_VOLTAGE_VIOLATION_NERC.message(b.i, b.vm),
          b.span,
        );
      }
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
  if (swingBusCount > 1 && c.areas.length <= 1) {
    addDiag(
      PsseErrorCode.MULTIPLE_SLACK_BUSES.severity,
      PsseErrorCode.MULTIPLE_SLACK_BUSES.code,
      PsseErrorCode.MULTIPLE_SLACK_BUSES.message(swingBusCount),
      c.header.span,
    );
  }

  // Track active reactive sources per bus and remote voltage regulation groups
  const onlineReactiveSourceBuses = new Set<number>();
  const remoteRegByBus = new Map<
    number,
    Array<{ id: string; vs: number; rmpct: number; span: typeof c.header.span }>
  >();

  // 2. Validate Generator limits (P1002, P1003, P2006, P2008, P2009, P3001-P3003)
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

    const hostBus = c.buses.get(g.i);
    if (!hostBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Generator", g.id, "", g.i),
        g.span,
      );
    } else if (g.stat === 1) {
      if (hostBus.ide === 4) {
        addDiag(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(g.i, `generator '${g.id}'`),
          g.span,
        );
      } else if (hostBus.ide === 1) {
        addDiag(
          PsseErrorCode.GENERATOR_ON_PQ_BUS.severity,
          PsseErrorCode.GENERATOR_ON_PQ_BUS.code,
          PsseErrorCode.GENERATOR_ON_PQ_BUS.message(g.id, g.i),
          g.span,
        );
      }
      onlineReactiveSourceBuses.add(g.i);
      const regTarget = g.ireg > 0 ? g.ireg : g.i;
      onlineReactiveSourceBuses.add(regTarget);
      if (g.ireg > 0) {
        const list = remoteRegByBus.get(g.ireg) ?? [];
        list.push({ id: `${g.i}:${g.id}`, vs: g.vs, rmpct: g.rmpct, span: g.span });
        remoteRegByBus.set(g.ireg, list);
      }
    }

    if (g.stat === 1 && g.pg < 0) {
      addDiag(
        PsseErrorCode.GENERATOR_NEGATIVE_POWER.severity,
        PsseErrorCode.GENERATOR_NEGATIVE_POWER.code,
        PsseErrorCode.GENERATOR_NEGATIVE_POWER.message(g.id, g.i, g.pg),
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

  for (const [regBus, regs] of remoteRegByBus) {
    if (regs.length < 2) continue;
    const minVs = Math.min(...regs.map((r) => r.vs));
    const maxVs = Math.max(...regs.map((r) => r.vs));
    if (maxVs - minVs > 0.005) {
      addDiag(
        PsseErrorCode.CONFLICTING_REMOTE_REGULATION.severity,
        PsseErrorCode.CONFLICTING_REMOTE_REGULATION.code,
        PsseErrorCode.CONFLICTING_REMOTE_REGULATION.message(
          regBus,
          `scheduled voltages conflict (${minVs.toFixed(4)} vs ${maxVs.toFixed(4)} p.u.)`,
        ),
        regs[0]?.span,
      );
    }
    const totalPct = regs.reduce((s, r) => s + r.rmpct, 0);
    if (Math.abs(totalPct - 100.0) > 1.0) {
      addDiag(
        PsseErrorCode.CONFLICTING_REMOTE_REGULATION.severity,
        PsseErrorCode.CONFLICTING_REMOTE_REGULATION.code,
        PsseErrorCode.CONFLICTING_REMOTE_REGULATION.message(
          regBus,
          `RMPCT shares sum to ${totalPct.toFixed(1)}% instead of 100%`,
        ),
        regs[0]?.span,
      );
    }
  }

  // 3. Validate Loads (P1001, P2006)
  for (const l of c.loads) {
    const hostBus = c.buses.get(l.i);
    if (!hostBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Load", l.id, "", l.i),
        l.span,
      );
    } else if (l.status === 1 && hostBus.ide === 4) {
      addDiag(
        PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
        PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
        PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(l.i, `load '${l.id}'`),
        l.span,
      );
    }
  }

  // 4. Validate Fixed Shunts & Switched Shunts (P1001, P2006, P4010)
  for (const s of c.fixedShunts) {
    const hostBus = c.buses.get(s.i);
    if (!hostBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Fixed shunt", s.id, "", s.i),
        s.span,
      );
    } else if (s.status === 1 && hostBus.ide === 4) {
      addDiag(
        PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
        PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
        PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(s.i, `fixed shunt '${s.id}'`),
        s.span,
      );
    }
  }

  for (const sw of c.switchedShunts) {
    const hostBus = c.buses.get(sw.i);
    if (!hostBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Switched shunt", "SW", "", sw.i),
        sw.span,
      );
    } else if (sw.stat === 1) {
      if (hostBus.ide === 4) {
        addDiag(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(sw.i, "switched shunt"),
          sw.span,
        );
      }
      if (sw.modsw >= 1) {
        onlineReactiveSourceBuses.add(sw.swrem > 0 ? sw.swrem : sw.i);
      }
      if (sw.vswlo >= sw.vswhi) {
        addDiag(
          PsseErrorCode.SWITCHED_SHUNT_BAND_INVERTED.severity,
          PsseErrorCode.SWITCHED_SHUNT_BAND_INVERTED.code,
          PsseErrorCode.SWITCHED_SHUNT_BAND_INVERTED.message(sw.i, sw.vswlo, sw.vswhi),
          sw.span,
        );
      }
    }
  }

  // 5. Track connected branch counts and energized network adjacency for topology lints
  const connectedBranches = new Map<number, number>();
  const adjacency = new Map<
    number,
    Array<{ to: number; edgeId: string; kind: string; ckt: string; u: number; v: number; span?: typeof c.header.span }>
  >();
  for (const b of c.buses.keys()) {
    connectedBranches.set(b, 0);
    adjacency.set(b, []);
  }
  const linkTopology = (
    u: number,
    v: number,
    edgeId: string,
    kind: string,
    ckt: string,
    span?: typeof c.header.span,
  ) => {
    connectedBranches.set(u, (connectedBranches.get(u) ?? 0) + 1);
    connectedBranches.set(v, (connectedBranches.get(v) ?? 0) + 1);
    const bu = c.buses.get(u);
    const bv = c.buses.get(v);
    if (bu && bv && bu.ide !== 4 && bv.ide !== 4 && u !== v) {
      adjacency.get(u)!.push({ to: v, edgeId, kind, ckt, u, v, span });
      adjacency.get(v)!.push({ to: u, edgeId, kind, ckt, u, v, span });
    }
  };

  // 6. Validate Branches (P1001, P1003, P2006, P4001, P4002, P4004, P4005, P4006, P4007)
  const branchKeys = new Set<string>();
  for (const br of c.branches) {
    const jAbs = Math.abs(br.j);
    const key = `${Math.min(br.i, jAbs)}:${Math.max(br.i, jAbs)}:${br.ckt}`;
    if (branchKeys.has(key)) {
      addDiag(
        "warning",
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.code,
        PsseErrorCode.DUPLICATE_EQUIPMENT_ID.branchMessage(br.i, jAbs, br.ckt),
        br.span,
      );
    }
    branchKeys.add(key);

    const fromBus = c.buses.get(br.i);
    const toBus = c.buses.get(jAbs);

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
        PsseErrorCode.BUS_NOT_FOUND.message("Branch", br.ckt, "'to' ", jAbs),
        br.span,
      );
    }

    if (fromBus && toBus && br.st === 1) {
      linkTopology(br.i, jAbs, `br:${key}`, "Branch", br.ckt, br.span);

      if (fromBus.ide === 4) {
        addDiag(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(br.i, `branch '${br.ckt}'`),
          br.span,
        );
      }
      if (toBus.ide === 4) {
        addDiag(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(jAbs, `branch '${br.ckt}'`),
          br.span,
        );
      }

      if (Math.abs(fromBus.baseKv - toBus.baseKv) > 0.01 && fromBus.baseKv > 0 && toBus.baseKv > 0) {
        addDiag(
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.severity,
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.code,
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.message(br.ckt, br.i, fromBus.baseKv, jAbs, toBus.baseKv),
          br.span,
        );
      }
    }

    if (br.x <= 0) {
      addDiag(
        PsseErrorCode.BRANCH_INVALID_REACTANCE.severity,
        PsseErrorCode.BRANCH_INVALID_REACTANCE.code,
        PsseErrorCode.BRANCH_INVALID_REACTANCE.message(br.ckt, br.i, jAbs, br.x),
        br.span,
      );
    } else if (br.x < 1e-5 && Math.abs(br.r) < 1e-5) {
      addDiag(
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.severity,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.code,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.message(
          br.ckt,
          br.i,
          jAbs,
          `near-zero impedance (R=${br.r}, X=${br.x}) that may ill-condition the Jacobian`,
        ),
        br.span,
      );
    }
    if (br.r < 0) {
      addDiag(
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.severity,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.code,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.message(br.ckt, br.i, jAbs, `negative resistance R = ${br.r} p.u.`),
        br.span,
      );
    }

    if (br.st === 1 && br.rateA <= 0) {
      addDiag(
        PsseErrorCode.BRANCH_THERMAL_RATING_ZERO.severity,
        PsseErrorCode.BRANCH_THERMAL_RATING_ZERO.code,
        PsseErrorCode.BRANCH_THERMAL_RATING_ZERO.message(br.ckt, br.i, jAbs),
        br.span,
      );
    }

    if (
      (br.rateA > 0 && br.rateB > 0 && br.rateA > br.rateB) ||
      (br.rateB > 0 && br.rateC > 0 && br.rateB > br.rateC) ||
      (br.rateA > 0 && br.rateC > 0 && br.rateA > br.rateC)
    ) {
      addDiag(
        PsseErrorCode.BRANCH_RATING_HIERARCHY_INVERTED.severity,
        PsseErrorCode.BRANCH_RATING_HIERARCHY_INVERTED.code,
        PsseErrorCode.BRANCH_RATING_HIERARCHY_INVERTED.message(br.ckt, br.i, jAbs, br.rateA, br.rateB, br.rateC),
        br.span,
      );
    }

    if (br.b > 5.0) {
      addDiag(
        PsseErrorCode.LINE_CHARGING_MVAR_SUSPECT.severity,
        PsseErrorCode.LINE_CHARGING_MVAR_SUSPECT.code,
        PsseErrorCode.LINE_CHARGING_MVAR_SUSPECT.message(br.ckt, br.i, jAbs, br.b),
        br.span,
      );
    }
  }

  // 7. Validate Transformers (P1001, P2006, P4003, P4009) — includes 3W tertiary bus t.k & partial stat 1..4
  for (let xfIdx = 0; xfIdx < c.transformers.length; xfIdx++) {
    const t = c.transformers[xfIdx]!;
    const fromBus = c.buses.get(t.i);
    const toBus = c.buses.get(t.j);
    const tertBus = t.k !== 0 ? c.buses.get(t.k) : undefined;
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
    if (t.k !== 0 && !tertBus) {
      addDiag(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("3-winding transformer", t.ckt, "tertiary ", t.k),
        t.span,
      );
    }

    // PSS/E transformer STAT: 0=out, 1=all in, 2/3/4=partial 3W winding in-service
    if (t.stat !== 0) {
      if (fromBus && toBus && t.stat !== 4) {
        linkTopology(t.i, t.j, `xf:${xfIdx}:ij`, "Transformer", t.ckt, t.span);
      }
      if (t.k !== 0 && tertBus) {
        if (fromBus && t.stat !== 3) {
          linkTopology(t.i, t.k, `xf:${xfIdx}:ik`, "Transformer", t.ckt, t.span);
        }
        if (toBus && t.stat !== 2) {
          linkTopology(t.j, t.k, `xf:${xfIdx}:jk`, "Transformer", t.ckt, t.span);
        }
      }
      if (t.stat === 1) {
        if (fromBus?.ide === 4) {
          addDiag(
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(t.i, `transformer '${t.ckt}'`),
            t.span,
          );
        }
        if (toBus?.ide === 4) {
          addDiag(
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(t.j, `transformer '${t.ckt}'`),
            t.span,
          );
        }
        if (t.k !== 0 && tertBus?.ide === 4) {
          addDiag(
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
            PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(t.k, `transformer '${t.ckt}'`),
            t.span,
          );
        }
      }
    }

    if (t.windv1 > 0 && (t.windv1 < 0.7 || t.windv1 > 1.3)) {
      addDiag(
        PsseErrorCode.TRANSFORMER_TAP_OUT_OF_BOUNDS.severity,
        PsseErrorCode.TRANSFORMER_TAP_OUT_OF_BOUNDS.code,
        PsseErrorCode.TRANSFORMER_TAP_OUT_OF_BOUNDS.message(t.ckt, t.i, t.j, t.windv1),
        t.span,
      );
    }

    if (t.k !== 0 && t.x23 !== undefined && t.x31 !== undefined) {
      const xStar1 = 0.5 * (t.x12 + t.x31 - t.x23);
      if (xStar1 < -0.05) {
        addDiag(
          PsseErrorCode.THREE_WINDING_NEGATIVE_STAR_REACTANCE.severity,
          PsseErrorCode.THREE_WINDING_NEGATIVE_STAR_REACTANCE.code,
          PsseErrorCode.THREE_WINDING_NEGATIVE_STAR_REACTANCE.message(t.ckt, t.i, t.j, t.k, xStar1),
          t.span,
        );
      }
    }

    // P4008: Transformer CW/CZ unit mismatch checks
    if (t.cw === 1 && t.windv1 > 10.0) {
      addDiag(
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.severity,
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.code,
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.message(
          t.ckt,
          t.i,
          t.j,
          `CW=1 expects per-unit off-nominal tap ratio, but WINDV1=${t.windv1} appears to be in kV`,
        ),
        t.span,
      );
    } else if (t.cw === 2 && t.windv1 > 0 && t.windv1 < 2.0 && fromBus && fromBus.baseKv >= 10.0) {
      addDiag(
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.severity,
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.code,
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.message(
          t.ckt,
          t.i,
          t.j,
          `CW=2 expects kV tap voltage near bus base ${fromBus.baseKv} kV, but WINDV1=${t.windv1}`,
        ),
        t.span,
      );
    }
    if (t.sbase12 <= 0) {
      addDiag(
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.severity,
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.code,
        PsseErrorCode.TRANSFORMER_UNIT_MISMATCH.message(
          t.ckt,
          t.i,
          t.j,
          `winding SBASE1-2=${t.sbase12} MVA must be positive`,
        ),
        t.span,
      );
    }
  }

  // Account for active HVDC terminals in connectedBranches & topology
  for (let dcIdx = 0; dcIdx < c.twoTerminalDc.length; dcIdx++) {
    const dc = c.twoTerminalDc[dcIdx]!;
    if (dc.mdc !== 0 && dc.ipr && dc.ipi && c.buses.has(dc.ipr) && c.buses.has(dc.ipi)) {
      linkTopology(dc.ipr, dc.ipi, `dc2:${dcIdx}`, "2-Terminal DC", String(dc.i), dc.span);
    }
  }
  for (let vscIdx = 0; vscIdx < c.vscDc.length; vscIdx++) {
    const vsc = c.vscDc[vscIdx]!;
    if (vsc.mdc !== 0) {
      if (vsc.ibus1 && c.buses.has(vsc.ibus1)) {
        connectedBranches.set(vsc.ibus1, (connectedBranches.get(vsc.ibus1) ?? 0) + 1);
        onlineReactiveSourceBuses.add(vsc.ibus1);
      }
      if (vsc.ibus2 && c.buses.has(vsc.ibus2)) {
        connectedBranches.set(vsc.ibus2, (connectedBranches.get(vsc.ibus2) ?? 0) + 1);
        onlineReactiveSourceBuses.add(vsc.ibus2);
      }
      if (vsc.ibus1 && vsc.ibus2 && c.buses.has(vsc.ibus1) && c.buses.has(vsc.ibus2)) {
        linkTopology(vsc.ibus1, vsc.ibus2, `vsc:${vscIdx}`, "VSC DC", vsc.name, vsc.span);
      }
    }
  }

  // 8. Isolated bus check (P2001) & PV bus without online reactive source (P2007)
  for (const [busId, count] of connectedBranches.entries()) {
    const bus = c.buses.get(busId);
    if (!bus || bus.ide === 4) continue;
    if (count === 0) {
      addDiag(
        PsseErrorCode.ISOLATED_BUS.severity,
        PsseErrorCode.ISOLATED_BUS.code,
        PsseErrorCode.ISOLATED_BUS.message(bus.i, bus.name),
        bus.span,
      );
    }
    if (bus.ide === 2 && !onlineReactiveSourceBuses.has(busId)) {
      addDiag(
        PsseErrorCode.PV_BUS_WITHOUT_REACTIVE_SOURCE.severity,
        PsseErrorCode.PV_BUS_WITHOUT_REACTIVE_SOURCE.code,
        PsseErrorCode.PV_BUS_WITHOUT_REACTIVE_SOURCE.message(bus.i, bus.name),
        bus.span,
      );
    }
  }

  // 9. Tier 2 Graph Analysis: Unanchored Energized Islands (P6001) & N-1 Cut Bridges (P6002)
  const visitedIsland = new Set<number>();
  const busPowerWeight = new Map<number, number>();
  for (const b of c.buses.keys()) busPowerWeight.set(b, 0);
  for (const g of c.generators) {
    if (g.stat === 1) busPowerWeight.set(g.i, (busPowerWeight.get(g.i) ?? 0) + Math.abs(g.pg));
  }
  for (const l of c.loads) {
    if (l.status === 1) busPowerWeight.set(l.i, (busPowerWeight.get(l.i) ?? 0) + Math.abs(l.pl));
  }

  for (const [startBusId, startBus] of c.buses) {
    if (startBus.ide === 4 || visitedIsland.has(startBusId)) continue;
    const comp: number[] = [];
    const queue: number[] = [startBusId];
    visitedIsland.add(startBusId);
    let hasSlack = false;
    while (queue.length > 0) {
      const u = queue.shift()!;
      comp.push(u);
      if (c.buses.get(u)?.ide === 3) hasSlack = true;
      for (const e of adjacency.get(u) ?? []) {
        if (!visitedIsland.has(e.to)) {
          visitedIsland.add(e.to);
          queue.push(e.to);
        }
      }
    }
    if (comp.length > 1 && !hasSlack && swingBusCount > 0) {
      const repBus = c.buses.get(comp[0]!);
      addDiag(
        PsseErrorCode.UNANCHORED_ENERGIZED_ISLAND.severity,
        PsseErrorCode.UNANCHORED_ENERGIZED_ISLAND.code,
        PsseErrorCode.UNANCHORED_ENERGIZED_ISLAND.message(comp.length, comp[0]!),
        repBus?.span,
      );
    }
  }

  // Tarjan bridge detection for single-branch N-1 cut edges carrying >= 10 MW
  if (c.buses.size >= 3) {
    let dfsTimer = 0;
    const tin = new Map<number, number>();
    const low = new Map<number, number>();
    const subWeight = new Map<number, number>();
    const dfsBridge = (u: number, parentEdgeId: string | null) => {
      tin.set(u, dfsTimer);
      low.set(u, dfsTimer);
      dfsTimer++;
      let wSum = busPowerWeight.get(u) ?? 0;
      for (const e of adjacency.get(u) ?? []) {
        if (e.edgeId === parentEdgeId) continue;
        if (tin.has(e.to)) {
          low.set(u, Math.min(low.get(u)!, tin.get(e.to)!));
        } else {
          dfsBridge(e.to, e.edgeId);
          const childWeight = subWeight.get(e.to) ?? 0;
          wSum += childWeight;
          low.set(u, Math.min(low.get(u)!, low.get(e.to)!));
          if (low.get(e.to)! > tin.get(u)! && childWeight >= 10.0) {
            addDiag(
              PsseErrorCode.SINGLE_BRANCH_CUT_BRIDGE.severity,
              PsseErrorCode.SINGLE_BRANCH_CUT_BRIDGE.code,
              PsseErrorCode.SINGLE_BRANCH_CUT_BRIDGE.message(e.kind, e.ckt, e.u, e.v, childWeight),
              e.span,
            );
          }
        }
      }
      subWeight.set(u, wSum);
    };
    for (const [bId, b] of c.buses) {
      if (b.ide !== 4 && !tin.has(bId)) dfsBridge(bId, null);
    }
  }

  // 10. Dynamic (.dyr) parameter hierarchy, ICONs, bounds, coupling & steady-state checks (P3004, P5001-P5020, P7001)
  if (c.dyr && c.dyr.records.length > 0) {
    const slotCategories = new Set<string>();
    const genDynamicKeys = new Set<string>();
    const genRecordBySlot = new Map<string, PsseDyrRecord>();
    const excRecordBySlot = new Map<string, PsseDyrRecord>();

    for (const rec of c.dyr.records) {
      const slotId = rec.id.trim() || "1";
      const slotKey = rec.deviceName
        ? `DEV:${rec.deviceName.toUpperCase()}`
        : rec.jbus && rec.jbus > 0
          ? `${rec.ibus}_${rec.jbus}:${slotId}`
          : `${rec.ibus}:${slotId}`;
      const schema = DYR_MODEL_SCHEMAS[rec.model];
      const subSlot = schema?.subCategory ?? rec.category;
      const catSlotKey = `${slotKey}:${subSlot}`;

      // P5001: CON parameter count vs schema (only warn when non-legacy schema count mismatches)
      if (schema && rec.con.length < schema.params.length) {
        addDiag(
          PsseErrorCode.DYR_PARAM_COUNT_MISMATCH.severity,
          PsseErrorCode.DYR_PARAM_COUNT_MISMATCH.code,
          PsseErrorCode.DYR_PARAM_COUNT_MISMATCH.message(rec.model, rec.ibus, rec.con.length, schema.params.length),
          rec.span,
        );
      }

      // P5020: Unmapped custom USRMDL notice
      if (rec.headerKind === "usrmdl" && !schema) {
        addDiag(
          PsseErrorCode.DYR_USRMDL_UNMAPPED_CUSTOM.severity,
          PsseErrorCode.DYR_USRMDL_UNMAPPED_CUSTOM.code,
          PsseErrorCode.DYR_USRMDL_UNMAPPED_CUSTOM.message(rec.model, rec.ibus),
          rec.span,
        );
      }

      // P5002: Duplicate slot assignment
      if (rec.category !== "user" && rec.category !== "relay") {
        if (slotCategories.has(catSlotKey)) {
          addDiag(
            PsseErrorCode.DYR_DUPLICATE_SLOT.severity,
            PsseErrorCode.DYR_DUPLICATE_SLOT.code,
            PsseErrorCode.DYR_DUPLICATE_SLOT.message(rec.category, rec.ibus, slotId),
            rec.span,
          );
        }
        slotCategories.add(catSlotKey);
      }

      // P5013 & P5018: ICON validValues & remote bus existence checks
      if (schema?.icons && rec.icons && rec.icons.length > 0) {
        for (let idx = 0; idx < schema.icons.length && idx < rec.icons.length; idx++) {
          const iconMeta = schema.icons[idx]!;
          const rawVal = rec.icons[idx]!;
          if (iconMeta.validValues && typeof rawVal === "number" && !iconMeta.validValues.includes(rawVal)) {
            addDiag(
              PsseErrorCode.DYR_ICON_INVALID_VALUE.severity,
              PsseErrorCode.DYR_ICON_INVALID_VALUE.code,
              PsseErrorCode.DYR_ICON_INVALID_VALUE.message(
                rec.model,
                rec.ibus,
                iconMeta.name,
                String(rawVal),
                iconMeta.validValues.join(", "),
              ),
              rec.span,
            );
          }
          if (
            iconMeta.type === "bus" &&
            typeof rawVal === "number" &&
            rawVal > 0 &&
            c.buses.size > 0 &&
            !c.buses.has(rawVal)
          ) {
            addDiag(
              PsseErrorCode.DYR_REMOTE_BUS_NOT_FOUND.severity,
              PsseErrorCode.DYR_REMOTE_BUS_NOT_FOUND.code,
              PsseErrorCode.DYR_REMOTE_BUS_NOT_FOUND.message(rec.model, rec.ibus, iconMeta.name, rawVal),
              rec.span,
            );
          }
        }
      }

      // P5014: CON physical bounds check
      if (schema) {
        for (let idx = 0; idx < schema.params.length && idx < rec.con.length; idx++) {
          const pm = schema.params[idx]!;
          const v = rec.con[idx]!;
          if ((pm.min !== undefined && v < pm.min) || (pm.max !== undefined && v > pm.max)) {
            addDiag(
              PsseErrorCode.DYR_CON_PHYSICAL_BOUNDS.severity,
              PsseErrorCode.DYR_CON_PHYSICAL_BOUNDS.code,
              PsseErrorCode.DYR_CON_PHYSICAL_BOUNDS.message(
                rec.model,
                rec.ibus,
                pm.name,
                v,
                pm.min ?? -Infinity,
                pm.max ?? Infinity,
              ),
              rec.span,
            );
          }
        }
      }

      // P5015: Extreme lead/lag ratio check
      const tc = rec.namedParams["TC"];
      const tb = rec.namedParams["TB"];
      if (tc !== undefined && tb !== undefined && tb > 1e-4 && tc / tb > 25.0) {
        addDiag(
          PsseErrorCode.DYR_LEADLAG_RATIO_EXTREME.severity,
          PsseErrorCode.DYR_LEADLAG_RATIO_EXTREME.code,
          PsseErrorCode.DYR_LEADLAG_RATIO_EXTREME.message(rec.model, rec.ibus, "TC", "TB", tc / tb),
          rec.span,
        );
      }

      // P5016: Saturation monotonicity check
      const s10 = rec.namedParams["S10"] ?? rec.namedParams["SE1"];
      const s12 = rec.namedParams["S12"] ?? rec.namedParams["SE2"];
      if (s10 !== undefined && s12 !== undefined && (s10 < 0 || s12 < 0 || (s10 > 0 && s12 < s10))) {
        addDiag(
          PsseErrorCode.DYR_SATURATION_NON_MONOTONIC.severity,
          PsseErrorCode.DYR_SATURATION_NON_MONOTONIC.code,
          PsseErrorCode.DYR_SATURATION_NON_MONOTONIC.message(rec.model, rec.ibus, s10, s12),
          rec.span,
        );
      }

      // P5017: Composite load fraction sum
      if (schema?.daeArchetype === "load_composite_cmpldw") {
        const fSum =
          (rec.namedParams["Fma"] ?? 0) +
          (rec.namedParams["Fmb"] ?? 0) +
          (rec.namedParams["Fmc"] ?? 0) +
          (rec.namedParams["Fmd"] ?? 0) +
          (rec.namedParams["Fel"] ?? 0);
        if (fSum > 1.001 || fSum < 0) {
          addDiag(
            PsseErrorCode.DYR_COMPOSITE_LOAD_FRACTION_SUM.severity,
            PsseErrorCode.DYR_COMPOSITE_LOAD_FRACTION_SUM.code,
            PsseErrorCode.DYR_COMPOSITE_LOAD_FRACTION_SUM.message(rec.model, rec.ibus, fSum),
            rec.span,
          );
        }
      }

      // P5019: HVDC link existence check
      if (rec.category === "hvdc" && rec.deviceName && c.buses.size > 0) {
        const dn = rec.deviceName.trim().toUpperCase();
        const foundDc =
          c.twoTerminalDc?.some((d) => (d.name ?? String(d.i)).trim().toUpperCase() === dn) ||
          c.vscDc?.some((d) => d.name.trim().toUpperCase() === dn);
        if (!foundDc) {
          addDiag(
            PsseErrorCode.DYR_HVDC_FACTS_LINK_NOT_FOUND.severity,
            PsseErrorCode.DYR_HVDC_FACTS_LINK_NOT_FOUND.code,
            PsseErrorCode.DYR_HVDC_FACTS_LINK_NOT_FOUND.message(rec.model, rec.deviceName),
            rec.span,
          );
        }
      }

      if (rec.category === "generator") {
        genDynamicKeys.add(`${rec.ibus}:${slotId}`);
        genRecordBySlot.set(`${rec.ibus}:${slotId}`, rec);

        // P3004: Zero inertia
        if (rec.namedParams["H"] !== undefined && rec.namedParams["H"] <= 0) {
          addDiag(
            PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.severity,
            PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.code,
            PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.message(rec.ibus),
            rec.span,
          );
        }

        // P5005: Synchronous machine reactance & time-constant ordering
        const xd = rec.namedParams["Xd"];
        const xdp = rec.namedParams["Xdp"];
        const xdpp = rec.namedParams["Xdpp"];
        if (xd !== undefined && xdp !== undefined && xd < xdp) {
          addDiag(
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.severity,
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.code,
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.message(rec.model, rec.ibus, `Xd (${xd}) < X'd (${xdp})`),
            rec.span,
          );
        }
        if (xdp !== undefined && xdpp !== undefined && xdp < xdpp) {
          addDiag(
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.severity,
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.code,
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.message(rec.model, rec.ibus, `X'd (${xdp}) < X''d (${xdpp})`),
            rec.span,
          );
        }
        const td0p = rec.namedParams["Td0p"];
        const td0pp = rec.namedParams["Td0pp"];
        if (td0p !== undefined && td0pp !== undefined && td0p > 0 && td0pp > 0 && td0p < td0pp) {
          addDiag(
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.severity,
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.code,
            PsseErrorCode.DYR_REACTANCE_HIERARCHY.message(rec.model, rec.ibus, `T'd0 (${td0p}) < T''d0 (${td0pp})`),
            rec.span,
          );
        }
      } else if (rec.category === "exciter" && subSlot === "exciter") {
        excRecordBySlot.set(`${rec.ibus}:${slotId}`, rec);
      }
    }

    // P5003: Orphan controllers (exciter / governor / stabilizer with no generator/IBR dynamic record)
    for (const rec of c.dyr.records) {
      if (rec.category === "exciter" || rec.category === "governor" || rec.category === "stabilizer") {
        const slotId = rec.id.trim() || "1";
        if (!genDynamicKeys.has(`${rec.ibus}:${slotId}`)) {
          addDiag(
            PsseErrorCode.DYR_ORPHAN_CONTROLLER.severity,
            PsseErrorCode.DYR_ORPHAN_CONTROLLER.code,
            PsseErrorCode.DYR_ORPHAN_CONTROLLER.message(rec.model, rec.category, rec.ibus, slotId),
            rec.span,
          );
        }
      }
    }

    // P5004, P5006, P7001: Compare online RAW generators against DYR steady-state initialization
    for (const g of c.generators) {
      if (g.stat !== 1) continue;
      const gId = g.id.trim() || "1";
      const slotKey = `${g.i}:${gId}`;
      const genDyn = genRecordBySlot.get(slotKey);
      if (!genDyn) {
        if (Math.abs(g.pg) >= 20.0 || g.mbase >= 20.0) {
          addDiag(
            PsseErrorCode.DYR_MISSING_GENERATOR_DYNAMICS.severity,
            PsseErrorCode.DYR_MISSING_GENERATOR_DYNAMICS.code,
            PsseErrorCode.DYR_MISSING_GENERATOR_DYNAMICS.message(gId, g.i, g.pg),
            g.span,
          );
        }
        continue;
      }

      // P5006: RAW ZX vs DYR X''d / X'd boundary match (skip default ZX=1.0 placeholder)
      const dyrX = genDyn.namedParams["Xdpp"] ?? genDyn.namedParams["Xdp"];
      if (dyrX !== undefined && dyrX > 0 && g.zx > 0 && Math.abs(g.zx - 1.0) > 1e-4) {
        const relDiff = Math.abs(g.zx - dyrX) / Math.max(dyrX, 1e-4);
        if (relDiff > 0.2) {
          addDiag(
            PsseErrorCode.DYR_RAW_SOURCE_IMPEDANCE_MISMATCH.severity,
            PsseErrorCode.DYR_RAW_SOURCE_IMPEDANCE_MISMATCH.code,
            PsseErrorCode.DYR_RAW_SOURCE_IMPEDANCE_MISMATCH.message(gId, g.i, g.zx, dyrX),
            g.span,
          );
        }
      }

      // P7001: "INITIAL CONDITIONS SUSPECT" steady-state EMF & active power back-solve
      if (g.pg > g.pt + 0.1 || g.pg < g.pb - 0.1) {
        addDiag(
          PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.severity,
          PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.code,
          PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.message(
            gId,
            g.i,
            `dispatched Pg (${g.pg.toFixed(1)} MW) lies outside [${g.pb.toFixed(1)}, ${g.pt.toFixed(1)}] MW`,
          ),
          g.span,
        );
      }

      const excDyn = excRecordBySlot.get(slotKey);
      const bus = c.buses.get(g.i);
      if (excDyn && bus) {
        const mbase = g.mbase > 0 ? g.mbase : sbase;
        const vt = Math.max(0.5, bus.vm || g.vs || 1.0);
        const xd = genDyn.namedParams["Xd"] ?? 1.5;
        const xq = genDyn.namedParams["Xq"] ?? xd;
        const pPu = g.pg / mbase;
        const qPu = g.qg / mbase;
        // Compute internal EMF Eq and steady-state field voltage Efd0 = Eq + (Xd - Xq)*Id
        const eq = Math.hypot(vt + (qPu * xq) / vt, (pPu * xq) / vt);
        const id = (pPu * xq) / (vt * Math.max(eq, 1e-4));
        const efd0 = eq + Math.max(0, xd - xq) * id;
        const vrMax = excDyn.namedParams["VRMAX"];
        const vrMin = excDyn.namedParams["VRMIN"];
        if (vrMax !== undefined && vrMax > 0 && efd0 > vrMax) {
          addDiag(
            PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.severity,
            PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.code,
            PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.message(
              gId,
              g.i,
              `computed field voltage Efd0=${efd0.toFixed(3)} p.u. exceeds exciter '${excDyn.model}' VRMAX=${vrMax.toFixed(3)} p.u.`,
            ),
            excDyn.span ?? g.span,
          );
        } else if (vrMin !== undefined && efd0 < vrMin) {
          addDiag(
            PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.severity,
            PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.code,
            PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.message(
              gId,
              g.i,
              `computed field voltage Efd0=${efd0.toFixed(3)} p.u. is below exciter '${excDyn.model}' VRMIN=${vrMin.toFixed(3)} p.u.`,
            ),
            excDyn.span ?? g.span,
          );
        }
      }
    }
  }

  // 11. P6003: Driving-point Sparse Z_bus Short-Circuit Ratio (SCR) at IBR POIs
  if (c.buses.size >= 2 && c.buses.size <= 5000) {
    const ibrBusSet = new Map<number, number>();
    if (c.dyr) {
      for (const rec of c.dyr.records) {
        const up = rec.model.toUpperCase();
        if (up.startsWith("REGC") || up.startsWith("REEC") || up.startsWith("REPC") || up.startsWith("WT")) {
          const gen = c.generators.find(
            (g) => g.stat === 1 && g.i === rec.ibus && (g.id.trim() || "1") === (rec.id.trim() || "1"),
          );
          const mva = gen
            ? Math.max(1, gen.mbase > 0 ? gen.mbase : Math.abs(gen.pt) || Math.abs(gen.pg) || sbase)
            : sbase;
          ibrBusSet.set(rec.ibus, (ibrBusSet.get(rec.ibus) ?? 0) + mva);
        }
      }
    }
    for (const g of c.generators) {
      if (g.stat !== 1 || ibrBusSet.has(g.i)) continue;
      const bName = c.buses.get(g.i)?.name.toUpperCase() ?? "";
      const isIbrName =
        bName.includes("IBR") || bName.includes("SOLAR") || bName.includes("WIND") || bName.includes("BESS");
      if (g.zx >= 900 || isIbrName) {
        const mva = Math.max(1, g.mbase > 0 ? g.mbase : Math.abs(g.pt) || Math.abs(g.pg) || sbase);
        ibrBusSet.set(g.i, (ibrBusSet.get(g.i) ?? 0) + mva);
      }
    }

    if (ibrBusSet.size > 0) {
      const activeBuses = Array.from(c.buses.values()).filter((b) => b.ide !== 4);
      const busIdx = new Map<number, number>();
      activeBuses.forEach((b, idx) => busIdx.set(b.i, idx));
      const n = activeBuses.length;
      if (n >= 2) {
        const triplets = new SparseTripletBuilder(n, n);
        for (const br of c.branches) {
          if (br.st === 0 || Math.abs(br.x) < 1e-6) continue;
          const u = busIdx.get(br.i);
          const v = busIdx.get(Math.abs(br.j));
          if (u === undefined || v === undefined) continue;
          const y = 1.0 / Math.abs(br.x);
          triplets.add(u, u, y);
          triplets.add(v, v, y);
          triplets.add(u, v, -y);
          triplets.add(v, u, -y);
        }
        for (const t of c.transformers) {
          if (t.stat === 0 || Math.abs(t.x12) < 1e-6) continue;
          const u = busIdx.get(t.i);
          const v = busIdx.get(t.j);
          if (u === undefined || v === undefined) continue;
          const y = 1.0 / Math.abs(t.x12);
          triplets.add(u, u, y);
          triplets.add(v, v, y);
          triplets.add(u, v, -y);
          triplets.add(v, u, -y);
        }
        const groundedBuses = new Set<number>();
        for (const g of c.generators) {
          if (g.stat !== 1 || ibrBusSet.has(g.i)) continue;
          const u = busIdx.get(g.i);
          if (u === undefined) continue;
          const xSrc = g.zx > 0 && g.zx < 1.5 ? g.zx : 0.25;
          const mbaseRatio = (g.mbase > 0 ? g.mbase : sbase) / sbase;
          triplets.add(u, u, mbaseRatio / xSrc);
          groundedBuses.add(g.i);
        }
        for (const b of activeBuses) {
          if (b.ide === 3 && !groundedBuses.has(b.i)) {
            const u = busIdx.get(b.i)!;
            triplets.add(u, u, 1.0 / 0.15);
          }
        }
        const ccs = triplets.toCCS();
        const lu = sparseLuFactor(ccs, { allowPerturbation: true });
        if (lu) {
          const rhs = new Float64Array(n);
          const sol = new Float64Array(n);
          for (const [poiBusId, mvaIbr] of ibrBusSet) {
            const u = busIdx.get(poiBusId);
            if (u === undefined || mvaIbr <= 0) continue;
            rhs.fill(0);
            sol.fill(0);
            rhs[u] = 1.0;
            sparseLuSolve(lu, rhs, sol);
            const xTh = sol[u]!;
            if (Number.isFinite(xTh) && xTh > 1e-6) {
              const sScMva = sbase / xTh;
              const scr = sScMva / mvaIbr;
              if (scr < 1.5) {
                addDiag(
                  PsseErrorCode.WEAK_GRID_IBR_SCR.severity,
                  PsseErrorCode.WEAK_GRID_IBR_SCR.code,
                  PsseErrorCode.WEAK_GRID_IBR_SCR.message(poiBusId, scr, mvaIbr, sScMva),
                  c.buses.get(poiBusId)?.span,
                );
              }
            }
          }
        }
      }
    }
  }

  // 12. P6005: Structural balance verification on lowered @modelscript/runtime DAE arena
  if (c.dyr && c.dyr.records.length > 0 && c.buses.size > 0 && c.buses.size <= 500) {
    try {
      const dae = lowerPsseToDae(c);
      if (dae.varCount !== dae.eqCount) {
        addDiag(
          PsseErrorCode.DAE_STRUCTURAL_IMBALANCE.severity,
          PsseErrorCode.DAE_STRUCTURAL_IMBALANCE.code,
          PsseErrorCode.DAE_STRUCTURAL_IMBALANCE.message(dae.varCount, dae.eqCount),
          c.header.span,
        );
      }
    } catch {
      // Lowering failure on malformed records is covered by parser/syntax diagnostics
    }
  }

  // 13. P7002: Generator capability curve S = sqrt(Pg^2 + Qg^2) vs MBASE check
  for (const g of c.generators) {
    if (g.stat !== 1 || g.mbase <= 0) continue;
    const sMva = Math.hypot(g.pg, g.qg);
    if (sMva > 1.05 * g.mbase) {
      addDiag(
        PsseErrorCode.GENERATOR_CAPABILITY_OVERLOAD.severity,
        PsseErrorCode.GENERATOR_CAPABILITY_OVERLOAD.code,
        PsseErrorCode.GENERATOR_CAPABILITY_OVERLOAD.message(
          g.id.trim() || "1",
          g.i,
          `apparent power S=${sMva.toFixed(1)} MVA exceeds 1.05 * MBASE (${g.mbase.toFixed(1)} MVA)`,
        ),
        g.span,
      );
    } else if (g.pt > 0 && g.pt < 9000 && g.pt > 1.05 * g.mbase) {
      addDiag(
        PsseErrorCode.GENERATOR_CAPABILITY_OVERLOAD.severity,
        PsseErrorCode.GENERATOR_CAPABILITY_OVERLOAD.code,
        PsseErrorCode.GENERATOR_CAPABILITY_OVERLOAD.message(
          g.id.trim() || "1",
          g.i,
          `PT=${g.pt.toFixed(1)} MW exceeds nameplate MBASE=${g.mbase.toFixed(1)} MVA`,
        ),
        g.span,
      );
    }
  }

  // 14. P7004: WECC IBR REEC/REPC/REGC deadband & current-limit conflict check
  if (c.dyr) {
    for (const rec of c.dyr.records) {
      const up = rec.model.toUpperCase();
      if (!up.startsWith("REEC") && !up.startsWith("REPC") && !up.startsWith("REGC")) continue;
      const np = rec.namedParams;
      let conflict: string | undefined;
      if (np["dbd1"] !== undefined && np["dbd2"] !== undefined && np["dbd1"] > np["dbd2"]) {
        conflict = `lower deadband dbd1 (${np["dbd1"]}) > upper deadband dbd2 (${np["dbd2"]})`;
      } else if (
        np["Vdip"] !== undefined &&
        np["Vup"] !== undefined &&
        np["Vdip"] > 0 &&
        np["Vdip"] < 1.5 &&
        np["Vup"] > 0 &&
        np["Vup"] < 2.0 &&
        np["Vdip"] >= np["Vup"]
      ) {
        conflict = `LVRT threshold Vdip (${np["Vdip"]}) >= HVRT threshold Vup (${np["Vup"]})`;
      } else if (np["Iqh1"] !== undefined && np["Iql1"] !== undefined && np["Iqh1"] < np["Iql1"]) {
        conflict = `reactive current upper limit Iqh1 (${np["Iqh1"]}) < lower limit Iql1 (${np["Iql1"]})`;
      } else if (np["Imax"] !== undefined && np["Imax"] <= 0) {
        conflict = `total converter current limit Imax (${np["Imax"]}) <= 0`;
      } else if (
        np["Iqh1"] !== undefined &&
        np["Imax"] !== undefined &&
        np["Imax"] > 0 &&
        Math.abs(np["Iqh1"]) > np["Imax"] + 1e-4
      ) {
        conflict = `|Iqh1| (${Math.abs(np["Iqh1"])}) exceeds total current ceiling Imax (${np["Imax"]})`;
      }
      if (conflict) {
        addDiag(
          PsseErrorCode.IBR_CONTROL_CONFLICT.severity,
          PsseErrorCode.IBR_CONTROL_CONFLICT.code,
          PsseErrorCode.IBR_CONTROL_CONFLICT.message(rec.model, rec.ibus, conflict),
          rec.span,
        );
      }
    }
  }

  // 15. P6006: Small-signal electromechanical damping & eigenvalue check via analyzeSmallSignalStability
  if (c.dyr && c.dyr.records.some((r) => r.category === "generator") && c.buses.size >= 2 && c.buses.size <= 120) {
    try {
      const ss = analyzeSmallSignalStability(c, { dyr: c.dyr, dampingThreshold: 0.03 });
      const badCount = ss.summary.unstableCount + ss.summary.poorlyDampedCount;
      if (badCount > 0 && ss.criticalModes.length > 0) {
        const worst = ss.criticalModes[0]!;
        addDiag(
          PsseErrorCode.POORLY_DAMPED_MODE.severity,
          PsseErrorCode.POORLY_DAMPED_MODE.code,
          PsseErrorCode.POORLY_DAMPED_MODE.message(
            badCount,
            ss.summary.minDampingRatio * 100,
            worst.frequencyHz,
            worst.dominantMachine || "system",
          ),
          c.header.span,
        );
      }
    } catch {
      // Unconverged base cases are already flagged by power-flow/topology diagnostics
    }
  }

  // 16. P1004: RAW revision vs @! metadata / bus column width mismatch
  if (c.header.rev <= 33 && c.header.rawMetadataDetected) {
    addDiag(
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.severity,
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.code,
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.message(
        c.header.rev,
        "header revision is <= 33 while file uses PSS/E v34+ '@!' column metadata directives",
      ),
      c.header.span,
    );
  } else if (c.header.rev <= 30 && c.header.maxBusColumnCount !== undefined && c.header.maxBusColumnCount >= 13) {
    addDiag(
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.severity,
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.code,
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.message(
        c.header.rev,
        `bus records have ${c.header.maxBusColumnCount} columns (v32+ limit fields) inconsistent with REV=${c.header.rev}`,
      ),
      c.header.span,
    );
  } else if (
    c.header.rev >= 34 &&
    c.buses.size > 0 &&
    c.header.minBusColumnCount !== undefined &&
    c.header.minBusColumnCount <= 9
  ) {
    addDiag(
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.severity,
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.code,
      PsseErrorCode.RAW_VERSION_COLUMN_MISMATCH.message(
        c.header.rev,
        `v${c.header.rev} bus records expect extended columns (>= 10), found ${c.header.minBusColumnCount}`,
      ),
      c.header.span,
    );
  }

  // 17. P7003: Provable static power-transfer upper bound (Jabr/Thévenin pocket solvability certificate)
  if (c.buses.size >= 2) {
    const pqLoadByBus = new Map<number, { p: number; q: number; span?: (typeof c.header)["span"] }>();
    const genBusesOnline = new Set<number>();
    for (const g of c.generators) {
      if (g.stat === 1) genBusesOnline.add(g.i);
    }
    for (const l of c.loads) {
      if (l.status !== 1) continue;
      const prev = pqLoadByBus.get(l.i);
      const pNet = l.pl + l.ip;
      const qNet = l.ql + l.iq;
      pqLoadByBus.set(l.i, {
        p: (prev?.p ?? 0) + pNet,
        q: (prev?.q ?? 0) + qNet,
        span: prev?.span ?? l.span,
      });
    }
    const yIncByBus = new Map<number, number>();
    const addYCap = (busId: number, yCap: number) => {
      if (yCap > 0 && Number.isFinite(yCap)) {
        yIncByBus.set(busId, (yIncByBus.get(busId) ?? 0) + yCap);
      }
    };
    for (const br of c.branches) {
      if (br.st === 0) continue;
      const zMag = Math.hypot(br.r, br.x);
      if (zMag > 1e-6) {
        const y = 1.0 / zMag;
        addYCap(br.i, y);
        addYCap(br.j, y);
      }
    }
    for (const t of c.transformers) {
      if (t.stat === 0) continue;
      const zMag = Math.hypot(t.r12, t.x12);
      if (zMag > 1e-6) {
        const y = 1.0 / zMag;
        addYCap(t.i, y);
        addYCap(t.j, y);
        if (t.k !== 0) addYCap(t.k, y);
      }
    }
    for (const [busId, load] of pqLoadByBus) {
      const b = c.buses.get(busId);
      if (!b || b.ide !== 1 || genBusesOnline.has(busId)) continue;
      const sDemandMva = Math.hypot(load.p, load.q);
      const yCap = yIncByBus.get(busId) ?? 0;
      if (sDemandMva > 1.0 && yCap > 0) {
        // Upper bound on apparent power delivered across incident impedances at max neighbor V=1.15 pu
        const maxTransferMva = 1.15 * 1.15 * sbase * yCap;
        if (sDemandMva > 1.5 * maxTransferMva) {
          addDiag(
            PsseErrorCode.UNSOLVABLE_LOAD_POCKET.severity,
            PsseErrorCode.UNSOLVABLE_LOAD_POCKET.code,
            PsseErrorCode.UNSOLVABLE_LOAD_POCKET.message(busId, sDemandMva, maxTransferMva),
            load.span ?? b.span,
          );
        }
      }
    }
  }

  // 18. P6004: Sparse reduced Q-V Jacobian inverse-iteration voltage collapse proximity check
  if (c.buses.size >= 2 && c.buses.size <= 300) {
    const pqBuses = [...c.buses.values()].filter((b) => b.ide === 1);
    const npq = pqBuses.length;
    if (npq >= 1) {
      const pqIdx = new Map<number, number>();
      for (let i = 0; i < npq; i++) pqIdx.set(pqBuses[i]!.i, i);

      const qLoadByBus = new Map<number, number>();
      for (const l of c.loads) {
        if (l.status === 1) qLoadByBus.set(l.i, (qLoadByBus.get(l.i) ?? 0) + l.ql);
      }

      const jTriplets = new SparseTripletBuilder(npq, npq);
      for (const br of c.branches) {
        if (br.st === 0) continue;
        const z2 = br.r * br.r + br.x * br.x;
        if (z2 < 1e-10) continue;
        const bSeries = Math.abs(br.x) / z2;
        const ui = pqIdx.get(br.i);
        const uj = pqIdx.get(br.j);
        const bi = c.buses.get(br.i);
        const bj = c.buses.get(br.j);
        const vi = bi?.vm || 1.0;
        const vj = bj?.vm || 1.0;
        const cosD = Math.cos((((bi?.va ?? 0) - (bj?.va ?? 0)) * Math.PI) / 180);
        if (ui !== undefined) jTriplets.add(ui, ui, bSeries * vi);
        if (uj !== undefined) jTriplets.add(uj, uj, bSeries * vj);
        if (ui !== undefined && uj !== undefined) {
          jTriplets.add(ui, uj, -bSeries * vi * cosD);
          jTriplets.add(uj, ui, -bSeries * vj * cosD);
        }
      }
      for (const t of c.transformers) {
        if (t.stat === 0) continue;
        const z2 = t.r12 * t.r12 + t.x12 * t.x12;
        if (z2 < 1e-10) continue;
        const bSeries = Math.abs(t.x12) / z2;
        const ui = pqIdx.get(t.i);
        const uj = pqIdx.get(t.j);
        const bi = c.buses.get(t.i);
        const bj = c.buses.get(t.j);
        const vi = bi?.vm || 1.0;
        const vj = bj?.vm || 1.0;
        const cosD = Math.cos((((bi?.va ?? 0) - (bj?.va ?? 0)) * Math.PI) / 180);
        if (ui !== undefined) jTriplets.add(ui, ui, bSeries * vi);
        if (uj !== undefined) jTriplets.add(uj, uj, bSeries * vj);
        if (ui !== undefined && uj !== undefined) {
          jTriplets.add(ui, uj, -bSeries * vi * cosD);
          jTriplets.add(uj, ui, -bSeries * vj * cosD);
        }
      }
      // Include constant-power Q load softening (Qcalc/V term in J_QV)
      for (let i = 0; i < npq; i++) {
        const b = pqBuses[i]!;
        const qPu = (qLoadByBus.get(b.i) ?? 0) / sbase;
        const vi = Math.max(0.2, b.vm || 1.0);
        if (qPu > 0) jTriplets.add(i, i, -qPu / vi);
      }

      const ccs = jTriplets.toCCS();
      const lu = sparseLuFactor(ccs, { allowPerturbation: false });
      if (lu) {
        const rhs = new Float64Array(npq);
        const sol = new Float64Array(npq);
        rhs.fill(1 / Math.sqrt(npq));
        let norm = 1;
        let rayleigh = 1;
        let converged = true;
        for (let iter = 0; iter < 8; iter++) {
          sol.fill(0);
          sparseLuSolve(lu, rhs, sol);
          let s2 = 0;
          let dot = 0;
          for (let k = 0; k < npq; k++) {
            const sv = sol[k]!;
            s2 += sv * sv;
            dot += sv * rhs[k]!;
          }
          norm = Math.sqrt(s2);
          if (!Number.isFinite(norm) || norm <= 0) {
            converged = false;
            break;
          }
          rayleigh = dot !== 0 ? 1.0 / dot : norm > 0 ? 1.0 / norm : 0;
          for (let k = 0; k < npq; k++) rhs[k] = sol[k]! / norm;
        }
        if (converged && norm > 0) {
          const sigmaMin = rayleigh < 0 ? rayleigh : 1.0 / norm;
          if (sigmaMin < 0.08) {
            let maxIdx = 0;
            for (let k = 1; k < npq; k++) {
              if (Math.abs(rhs[k]!) > Math.abs(rhs[maxIdx]!)) maxIdx = k;
            }
            const weakBus = pqBuses[maxIdx]!;
            addDiag(
              PsseErrorCode.JACOBIAN_VOLTAGE_COLLAPSE.severity,
              PsseErrorCode.JACOBIAN_VOLTAGE_COLLAPSE.code,
              PsseErrorCode.JACOBIAN_VOLTAGE_COLLAPSE.message(sigmaMin, weakBus.i, norm),
              weakBus.span,
            );
          }
        }
      }
    }
  }

  return diagnostics;
}

export * from "./workspace.js";
