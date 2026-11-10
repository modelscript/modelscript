// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASPEN OneLiner / CAPE Short-Circuit (.dxt) Data Serializer.
 */

import type { OneLinerCase } from "../types.js";

export function writeOneLinerDxt(c: OneLinerCase): string {
  const lines: string[] = [];

  lines.push("[CASE DATA]");
  lines.push(`BASE_MVA=${c.baseMva}, FREQ=${c.frequencyHz}, TITLE="${c.title}"`);
  lines.push("");

  if (c.busses.length > 0) {
    lines.push("[BUS DATA]");
    lines.push("// BUS_ID, BUS_NAME, BASE_KV, AREA, ZONE");
    for (const b of c.busses) {
      lines.push(`${b.id}, "${b.name}", ${b.baseKv}, ${b.area ?? 1}, ${b.zone ?? 1}`);
    }
    lines.push("");
  }

  if (c.branches.length > 0) {
    lines.push("[LINE DATA]");
    lines.push("// LINE_ID, BUS1, BUS2, CKT, R1, X1, R0, X0, B1, B0, RATING, LENGTH");
    for (const br of c.branches) {
      const ckt = br.circuitId ?? "1";
      const b1 = br.b1 ?? 0.0;
      const b0 = br.b0 ?? 0.0;
      const rating = br.ratingMva ?? 100.0;
      const len = br.lengthMiles ?? 10.0;
      lines.push(
        `"${br.id}", ${br.bus1}, ${br.bus2}, "${ckt}", ${br.z1.r}, ${br.z1.x}, ${br.z0.r}, ${br.z0.x}, ${b1}, ${b0}, ${rating}, ${len}`,
      );
    }
    lines.push("");
  }

  if (c.mutuals.length > 0) {
    lines.push("[MUTUAL DATA]");
    lines.push("// LINE1, LINE2, R0M, X0M");
    for (const m of c.mutuals) {
      lines.push(`"${m.branch1Id}", "${m.branch2Id}", ${m.z0m.r}, ${m.z0m.x}`);
    }
    lines.push("");
  }

  if (c.generators.length > 0) {
    lines.push("[GENERATOR DATA]");
    lines.push("// GEN_ID, BUS_ID, MVA, R1_SUB, X1_SUB, R0, X0");
    for (const g of c.generators) {
      lines.push(
        `"${g.id}", ${g.busId}, ${g.mvaRating}, ${g.z1Subtransient.r}, ${g.z1Subtransient.x}, ${g.z0.r}, ${g.z0.x}`,
      );
    }
    lines.push("");
  }

  if (c.overcurrentRelays.length > 0) {
    lines.push("[RELAY OVERCURRENT]");
    lines.push("// RELAY_ID, NAME, BRANCH, BUS, PICKUP, CT_RATIO, TD, CURVE, INST");
    for (const r of c.overcurrentRelays) {
      const inst = r.instantaneousPickupA !== undefined ? `, ${r.instantaneousPickupA}` : "";
      lines.push(
        `"${r.id}", "${r.name}", "${r.branchId}", ${r.busId}, ${r.pickupA}, ${r.ctRatio}, ${r.timeDial}, "${r.curve}"${inst}`,
      );
    }
    lines.push("");
  }

  if (c.distanceRelays.length > 0) {
    lines.push("[RELAY DISTANCE]");
    lines.push("// RELAY_ID, NAME, BRANCH, BUS, Z1_REACH, Z2_REACH, Z2_DELAY, Z3_REACH, Z3_DELAY");
    for (const d of c.distanceRelays) {
      const z3 = d.zone3ReachOhms !== undefined ? `, ${d.zone3ReachOhms}, ${d.zone3DelaySec ?? 1.0}` : "";
      lines.push(
        `"${d.id}", "${d.name}", "${d.branchId}", ${d.busId}, ${d.zone1ReachOhms}, ${d.zone2ReachOhms}, ${d.zone2DelaySec}${z3}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
