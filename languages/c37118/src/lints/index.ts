// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c37118 — IEEE C37.118 Synchrophasor Configuration & Frame Linter.
 */

import type { C37118Diagnostic, C37118PmuConfig } from "../types.js";

export function lintC37118Config(config: C37118PmuConfig): C37118Diagnostic[] {
  const diagnostics: C37118Diagnostic[] = [];

  if (!Number.isInteger(config.idcode) || config.idcode < 1 || config.idcode > 65534) {
    diagnostics.push({
      code: "C37_1001",
      severity: "error",
      message: `Invalid PMU IDCODE ${config.idcode}; must be in [1, 65534].`,
    });
  }

  if (config.dataRate <= 0) {
    diagnostics.push({
      code: "C37_1002",
      severity: "error",
      message: `Invalid reporting rate ${config.dataRate} frames/s; must be positive.`,
    });
  }

  const seenNames = new Set<string>();
  for (const ph of config.phasors) {
    if (seenNames.has(ph.name)) {
      diagnostics.push({
        code: "C37_2001",
        severity: "error",
        message: `Duplicate phasor channel name '${ph.name}'.`,
        channelName: ph.name,
      });
    } else {
      seenNames.add(ph.name);
    }

    if (ph.scaleFactor <= 0) {
      diagnostics.push({
        code: "C37_2002",
        severity: "error",
        message: `Phasor channel '${ph.name}' has non-positive scaleFactor (${ph.scaleFactor}).`,
        channelName: ph.name,
      });
    }
  }

  for (const frame of config.frames) {
    if (Math.abs(frame.freqHz - config.fnom) > 5.0) {
      diagnostics.push({
        code: "C37_3001",
        severity: "warning",
        message: `Frame '${frame.timestamp}' frequency ${frame.freqHz} Hz deviates >5 Hz from nominal ${config.fnom} Hz.`,
      });
    }
    if (Math.abs(frame.rocofHzPerSec) > 10.0) {
      diagnostics.push({
        code: "C37_3002",
        severity: "warning",
        message: `Frame '${frame.timestamp}' ROCOF (${frame.rocofHzPerSec} Hz/s) exceeds ±10 Hz/s threshold.`,
      });
    }
  }

  return diagnostics;
}
