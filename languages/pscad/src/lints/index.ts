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
  CSMF_UNRESOLVED_INPUT: {
    code: "M6005",
    rule: "csmf-unresolved-input",
    severity: "error" as const,
    message: (blockId: string, missingInputId: string) =>
      `CSMF control block '${blockId}' references unresolved upstream signal block '${missingInputId}'.`,
  },
  LINE_TRAVEL_TIME_UNDERFLOW: {
    code: "M6006",
    rule: "line-travel-time-underflow",
    severity: "error" as const,
    message: (lineId: string, tauUs: number, dtUs: number) =>
      `Transmission line '${lineId}' wave propagation delay (${tauUs.toFixed(2)} us) is smaller than simulation time step (${dtUs.toFixed(2)} us). Reduce time step or use a lumped pi-section model.`,
  },
  SYNC_MACHINE_REACTANCE_ORDER: {
    code: "M6007",
    rule: "sync-machine-reactance-order",
    severity: "error" as const,
    message: (machineId: string, xd: number, xdPrime: number, xdSub: number) =>
      `Synchronous machine '${machineId}' violates physical d-axis reactance hierarchy (Xd=${xd} >= Xd'=${xdPrime} >= Xd''=${xdSub} pu required).`,
  },
  MOV_ARRESTER_UNDER_RATED: {
    code: "M6008",
    rule: "mov-arrester-under-rated",
    severity: "warning" as const,
    message: (arresterId: string, vRefKv: number, busName: string, vPeakPhaseKv: number) =>
      `MOV surge arrester '${arresterId}' reference voltage (${vRefKv.toFixed(1)} kV) is below connected bus '${busName}' nominal phase-to-ground peak voltage (${vPeakPhaseKv.toFixed(1)} kV), causing continuous thermal conduction.`,
  },
};

/**
 * Runs all PSCAD linter rules on a parsed project.
 */
