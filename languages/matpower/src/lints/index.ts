// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for MATPOWER grid models (.m).
 */

import type { MatpowerCase } from "../types.js";

export interface MatpowerDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  busNumber?: number;
}

export const MatpowerErrorCode = {
  NO_SLACK_BUS: "MP3001",
  MULTIPLE_SLACK_BUSES: "MP3002",
  DUPLICATE_BUS: "MP2001",
  BRANCH_UNKNOWN_BUS: "MP2002",
  GEN_UNKNOWN_BUS: "MP2003",
  ZERO_IMPEDANCE: "MP3003",
  VOLTAGE_LIMITS_INVERTED: "MP3004",
  GEN_PLIMITS_INVERTED: "MP3005",
  GEN_QLIMITS_INVERTED: "MP3006",
  ISOLATED_BUS: "MP4001",
} as const;

/**
 * Validates a MATPOWER case for electrical, topological, and parameter integrity.
 */
export function lintMatpowerCase(mpc: MatpowerCase): MatpowerDiagnostic[] {
  const diagnostics: MatpowerDiagnostic[] = [];
  const busIds = new Set<number>();
  let slackCount = 0;

  // 1. Bus checks
  for (const b of mpc.bus) {
    if (busIds.has(b.bus_i)) {
      diagnostics.push({
        code: MatpowerErrorCode.DUPLICATE_BUS,
        severity: "error",
        message: `Duplicate bus number '${b.bus_i}' found in mpc.bus.`,
        busNumber: b.bus_i,
      });
    }
    busIds.add(b.bus_i);

    if (b.type === 3) {
      slackCount++;
    }

    if (b.vmin > b.vmax) {
      diagnostics.push({
        code: MatpowerErrorCode.VOLTAGE_LIMITS_INVERTED,
        severity: "error",
        message: `Bus '${b.bus_i}' has inverted voltage limits: Vmin (${b.vmin}) > Vmax (${b.vmax}).`,
        busNumber: b.bus_i,
      });
    }
  }

  // 2. Slack bus check
  if (slackCount === 0) {
    diagnostics.push({
      code: MatpowerErrorCode.NO_SLACK_BUS,
      severity: "error",
      message: `No reference/slack bus (type 3) defined in mpc.bus.`,
    });
  }

  // 3. Generator checks
  for (const g of mpc.gen) {
    if (!busIds.has(g.bus)) {
      diagnostics.push({
        code: MatpowerErrorCode.GEN_UNKNOWN_BUS,
        severity: "error",
        message: `Generator is connected to nonexistent bus '${g.bus}'.`,
        busNumber: g.bus,
      });
    }

    if (g.pmin > g.pmax) {
      diagnostics.push({
        code: MatpowerErrorCode.GEN_PLIMITS_INVERTED,
        severity: "error",
        message: `Generator at bus '${g.bus}' has inverted active power limits: Pmin (${g.pmin} MW) > Pmax (${g.pmax} MW).`,
        busNumber: g.bus,
      });
    }

    if (g.qmin > g.qmax) {
      diagnostics.push({
        code: MatpowerErrorCode.GEN_QLIMITS_INVERTED,
        severity: "error",
        message: `Generator at bus '${g.bus}' has inverted reactive power limits: Qmin (${g.qmin} MVAr) > Qmax (${g.qmax} MVAr).`,
        busNumber: g.bus,
      });
    }
  }

  // 4. Branch checks
  for (const br of mpc.branch) {
    if (!busIds.has(br.fbus)) {
      diagnostics.push({
        code: MatpowerErrorCode.BRANCH_UNKNOWN_BUS,
        severity: "error",
        message: `Branch connects from nonexistent bus '${br.fbus}'.`,
        busNumber: br.fbus,
      });
    }
    if (!busIds.has(br.tbus)) {
      diagnostics.push({
        code: MatpowerErrorCode.BRANCH_UNKNOWN_BUS,
        severity: "error",
        message: `Branch connects to nonexistent bus '${br.tbus}'.`,
        busNumber: br.tbus,
      });
    }

    if (Math.abs(br.r) < 1e-9 && Math.abs(br.x) < 1e-9) {
      diagnostics.push({
        code: MatpowerErrorCode.ZERO_IMPEDANCE,
        severity: "error",
        message: `Branch from bus '${br.fbus}' to bus '${br.tbus}' has zero series impedance (R=0, X=0).`,
      });
    }
  }

  return diagnostics;
}
