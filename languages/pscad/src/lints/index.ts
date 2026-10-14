// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Pre-flight Linter Rules.
 *
 * Implements static diagnostics to catch floating nodes, transformer rating
 * mismatches, physically invalid parameters, and weak-grid warnings.
 */

import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import type { PscadDiagnostic, PscxProject } from "../types.js";

export const PscadErrorCode = {
  FLOATING_NODE: {
    code: "M6001",
    rule: "floating-electrical-node",
    severity: "error" as const,
    message: (nodeName: string) => `Electrical node '${nodeName}' is floating with no closed connections.`,
  },
  TRANSFORMER_MISMATCH: {
    code: "M6002",
    rule: "transformer-winding-mismatch",
    severity: "warning" as const,
    message: (xfmrName: string, ratedKv: number, busKv: number, side: "primary" | "secondary") =>
      `Transformer '${xfmrName}' ${side} rating (${ratedKv} kV) does not match connected bus base (${busKv} kV).`,
  },
  INVALID_PARAMETER: {
    code: "M6003",
    rule: "invalid-parameter-bounds",
    severity: "error" as const,
    message: (elemName: string, paramName: string, val: number, reason: string) =>
      `Component '${elemName}' parameter '${paramName}' = ${val} is invalid: ${reason}.`,
  },
  WEAK_GRID: {
    code: "M6004",
    rule: "weak-grid-warning",
    severity: "warning" as const,
    message: (poiBus: string, scr: number) =>
      `Point of Interconnection '${poiBus}' has low Short-Circuit Ratio (SCR = ${scr.toFixed(2)} < 1.5). IBR control stability risks detected.`,
  },
};

/**
 * Runs all PSCAD linter rules on a parsed project.
 */
export function lintPscx(project: PscxProject): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  const netlist = extractEmtNetlist(project);

  // 1. M6001: Check for isolated/floating buses
  for (const [busId, bus] of netlist.buses) {
    if (bus.connectedBranchIds.length === 0) {
      diagnostics.push({
        code: PscadErrorCode.FLOATING_NODE.code,
        rule: PscadErrorCode.FLOATING_NODE.rule,
        severity: PscadErrorCode.FLOATING_NODE.severity,
        message: PscadErrorCode.FLOATING_NODE.message(bus.name),
        busId,
      });
    }
  }

  // 2. M6002: Check transformer winding voltage matches connected bus base
  for (const xfmr of netlist.transformers) {
    const bus1 = netlist.buses.get(xfmr.fromBus);
    const bus2 = netlist.buses.get(xfmr.toBus);

    if (bus1 && bus1.baseKv > 0 && Math.abs(bus1.baseKv - xfmr.primaryKv) > 0.05 * bus1.baseKv) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.primaryKv, bus1.baseKv, "primary"),
        componentId: xfmr.id,
      });
    }

    if (bus2 && bus2.baseKv > 0 && Math.abs(bus2.baseKv - xfmr.secondaryKv) > 0.05 * bus2.baseKv) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.secondaryKv, bus2.baseKv, "secondary"),
        componentId: xfmr.id,
      });
    }
  }

  // 3. M6003: Check parameter bounds
  for (const cmp of project.rootModule.components) {
    for (const [paramName, val] of Object.entries(cmp.parameters)) {
      if (typeof val === "number") {
        const lowerName = paramName.toLowerCase();
        if ((lowerName === "r" || lowerName === "resistance") && val < 0) {
          diagnostics.push({
            code: PscadErrorCode.INVALID_PARAMETER.code,
            rule: PscadErrorCode.INVALID_PARAMETER.rule,
            severity: PscadErrorCode.INVALID_PARAMETER.severity,
            message: PscadErrorCode.INVALID_PARAMETER.message(
              cmp.instanceName || cmp.id,
              paramName,
              val,
              "resistance cannot be negative",
            ),
            componentId: cmp.id,
          });
        }
        if ((lowerName === "l" || lowerName === "inductance") && val < 0) {
          diagnostics.push({
            code: PscadErrorCode.INVALID_PARAMETER.code,
            rule: PscadErrorCode.INVALID_PARAMETER.rule,
            severity: PscadErrorCode.INVALID_PARAMETER.severity,
            message: PscadErrorCode.INVALID_PARAMETER.message(
              cmp.instanceName || cmp.id,
              paramName,
              val,
              "inductance cannot be negative",
            ),
            componentId: cmp.id,
          });
        }
        if ((lowerName === "c" || lowerName === "capacitance") && val < 0) {
          diagnostics.push({
            code: PscadErrorCode.INVALID_PARAMETER.code,
            rule: PscadErrorCode.INVALID_PARAMETER.rule,
            severity: PscadErrorCode.INVALID_PARAMETER.severity,
            message: PscadErrorCode.INVALID_PARAMETER.message(
              cmp.instanceName || cmp.id,
              paramName,
              val,
              "capacitance cannot be negative",
            ),
            componentId: cmp.id,
          });
        }
        if ((lowerName === "mva" || lowerName === "rated_mva") && val <= 0) {
          diagnostics.push({
            code: PscadErrorCode.INVALID_PARAMETER.code,
            rule: PscadErrorCode.INVALID_PARAMETER.rule,
            severity: PscadErrorCode.INVALID_PARAMETER.severity,
            message: PscadErrorCode.INVALID_PARAMETER.message(
              cmp.instanceName || cmp.id,
              paramName,
              val,
              "MVA rating must be positive",
            ),
            componentId: cmp.id,
          });
        }
      }
    }
  }

  // 4. M6004: Check Short-Circuit Ratio (SCR) for FMU IBR instances
  for (const fmu of netlist.fmuInstances) {
    // Approximate Thevenin short-circuit MVA at POI:
    // S_sc = V_base^2 / Z_thevenin
    // If no strong source or high impedance, flag weak grid warning
    const connectedBus = netlist.buses.get(fmu.busConnection);
    if (connectedBus && fmu.ratedMva > 0) {
      // Simplified grid strength estimator: ratio of connected generation/transformation capacity to IBR MVA
      let availableGridMva = 0;
      for (const xfmr of netlist.transformers) {
        if (xfmr.fromBus === connectedBus.id || xfmr.toBus === connectedBus.id) {
          availableGridMva += xfmr.mvaRating / (xfmr.leakageReactancePu || 0.1);
        }
      }
      if (availableGridMva > 0) {
        const scr = availableGridMva / fmu.ratedMva;
        if (scr < 1.5) {
          diagnostics.push({
            code: PscadErrorCode.WEAK_GRID.code,
            rule: PscadErrorCode.WEAK_GRID.rule,
            severity: PscadErrorCode.WEAK_GRID.severity,
            message: PscadErrorCode.WEAK_GRID.message(connectedBus.name, scr),
            componentId: fmu.id,
            busId: connectedBus.id,
          });
        }
      }
    }
  }

  return diagnostics;
}
