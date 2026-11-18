// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rtds — Real-Time EMT & HIL Netlist Linter.
 */

import type { RtdsDiagnostic, RtdsDraft } from "../types.js";

export function lintRtdsDraft(draft: RtdsDraft): RtdsDiagnostic[] {
  const diagnostics: RtdsDiagnostic[] = [];

  if (!Number.isFinite(draft.timeStepSec) || draft.timeStepSec <= 0) {
    diagnostics.push({
      code: "RTDS1001",
      severity: "error",
      message: `Invalid RTDS TIME_STEP (${draft.timeStepSec} s); must be positive.`,
    });
  } else if (draft.timeStepSec > 100e-6) {
    diagnostics.push({
      code: "RTDS1002",
      severity: "warning",
      message: `RTDS TIME_STEP (${(draft.timeStepSec * 1e6).toFixed(1)} us) exceeds typical 50-100 us real-time EMT step.`,
    });
  }

  const seenNames = new Set<string>();
  let hasSource = false;

  for (const comp of draft.components) {
    if (seenNames.has(comp.name)) {
      diagnostics.push({
        code: "RTDS2001",
        severity: "error",
        message: `Duplicate component name '${comp.name}'.`,
        componentName: comp.name,
      });
    } else {
      seenNames.add(comp.name);
    }

    if (comp.type === "SOURCE" || comp.type === "IBR") hasSource = true;

    if (comp.nodes.length === 0) {
      diagnostics.push({
        code: "RTDS2002",
        severity: "error",
        message: `Component '${comp.name}' has no connected nodes.`,
        componentName: comp.name,
      });
    }

    const r = Number(comp.params["R"] ?? 0);
    const l = Number(comp.params["L"] ?? 0);
    const c = Number(comp.params["C"] ?? 0);
    if (r < 0 || l < 0 || c < 0) {
      diagnostics.push({
        code: "RTDS3001",
        severity: "error",
        message: `Component '${comp.name}' has negative R/L/C parameter.`,
        componentName: comp.name,
      });
    }
  }

  if (draft.components.length > 0 && !hasSource) {
    diagnostics.push({
      code: "RTDS4001",
      severity: "warning",
      message: "No SOURCE or IBR excitation component found in RTDS draft.",
    });
  }

  return diagnostics;
}
