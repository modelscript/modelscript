// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for IEEE 1815 / DNP3 SCADA Device Profiles.
 */

import type { Dnp3DeviceProfile } from "../types.js";

export interface Dnp3Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  pointGroup?: string | undefined;
  pointIndex?: number | undefined;
}

export const Dnp3ErrorCode = {
  DUPLICATE_POINT_INDEX: "DNP1001",
  INVALID_ADDRESS: "DNP2001",
  INVALID_SCALING_DEADBAND: "DNP3001",
  INVERTED_LIMITS: "DNP4001",
} as const;

export const DNP3_ERROR_CODES = Dnp3ErrorCode;

/**
 * Validates a Dnp3DeviceProfile for point index uniqueness, addressing, and physical scaling sanity.
 */
export function lintDnp3Profile(profile: Dnp3DeviceProfile): Dnp3Diagnostic[] {
  const diagnostics: Dnp3Diagnostic[] = [];

  // DNP2001: Address validation (IEEE 1815 valid outstation range 0 - 65519)
  if (profile.outstationAddress < 0 || profile.outstationAddress > 65519) {
    diagnostics.push({
      code: Dnp3ErrorCode.INVALID_ADDRESS,
      severity: "error",
      message: `Invalid outstation address (${profile.outstationAddress}). DNP3 addresses must be between 0 and 65519.`,
    });
  }
  if (profile.masterAddress < 0 || profile.masterAddress > 65519) {
    diagnostics.push({
      code: Dnp3ErrorCode.INVALID_ADDRESS,
      severity: "error",
      message: `Invalid master address (${profile.masterAddress}). DNP3 addresses must be between 0 and 65519.`,
    });
  }

  // DNP1001: Duplicate point index checks across each group
  const checkDuplicates = (points: Array<{ index: number; name: string }>, group: string) => {
    const seen = new Set<number>();
    for (const pt of points) {
      if (seen.has(pt.index)) {
        diagnostics.push({
          code: Dnp3ErrorCode.DUPLICATE_POINT_INDEX,
          severity: "error",
          message: `Duplicate point index ${pt.index} detected in ${group} ('${pt.name}').`,
          pointGroup: group,
          pointIndex: pt.index,
        });
      }
      seen.add(pt.index);
    }
  };

  checkDuplicates(profile.binaryInputs, "BinaryInputs");
  checkDuplicates(profile.binaryOutputs, "BinaryOutputs");
  checkDuplicates(profile.analogInputs, "AnalogInputs");
  checkDuplicates(profile.analogOutputs, "AnalogOutputs");
  checkDuplicates(profile.counters, "Counters");

  // DNP3001 & DNP4001: Analog input scaling, deadband, and limits
  for (const ai of profile.analogInputs) {
    if (ai.deadband < 0) {
      diagnostics.push({
        code: Dnp3ErrorCode.INVALID_SCALING_DEADBAND,
        severity: "error",
        message: `Analog input '${ai.name}' [index ${ai.index}] has negative deadband (${ai.deadband}).`,
        pointGroup: "AnalogInputs",
        pointIndex: ai.index,
      });
    }

    if (ai.scalingMultiplier === 0) {
      diagnostics.push({
        code: Dnp3ErrorCode.INVALID_SCALING_DEADBAND,
        severity: "warning",
        message: `Analog input '${ai.name}' [index ${ai.index}] has zero scaling multiplier (measurement will be flat).`,
        pointGroup: "AnalogInputs",
        pointIndex: ai.index,
      });
    }

    if (ai.minVal !== undefined && ai.maxVal !== undefined && ai.minVal > ai.maxVal) {
      diagnostics.push({
        code: Dnp3ErrorCode.INVERTED_LIMITS,
        severity: "error",
        message: `Analog input '${ai.name}' [index ${ai.index}] has minVal (${ai.minVal}) greater than maxVal (${ai.maxVal}).`,
        pointGroup: "AnalogInputs",
        pointIndex: ai.index,
      });
    }
  }

  return diagnostics;
}
