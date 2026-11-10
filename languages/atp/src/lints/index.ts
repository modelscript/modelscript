// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for Alternative Transients Program (ATP-EMTP) Cases.
 */

import type { AtpCase } from "../types.js";

export interface AtpDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  node?: string | undefined;
  elementIndex?: number | undefined;
}

export const AtpErrorCode = {
  INVALID_CONTROL: "ATP1001",
  DANGLING_BUS: "ATP2001",
  NEGATIVE_PARAMETER: "ATP3001",
  SWITCH_TIMING_VIOLATION: "ATP4001",
} as const;

export const ATP_ERROR_CODES = AtpErrorCode;

/**
 * Lints an AtpCase for standard compliance, physical non-negativity, and switch timing.
 */
export function lintAtpCase(atpCase: AtpCase): AtpDiagnostic[] {
  const diagnostics: AtpDiagnostic[] = [];

  // ATP1001: Simulation control
  if (atpCase.control.deltaTSec <= 0 || atpCase.control.tMaxSec <= atpCase.control.deltaTSec) {
    diagnostics.push({
      code: AtpErrorCode.INVALID_CONTROL,
      severity: "error",
      message: `Invalid simulation control: deltaT (${atpCase.control.deltaTSec}s) must be > 0 and < tMax (${atpCase.control.tMaxSec}s).`,
    });
  }

  // ATP3001: Negative RLC parameters
  for (let i = 0; i < atpCase.branches.length; i++) {
    const b = atpCase.branches[i]!;
    if (b.rOhms < 0) {
      diagnostics.push({
        code: AtpErrorCode.NEGATIVE_PARAMETER,
        severity: "error",
        message: `Branch ${b.node1}-${b.node2} has negative resistance (${b.rOhms} Ohms).`,
        elementIndex: i,
      });
    }
    if (b.lMh < 0) {
      diagnostics.push({
        code: AtpErrorCode.NEGATIVE_PARAMETER,
        severity: "error",
        message: `Branch ${b.node1}-${b.node2} has negative inductance (${b.lMh} mH).`,
        elementIndex: i,
      });
    }
    if (b.cUf < 0) {
      diagnostics.push({
        code: AtpErrorCode.NEGATIVE_PARAMETER,
        severity: "error",
        message: `Branch ${b.node1}-${b.node2} has negative capacitance (${b.cUf} uF).`,
        elementIndex: i,
      });
    }
  }

  // ATP4001: Switch timing
  for (let i = 0; i < atpCase.switches.length; i++) {
    const s = atpCase.switches[i]!;
    if (s.tCloseSec > s.tOpenSec) {
      diagnostics.push({
        code: AtpErrorCode.SWITCH_TIMING_VIOLATION,
        severity: "warning",
        message: `Switch ${s.node1}-${s.node2} has close time (${s.tCloseSec}s) greater than open time (${s.tOpenSec}s).`,
        elementIndex: i,
      });
    }
  }

  // ATP2001: Dangling bus check
  const nodeConnections = new Map<string, number>();
  const groundNodes = new Set(["0", "GND", "GROUND", ""]);

  for (const b of atpCase.branches) {
    if (!groundNodes.has(b.node1)) {
      nodeConnections.set(b.node1, (nodeConnections.get(b.node1) || 0) + 1);
    }
    if (!groundNodes.has(b.node2)) {
      nodeConnections.set(b.node2, (nodeConnections.get(b.node2) || 0) + 1);
    }
  }

  for (const s of atpCase.sources) {
    if (!groundNodes.has(s.node)) {
      nodeConnections.set(s.node, (nodeConnections.get(s.node) || 0) + 1);
    }
  }

  for (const [node, count] of nodeConnections.entries()) {
    if (count === 1 && !atpCase.sources.some((s) => s.node === node)) {
      diagnostics.push({
        code: AtpErrorCode.DANGLING_BUS,
        severity: "warning",
        message: `Bus '${node}' is a dangling node with only 1 branch connection and no source injection.`,
        node,
      });
    }
  }

  return diagnostics;
}