export function lintPscx(project: PscxProject): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  const netlist = extractEmtNetlist(project);

  const allModules = [project.rootModule, ...Array.from(project.subModules?.values() ?? [])];

  const busLocationMap = new Map<string, { line?: number; column?: number }>();
  const cmpLocationMap = new Map<string, { line?: number; column?: number }>();
  for (const mod of allModules) {
    for (const b of mod.buses) {
      busLocationMap.set(b.id, { line: b.line, column: b.column });
    }
    for (const c of mod.components) {
      cmpLocationMap.set(c.id, { line: c.line, column: c.column });
    }
  }

  // 1. M6001: Check for isolated/floating buses
  for (const [busId, bus] of netlist.buses) {
    if (bus.connectedBranchIds.length === 0) {
      const loc = busLocationMap.get(busId);
      diagnostics.push({
        code: PscadErrorCode.FLOATING_NODE.code,
        rule: PscadErrorCode.FLOATING_NODE.rule,
        severity: PscadErrorCode.FLOATING_NODE.severity,
        message: PscadErrorCode.FLOATING_NODE.message(bus.name),
        busId,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.column !== undefined ? loc.column + (bus.name || busId).length : undefined,
      });
    }
  }

  // 2. M6002: Check transformer winding voltage matches connected bus base
  for (const xfmr of netlist.transformers) {
    const bus1 = netlist.buses.get(xfmr.fromBus);
    const bus2 = netlist.buses.get(xfmr.toBus);
    const loc = cmpLocationMap.get(xfmr.id);

    if (bus1 && bus1.baseKv > 0 && Math.abs(bus1.baseKv - xfmr.primaryKv) > 0.05 * bus1.baseKv) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.primaryKv, bus1.baseKv, "primary"),
        componentId: xfmr.id,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.column !== undefined ? loc.column + xfmr.id.length : undefined,
      });
    }

    if (bus2 && bus2.baseKv > 0 && Math.abs(bus2.baseKv - xfmr.secondaryKv) > 0.05 * bus2.baseKv) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.secondaryKv, bus2.baseKv, "secondary"),
        componentId: xfmr.id,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.column !== undefined ? loc.column + xfmr.id.length : undefined,
      });
    }
  }

  // 3. M6003: Check parameter bounds
  for (const mod of allModules) {
    for (const cmp of mod.components) {
      const defn = cmp.definitionName.toLowerCase();
      for (const [paramName, val] of Object.entries(cmp.parameters)) {
        if (typeof val === "number") {
          const lowerName = paramName.toLowerCase();
          const pLoc = cmp.paramLocations?.[paramName];
          const line = pLoc?.line ?? cmp.line;
          const column = pLoc?.column ?? cmp.column;
          const endColumn = column !== undefined ? column + paramName.length : undefined;
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
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
          if (
            (lowerName === "l" || lowerName === "inductance") &&
            (val < 0 || (defn.includes("inductor") && val <= 0))
          ) {
            diagnostics.push({
              code: PscadErrorCode.INVALID_PARAMETER.code,
              rule: PscadErrorCode.INVALID_PARAMETER.rule,
              severity: PscadErrorCode.INVALID_PARAMETER.severity,
              message: PscadErrorCode.INVALID_PARAMETER.message(
                cmp.instanceName || cmp.id,
                paramName,
                val,
                val < 0 ? "inductance cannot be negative" : "inductance must be positive",
              ),
              componentId: cmp.id,
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
          if (
            (lowerName === "c" || lowerName === "capacitance") &&
            (val < 0 || (defn.includes("capacitor") && val <= 0))
          ) {
            diagnostics.push({
              code: PscadErrorCode.INVALID_PARAMETER.code,
              rule: PscadErrorCode.INVALID_PARAMETER.rule,
              severity: PscadErrorCode.INVALID_PARAMETER.severity,
              message: PscadErrorCode.INVALID_PARAMETER.message(
                cmp.instanceName || cmp.id,
                paramName,
                val,
                val < 0 ? "capacitance cannot be negative" : "capacitance must be positive",
              ),
              componentId: cmp.id,
              line,
              column,
              endLine: line,
              endColumn,
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
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
        }
      }
    }
  }

  // 4. M6004: Check Short-Circuit Ratio (SCR) for FMU IBR instances
  const omega = 2 * Math.PI * (netlist.nominalFrequencyHz || 60);
  for (const fmu of netlist.fmuInstances) {
    const connectedBus = netlist.buses.get(fmu.busConnection);
    if (connectedBus && fmu.ratedMva > 0) {
      let availableGridMva = 0;

      // Direct transformers at POI
      for (const xfmr of netlist.transformers) {
        if (xfmr.fromBus === connectedBus.id || xfmr.toBus === connectedBus.id) {
          availableGridMva += xfmr.mvaRating / (xfmr.leakageReactancePu || 0.1);
        }
      }

      // Direct synchronous sources at POI
      for (const src of netlist.sources) {
        if (src.bus === connectedBus.id) {
          availableGridMva += src.mvaRating / 0.15;
        }
      }

      // 1-hop transmission lines connected to POI: S_sc ≈ V_base^2 / |Z_line|
      if (availableGridMva === 0 && connectedBus.baseKv > 0) {
        for (const line of netlist.transmissionLines) {
          if (line.fromBus === connectedBus.id || line.toBus === connectedBus.id) {
            const rTot = line.rPerKm * line.lengthKm;
            const xTot = omega * line.lPerKm * line.lengthKm;
            const zMag = Math.hypot(rTot, xTot);
            if (zMag > 0) {
              availableGridMva += (connectedBus.baseKv * connectedBus.baseKv) / zMag;
            }
          }
        }
      }

      if (availableGridMva > 0) {
        const scr = availableGridMva / fmu.ratedMva;
        if (scr < 1.5) {
          const loc = cmpLocationMap.get(fmu.id);
          diagnostics.push({
            code: PscadErrorCode.WEAK_GRID.code,
            rule: PscadErrorCode.WEAK_GRID.rule,
            severity: PscadErrorCode.WEAK_GRID.severity,
            message: PscadErrorCode.WEAK_GRID.message(connectedBus.name, scr),
            componentId: fmu.id,
            busId: connectedBus.id,
            line: loc?.line,
            column: loc?.column,
            endLine: loc?.line,
            endColumn: loc?.column !== undefined ? loc.column + fmu.id.length : undefined,
          });
        }
      }
    }
  }

  // 5. M6005: Check CSMF control block upstream signal references
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const knownBlockIds = new Set(netlist.controlBlocks.map((cb) => cb.id));
    for (const cb of netlist.controlBlocks) {
      for (const inp of cb.inputs) {
        if (!knownBlockIds.has(inp)) {
          const loc = cmpLocationMap.get(cb.id);
          diagnostics.push({
            code: PscadErrorCode.CSMF_UNRESOLVED_INPUT.code,
            rule: PscadErrorCode.CSMF_UNRESOLVED_INPUT.rule,
            severity: PscadErrorCode.CSMF_UNRESOLVED_INPUT.severity,
            message: PscadErrorCode.CSMF_UNRESOLVED_INPUT.message(cb.id, inp),
            componentId: cb.id,
            line: loc?.line,
            column: loc?.column,
            endLine: loc?.line,
            endColumn: loc?.column !== undefined ? loc.column + cb.id.length : undefined,
          });
        }
      }
    }
  }

  // 6. M6006: Check Bergeron / FDPM transmission line travel time vs simulation time step
  const dtUs = project.settings.timeStepUs > 0 ? project.settings.timeStepUs : 50.0;
  for (const line of netlist.transmissionLines) {
    if (line.modelType !== "pi" && line.lengthKm > 0 && line.lPerKm > 0 && line.cPerKm > 0) {
      const tauUs = line.lengthKm * Math.sqrt(line.lPerKm * line.cPerKm) * 1e6;
      if (tauUs < dtUs) {
        const loc = cmpLocationMap.get(line.id);
        diagnostics.push({
          code: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.code,
          rule: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.rule,
          severity: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.severity,
          message: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.message(line.id, tauUs, dtUs),
          componentId: line.id,
          line: loc?.line,
          column: loc?.column,
          endLine: loc?.line,
          endColumn: loc?.column !== undefined ? loc.column + line.id.length : undefined,
        });
      }
    }
  }

  // 7. M6007: Check Synchronous Machine subtransient/transient/synchronous reactance hierarchy (Xd >= Xd' >= Xd'')
  if (netlist.synchronousMachines) {
    for (const sm of netlist.synchronousMachines) {
      const xd = sm.xd ?? 1.8;
      const xdPrime = sm.xdPrime ?? 0.3;
      const xdSub = sm.xdSub ?? 0.2;
      if (xdSub > xdPrime || xdPrime > xd || xdSub <= 0) {
        const loc = cmpLocationMap.get(sm.id);
        diagnostics.push({
          code: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.code,
          rule: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.rule,
          severity: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.severity,
          message: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.message(sm.id, xd, xdPrime, xdSub),
          componentId: sm.id,
          line: loc?.line,
          column: loc?.column,
          endLine: loc?.line,
          endColumn: loc?.column !== undefined ? loc.column + sm.id.length : undefined,
        });
      }
    }
  }

  // 8. M6008: Check MOV Surge Arrester reference voltage against connected bus nominal phase-to-ground peak voltage
  if (netlist.surgeArresters) {
    for (const arr of netlist.surgeArresters) {
      const connectedBus = netlist.buses.get(arr.fromBus);
      if (connectedBus && connectedBus.baseKv > 0 && arr.vRefKv > 0) {
        const vPeakPhaseKv = connectedBus.baseKv * Math.sqrt(2.0 / 3.0);
        if (arr.vRefKv < vPeakPhaseKv) {
          const loc = cmpLocationMap.get(arr.id);
          diagnostics.push({
            code: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.code,
            rule: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.rule,
            severity: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.severity,
            message: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.message(
              arr.id,
              arr.vRefKv,
              connectedBus.name,
              vPeakPhaseKv,
            ),
            componentId: arr.id,
            busId: connectedBus.id,
            line: loc?.line,
            column: loc?.column,
            endLine: loc?.line,
            endColumn: loc?.column !== undefined ? loc.column + arr.id.length : undefined,
          });
        }
      }
    }
  }

  return diagnostics;
}
