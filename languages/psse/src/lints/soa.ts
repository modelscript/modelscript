// SPDX-License-Identifier: AGPL-3.0-or-later

import { PsseErrorCode } from "../errors.js";
import type { PsseSoaTables } from "../parser/raw-soa.js";
import type { PsseDiagnostic } from "../types.js";

/**
 * Zero-GC fast-path linter operating directly on `PsseSoaTables` contiguous typed arrays
 * (`Int32Array` / `Float64Array` / `Uint8Array`) for 50k–100k+ bus MMWG/WECC RAW decks.
 *
 * Covers high-signal bus, generator, branch, and island-topology checks (`P1001`, `P1002`,
 * `P2001`–`P2006`, `P2008`, `P3001`, `P3003`, `P4001`, `P4002`, `P4004`, `P4005`, `P4007`, `P6001`)
 * without allocating per-record JavaScript objects.
 */
export function lintPsseSoa(soa: PsseSoaTables): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  const push = (severity: "error" | "warning" | "info", code: string, message: string) => {
    diagnostics.push({ severity, code, message, startOffset: 0, endOffset: 0 });
  };

  const {
    nBuses,
    busId,
    busIde,
    busBaseKv,
    busVm,
    busIndexById,
    nGenerators,
    genBus,
    genStat,
    genPg,
    genQt,
    genQb,
    genVs,
    nBranches,
    brFrom,
    brTo,
    brR,
    brX,
    brB,
    brRateA,
    brSt,
  } = soa;

  // 1. Bus voltage bounds & slack count (P2002, P2003, P2004, P2005)
  let swingCount = 0;
  for (let i = 0; i < nBuses; i++) {
    const ide = busIde[i]!;
    if (ide === 3) swingCount++;
    if (ide !== 4) {
      const vm = busVm[i]!;
      const id = busId[i]!;
      if (vm < 0.8 || vm > 1.2) {
        push(
          PsseErrorCode.VOLTAGE_OUT_OF_BOUNDS.severity,
          PsseErrorCode.VOLTAGE_OUT_OF_BOUNDS.code,
          PsseErrorCode.VOLTAGE_OUT_OF_BOUNDS.message(id, vm),
        );
      } else if (vm < 0.9 || vm > 1.1) {
        push(
          PsseErrorCode.SUBSTATION_VOLTAGE_VIOLATION_NERC.severity,
          PsseErrorCode.SUBSTATION_VOLTAGE_VIOLATION_NERC.code,
          PsseErrorCode.SUBSTATION_VOLTAGE_VIOLATION_NERC.message(id, vm),
        );
      }
    }
  }
  if (swingCount === 0 && nBuses > 0) {
    push(
      PsseErrorCode.MISSING_SLACK_BUS.severity,
      PsseErrorCode.MISSING_SLACK_BUS.code,
      PsseErrorCode.MISSING_SLACK_BUS.message(),
    );
  } else if (swingCount > 1) {
    push(
      PsseErrorCode.MULTIPLE_SLACK_BUSES.severity,
      PsseErrorCode.MULTIPLE_SLACK_BUSES.code,
      PsseErrorCode.MULTIPLE_SLACK_BUSES.message(swingCount),
    );
  }

  // 2. Generators (P1001, P1002, P2006, P2008, P3001, P3003)
  for (let g = 0; g < nGenerators; g++) {
    const bId = genBus[g]!;
    const bIdx = busIndexById.get(bId);
    const stat = genStat[g]!;
    const gId = String(g + 1);
    if (bIdx === undefined) {
      push(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Generator", gId, "", bId),
      );
      continue;
    }
    const ide = busIde[bIdx]!;
    if (stat === 1) {
      if (ide === 4) {
        push(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(bId, `generator '${gId}'`),
        );
      } else if (ide === 1) {
        push(
          PsseErrorCode.GENERATOR_ON_PQ_BUS.severity,
          PsseErrorCode.GENERATOR_ON_PQ_BUS.code,
          PsseErrorCode.GENERATOR_ON_PQ_BUS.message(gId, bId),
        );
      }
      const pg = genPg[g]!;
      if (pg < 0) {
        push(
          PsseErrorCode.GENERATOR_NEGATIVE_POWER.severity,
          PsseErrorCode.GENERATOR_NEGATIVE_POWER.code,
          PsseErrorCode.GENERATOR_NEGATIVE_POWER.message(gId, bId, pg),
        );
      }
      const vs = genVs[g]!;
      if (vs < 0.8 || vs > 1.2) {
        push(
          PsseErrorCode.GENERATOR_SCHEDULED_VOLTAGE_BOUNDS.severity,
          PsseErrorCode.GENERATOR_SCHEDULED_VOLTAGE_BOUNDS.code,
          PsseErrorCode.GENERATOR_SCHEDULED_VOLTAGE_BOUNDS.message(gId, vs),
        );
      }
    }
    const qb = genQb[g]!;
    const qt = genQt[g]!;
    if (qb > qt) {
      push(
        PsseErrorCode.GENERATOR_REACTIVE_LIMITS_INVERTED.severity,
        PsseErrorCode.GENERATOR_REACTIVE_LIMITS_INVERTED.code,
        PsseErrorCode.GENERATOR_REACTIVE_LIMITS_INVERTED.message(gId, bId, qb, qt),
      );
    }
  }

  // 3. Branches & CSR degree count (P1001, P2006, P4001, P4002, P4004, P4005, P4007)
  const degree = new Int32Array(nBuses);
  for (let e = 0; e < nBranches; e++) {
    const uId = brFrom[e]!;
    const vId = Math.abs(brTo[e]!);
    const uIdx = busIndexById.get(uId);
    const vIdx = busIndexById.get(vId);
    const ckt = String(e + 1);
    if (uIdx === undefined) {
      push(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Branch", ckt, "'from' ", uId),
      );
    }
    if (vIdx === undefined) {
      push(
        PsseErrorCode.BUS_NOT_FOUND.severity,
        PsseErrorCode.BUS_NOT_FOUND.code,
        PsseErrorCode.BUS_NOT_FOUND.message("Branch", ckt, "'to' ", vId),
      );
    }
    const st = brSt[e]!;
    const r = brR[e]!;
    const x = brX[e]!;
    const b = brB[e]!;
    const rateA = brRateA[e]!;

    if (st === 1 && uIdx !== undefined && vIdx !== undefined) {
      if (busIde[uIdx] === 4) {
        push(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(uId, `branch '${ckt}'`),
        );
      }
      if (busIde[vIdx] === 4) {
        push(
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.severity,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.code,
          PsseErrorCode.TYPE4_BUS_WITH_INSERVICE_EQUIPMENT.message(vId, `branch '${ckt}'`),
        );
      }
      if (busIde[uIdx] !== 4 && busIde[vIdx] !== 4 && uIdx !== vIdx) {
        degree[uIdx]!++;
        degree[vIdx]!++;
      }
      const uKv = busBaseKv[uIdx]!;
      const vKv = busBaseKv[vIdx]!;
      if (uKv > 0 && vKv > 0 && Math.abs(uKv - vKv) > 0.01) {
        push(
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.severity,
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.code,
          PsseErrorCode.BRANCH_BASE_KV_MISMATCH.message(ckt, uId, uKv, vId, vKv),
        );
      }
      if (rateA <= 0) {
        push(
          PsseErrorCode.BRANCH_THERMAL_RATING_ZERO.severity,
          PsseErrorCode.BRANCH_THERMAL_RATING_ZERO.code,
          PsseErrorCode.BRANCH_THERMAL_RATING_ZERO.message(ckt, uId, vId),
        );
      }
    }

    if (x === 0) {
      push(
        PsseErrorCode.BRANCH_INVALID_REACTANCE.severity,
        PsseErrorCode.BRANCH_INVALID_REACTANCE.code,
        PsseErrorCode.BRANCH_INVALID_REACTANCE.message(ckt, uId, vId, x),
      );
    } else if (Math.abs(x) < 1e-5 && Math.abs(r) < 1e-5) {
      push(
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.severity,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.code,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.message(ckt, uId, vId, `near-zero impedance (R=${r}, X=${x})`),
      );
    }
    if (r < 0) {
      push(
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.severity,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.code,
        PsseErrorCode.BRANCH_EXTREME_IMPEDANCE.message(ckt, uId, vId, `negative resistance R = ${r} p.u.`),
      );
    }
    if (b > 5.0) {
      push(
        PsseErrorCode.LINE_CHARGING_MVAR_SUSPECT.severity,
        PsseErrorCode.LINE_CHARGING_MVAR_SUSPECT.code,
        PsseErrorCode.LINE_CHARGING_MVAR_SUSPECT.message(ckt, uId, vId, b),
      );
    }
  }

  // 4. Isolated buses (P2001) & typed-array CSR BFS island detection (P6001)
  if (!soa.hasComplexRecords) {
    const offsets = new Int32Array(nBuses + 1);
    for (let i = 0; i < nBuses; i++) {
      offsets[i + 1] = offsets[i]! + degree[i]!;
      if (busIde[i] !== 4 && degree[i] === 0) {
        push(
          PsseErrorCode.ISOLATED_BUS.severity,
          PsseErrorCode.ISOLATED_BUS.code,
          PsseErrorCode.ISOLATED_BUS.message(busId[i]!, String(busId[i]!)),
        );
      }
    }
    const totalEdges2 = offsets[nBuses]!;
    const adj = new Int32Array(totalEdges2);
    const cursor = offsets.slice(0, nBuses);
    for (let e = 0; e < nBranches; e++) {
      if (brSt[e] !== 1) continue;
      const u = busIndexById.get(brFrom[e]!);
      const v = busIndexById.get(Math.abs(brTo[e]!));
      if (u === undefined || v === undefined || u === v || busIde[u] === 4 || busIde[v] === 4) continue;
      adj[cursor[u]!++] = v;
      adj[cursor[v]!++] = u;
    }

    const visited = new Uint8Array(nBuses);
    const queue = new Int32Array(nBuses);
    for (let start = 0; start < nBuses; start++) {
      if (busIde[start] === 4 || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let hasSlack = false;
      while (head < tail) {
        const u = queue[head++]!;
        if (busIde[u] === 3) hasSlack = true;
        const end = offsets[u + 1]!;
        for (let p = offsets[u]!; p < end; p++) {
          const v = adj[p]!;
          if (!visited[v]) {
            visited[v] = 1;
            queue[tail++] = v;
          }
        }
      }
      if (tail > 1 && !hasSlack && swingCount > 0) {
        push(
          PsseErrorCode.UNANCHORED_ENERGIZED_ISLAND.severity,
          PsseErrorCode.UNANCHORED_ENERGIZED_ISLAND.code,
          PsseErrorCode.UNANCHORED_ENERGIZED_ISLAND.message(tail, busId[start]!),
        );
      }
    }
  }

  return diagnostics;
}
