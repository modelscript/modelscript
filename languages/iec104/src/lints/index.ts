// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iec104 — Protocol & Profile Linter for IEC 60870-5-104.
 */

import type { Iec104Diagnostic, Iec104StationProfile } from "../types.js";

export function lintIec104Profile(profile: Iec104StationProfile): Iec104Diagnostic[] {
  const diagnostics: Iec104Diagnostic[] = [];

  if (profile.commonAddress < 1 || profile.commonAddress > 65534) {
    diagnostics.push({
      code: "IEC104_1001",
      severity: "error",
      message: `Invalid ASDU Common Address ${profile.commonAddress}; must be in [1, 65534].`,
    });
  }

  if (profile.apci.k <= 0 || profile.apci.w <= 0 || profile.apci.w > profile.apci.k) {
    diagnostics.push({
      code: "IEC104_1002",
      severity: "error",
      message: `Invalid APCI window parameters (k=${profile.apci.k}, w=${profile.apci.w}); require 0 < w <= k.`,
    });
  }

  if (profile.apci.t1 <= profile.apci.t2) {
    diagnostics.push({
      code: "IEC104_1003",
      severity: "warning",
      message: `APCI timeout t1 (${profile.apci.t1}s) should exceed t2 (${profile.apci.t2}s).`,
    });
  }

  const seenIoas = new Set<number>();
  for (const pt of profile.points) {
    if (!Number.isInteger(pt.ioa) || pt.ioa < 1 || pt.ioa > 16777215) {
      diagnostics.push({
        code: "IEC104_2001",
        severity: "error",
        message: `Information Object Address (IOA) ${pt.ioa} for '${pt.name}' is outside [1, 16777215].`,
        ioa: pt.ioa,
      });
    } else if (seenIoas.has(pt.ioa)) {
      diagnostics.push({
        code: "IEC104_2002",
        severity: "error",
        message: `Duplicate IOA ${pt.ioa} on point '${pt.name}'.`,
        ioa: pt.ioa,
      });
    } else {
      seenIoas.add(pt.ioa);
    }

    if (pt.scale !== undefined && pt.scale === 0) {
      diagnostics.push({
        code: "IEC104_3001",
        severity: "warning",
        message: `Point '${pt.name}' (IOA ${pt.ioa}) has zero scale factor.`,
        ioa: pt.ioa,
      });
    }

    if (pt.deadband !== undefined && pt.deadband < 0) {
      diagnostics.push({
        code: "IEC104_3002",
        severity: "error",
        message: `Point '${pt.name}' (IOA ${pt.ioa}) has negative deadband (${pt.deadband}).`,
        ioa: pt.ioa,
      });
    }
  }

  return diagnostics;
}
