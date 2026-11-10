// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for ASPEN OneLiner / CAPE Short-Circuit Cases.
 */

import type { OneLinerCase } from "../types.js";

export interface OneLinerDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string | undefined;
}

export const OneLinerErrorCode = {
  DUPLICATE_ID: "OLX1001",
  UNKNOWN_BUS: "OLX2001",
  INVALID_IMPEDANCE: "OLX3001",
  INVALID_RELAY_SETTING: "OLX4001",
} as const;

export const ONELINER_ERROR_CODES = OneLinerErrorCode;

/**
 * Validates a OneLinerCase for network connectivity, positive impedance, and relay setting sanity.
 */
export function lintOneLinerCase(c: OneLinerCase): OneLinerDiagnostic[] {
  const diagnostics: OneLinerDiagnostic[] = [];

  // OLX1001: Duplicate bus IDs
  const busIds = new Set<string>();
  for (const b of c.busses) {
    if (busIds.has(b.id)) {
      diagnostics.push({
        code: OneLinerErrorCode.DUPLICATE_ID,
        severity: "error",
        message: `Duplicate bus ID detected: '${b.id}'.`,
        elementId: b.id,
      });
    }
    busIds.add(b.id);
  }

  // OLX1001: Duplicate branch IDs
  const branchIds = new Set<string>();
  for (const br of c.branches) {
    if (branchIds.has(br.id)) {
      diagnostics.push({
        code: OneLinerErrorCode.DUPLICATE_ID,
        severity: "error",
        message: `Duplicate branch ID detected: '${br.id}'.`,
        elementId: br.id,
      });
    }
    branchIds.add(br.id);

    // OLX2001: Unknown bus in branch
    if (!busIds.has(br.bus1)) {
      diagnostics.push({
        code: OneLinerErrorCode.UNKNOWN_BUS,
        severity: "error",
        message: `Branch '${br.id}' references undefined terminal bus1 '${br.bus1}'.`,
        elementId: br.id,
      });
    }
    if (!busIds.has(br.bus2)) {
      diagnostics.push({
        code: OneLinerErrorCode.UNKNOWN_BUS,
        severity: "error",
        message: `Branch '${br.id}' references undefined terminal bus2 '${br.bus2}'.`,
        elementId: br.id,
      });
    }

    // OLX3001: Non-positive reactance
    if (br.z1.x <= 0) {
      diagnostics.push({
        code: OneLinerErrorCode.INVALID_IMPEDANCE,
        severity: "error",
        message: `Branch '${br.id}' has non-positive positive-sequence reactance X1=${br.z1.x}.`,
        elementId: br.id,
      });
    }
  }

  // OLX4001: Relay setting checks
  for (const oc of c.overcurrentRelays) {
    if (oc.pickupA <= 0) {
      diagnostics.push({
        code: OneLinerErrorCode.INVALID_RELAY_SETTING,
        severity: "error",
        message: `Overcurrent relay '${oc.id}' has non-positive pickup (${oc.pickupA} A).`,
        elementId: oc.id,
      });
    }
    if (oc.timeDial <= 0) {
      diagnostics.push({
        code: OneLinerErrorCode.INVALID_RELAY_SETTING,
        severity: "error",
        message: `Overcurrent relay '${oc.id}' has non-positive time dial TD=${oc.timeDial}.`,
        elementId: oc.id,
      });
    }
  }

  for (const d of c.distanceRelays) {
    if (d.zone1ReachOhms <= 0) {
      diagnostics.push({
        code: OneLinerErrorCode.INVALID_RELAY_SETTING,
        severity: "error",
        message: `Distance relay '${d.id}' has non-positive Zone 1 reach (${d.zone1ReachOhms} Ohms).`,
        elementId: d.id,
      });
    }
    if (d.zone2ReachOhms < d.zone1ReachOhms) {
      diagnostics.push({
        code: OneLinerErrorCode.INVALID_RELAY_SETTING,
        severity: "warning",
        message: `Distance relay '${d.id}' Zone 2 reach (${d.zone2ReachOhms}Ω) is less than Zone 1 reach (${d.zone1ReachOhms}Ω).`,
        elementId: d.id,
      });
    }
  }

  return diagnostics;
}
