// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Pre-flight Linter Rules.
 *
 * Implements static diagnostics to catch floating nodes, transformer rating
 * mismatches, physically invalid parameters, and weak-grid warnings.
 */

import { analyzeControlIntervals, isBounded, outputLimits } from "../analysis/control-intervals.js";
import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import { evaluateCheckRules } from "../script/script-parser.js";
import type { PscadDiagnostic, PscxProject } from "../types.js";

/**
 * Catalog of PSCAD pre-flight electrical and control diagnostic error codes (`M6001`–`M6011`).
 */
export const PscadErrorCode = {
  /** `M6001`: Electrical bus or node has no connected branches, sources, or shunt elements. */
  FLOATING_NODE: {
    code: "M6001",
    rule: "floating-electrical-node",
    severity: "error" as const,
    message: (nodeName: string) => `Electrical node '${nodeName}' is floating with no closed connections.`,
  },
  /** `M6002`: Transformer primary or secondary nominal voltage differs by more than 5% from the connected bus base kV. */
  TRANSFORMER_MISMATCH: {
    code: "M6002",
    rule: "transformer-winding-mismatch",
    severity: "warning" as const,
    message: (xfmrName: string, ratedKv: number, busKv: number, side: "primary" | "secondary") =>
      `Transformer '${xfmrName}' ${side} rating (${ratedKv} kV) does not match connected bus base (${busKv} kV).`,
  },
  /** `M6003`: Component physical parameter ($R$, $L$, $C$, or rated $\text{MVA}$) violates non-negativity or positivity bounds. */
  INVALID_PARAMETER: {
    code: "M6003",
    rule: "invalid-parameter-bounds",
    severity: "error" as const,
    message: (elemName: string, paramName: string, val: number, reason: string) =>
      `Component '${elemName}' parameter '${paramName}' = ${val} is invalid: ${reason}.`,
  },
  /** `M6004`: Point of Interconnection (POI) Short-Circuit Ratio ($\text{SCR} = S_{\text{sc}} / S_{\text{IBR}}$) is below 1.5. */
  WEAK_GRID: {
    code: "M6004",
    rule: "weak-grid-warning",
    severity: "warning" as const,
    message: (poiBus: string, scr: number) =>
      `Point of Interconnection '${poiBus}' has low Short-Circuit Ratio (SCR = ${scr.toFixed(2)} < 1.5). IBR control stability risks detected.`,
  },
  /** `M6005`: CSMF control block references an input signal ID that does not match any block in the schematic. */
  CSMF_UNRESOLVED_INPUT: {
    code: "M6005",
    rule: "csmf-unresolved-input",
    severity: "error" as const,
    message: (blockId: string, missingInputId: string) =>
      `CSMF control block '${blockId}' references unresolved upstream signal block '${missingInputId}'.`,
  },
  /** `M6006`: Distributed Bergeron/FDPM transmission line wave travel time $\tau = \ell\sqrt{L'C'}$ is shorter than the EMT step $\Delta t$. */
  LINE_TRAVEL_TIME_UNDERFLOW: {
    code: "M6006",
    rule: "line-travel-time-underflow",
    severity: "error" as const,
    message: (lineId: string, tauUs: number, dtUs: number) =>
      `Transmission line '${lineId}' wave propagation delay (${tauUs.toFixed(2)} us) is smaller than simulation time step (${dtUs.toFixed(2)} us). Reduce time step or use a lumped pi-section model.`,
  },
  /** `M6007`: Synchronous machine d-axis reactances violate the physical flux-leakage ordering $X_d \ge X_d' \ge X_d'' > 0$. */
  SYNC_MACHINE_REACTANCE_ORDER: {
    code: "M6007",
    rule: "sync-machine-reactance-order",
    severity: "error" as const,
    message: (machineId: string, xd: number, xdPrime: number, xdSub: number) =>
      `Synchronous machine '${machineId}' violates physical d-axis reactance hierarchy (Xd=${xd} >= Xd'=${xdPrime} >= Xd''=${xdSub} pu required).`,
  },
  /** `M6008`: Metal-Oxide Varistor (MOV) surge arrester $V_{\text{ref}}$ is below connected bus peak line-to-ground voltage $V_{\text{base}}\sqrt{2/3}$. */
  MOV_ARRESTER_UNDER_RATED: {
    code: "M6008",
    rule: "mov-arrester-under-rated",
    severity: "warning" as const,
    message: (arresterId: string, vRefKv: number, busName: string, vPeakPhaseKv: number) =>
      `MOV surge arrester '${arresterId}' reference voltage (${vRefKv.toFixed(1)} kV) is below connected bus '${busName}' nominal phase-to-ground peak voltage (${vPeakPhaseKv.toFixed(1)} kV), causing continuous thermal conduction.`,
  },
  /** `M6009`: Two components or buses share the same identifier within the same schematic canvas module. */
  DUPLICATE_COMPONENT_ID: {
    code: "M6009",
    rule: "duplicate-component-id",
    severity: "error" as const,
    message: (id: string, modName: string) =>
      `Duplicate component or bus ID '${id}' declared in schematic module '${modName}'.`,
  },
  /** `M6010`: A conductive wire net directly shorts two buses whose nominal base voltages differ by more than 5%. */
  BUS_VOLTAGE_CONFLICT: {
    code: "M6010",
    rule: "bus-voltage-conflict",
    severity: "error" as const,
    message: (busA: string, kvA: number, busB: string, kvB: number) =>
      `Conductive net shorts bus '${busA}' (${kvA} kV) directly to bus '${busB}' (${kvB} kV) without an intervening transformer.`,
  },
  /** `M6011`: A wire connects a CSMF control signal port directly to a 3-phase electrical port or bus. */
  PORT_DOMAIN_MISMATCH: {
    code: "M6011",
    rule: "port-domain-mismatch",
    severity: "error" as const,
    message: (wireId: string, sigPort: string, elecPort: string) =>
      `Wire '${wireId}' connects control signal port '${sigPort}' directly to 3-phase electrical port '${elecPort}'.`,
  },
  /** `M6012`: CSMF control blocks form a feedback cycle that contains no state (integrator, lag, delay) block. */
  ALGEBRAIC_LOOP: {
    code: "M6012",
    rule: "csmf-algebraic-loop",
    severity: "error" as const,
    message: (cycle: string) => `CSMF control blocks form an algebraic loop with no state or delay element: ${cycle}.`,
  },
  /** `M6013`: Two or more voltage sources with an explicit zero source impedance are connected to the same bus. */
  PARALLEL_IDEAL_SOURCES: {
    code: "M6013",
    rule: "parallel-ideal-sources",
    severity: "error" as const,
    message: (busName: string, sourceIds: string) =>
      `Ideal voltage sources ${sourceIds} are connected in parallel at bus '${busName}', making the nodal matrix singular.`,
  },
  /** `M6014`: Two or more voltage sources with no declared source impedance share a bus (solver applies a stiff default). */
  PARALLEL_LOW_IMPEDANCE_SOURCES: {
    code: "M6014",
    rule: "parallel-low-impedance-sources",
    severity: "warning" as const,
    message: (busName: string, sourceIds: string) =>
      `Voltage sources ${sourceIds} are connected in parallel at bus '${busName}' with no declared source impedance; a stiff default impedance is assumed and large circulating currents may result.`,
  },
  /** `M6015`: A limiter's input interval lies entirely outside its output limits, so it is permanently saturated. */
  PERMANENT_SATURATION: {
    code: "M6015",
    rule: "limiter-permanently-saturated",
    severity: "warning" as const,
    message: (blockId: string, inLo: number, inHi: number, limLo: number, limHi: number) =>
      `Limiter '${blockId}' is permanently saturated: its input stays within [${inLo}, ${inHi}] but its output limits are [${limLo}, ${limHi}].`,
  },
  /** `M6016`: Parameter validation check assertion failed in component `<segment name="Checks">`. */
  CHECK_FAILED: {
    code: "M6016",
    rule: "component-check-failed",
    severity: "error" as const,
    message: (cmpName: string, reason: string) => `Component '${cmpName}' check failed: ${reason}.`,
  },
  /** `M6017`: Parameter validation check warning in component `<segment name="Checks">`. */
  CHECK_WARNING: {
    code: "M6017",
    rule: "component-check-warning",
    severity: "warning" as const,
    message: (cmpName: string, reason: string) => `Component '${cmpName}' check warning: ${reason}.`,
  },
};

/** Control block kinds whose output depends on internal state, which breaks algebraic loops. */
const STATEFUL_BLOCK_KINDS = new Set(["pi", "lag", "leadlag", "integral", "fp_int", "upramp", "ratelimit"]);

/**
 * Tarjan strongly-connected-components over the control block graph (edge: input -> block).
 * Returns the SCCs that form a feedback cycle (size > 1, or a self loop).
 */
function findControlCycles(blocks: { id: string; kind: string; inputs: string[] }[]): string[][] {
  const ids = new Set(blocks.map((b) => b.id));
  const succ = new Map<string, string[]>();
  for (const b of blocks) succ.set(b.id, []);
  for (const b of blocks) {
    for (const inp of b.inputs) if (ids.has(inp)) succ.get(inp)!.push(b.id);
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of succ.get(v)!) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || succ.get(v)!.includes(v)) out.push(comp);
    }
  };
  for (const b of blocks) if (!idx.has(b.id)) strong(b.id);
  return out;
}

/**
 * Runs all PSCAD linter rules on a parsed project.
 */
export function lintPscx(project: PscxProject): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  const netlist = extractEmtNetlist(project);

  const allModules = [project.rootModule, ...Array.from(project.subModules?.values() ?? [])];

  const busLocationMap = new Map<
    string,
    { line?: number | undefined; column?: number | undefined; endColumn?: number | undefined }
  >();
  const cmpLocationMap = new Map<
    string,
    { line?: number | undefined; column?: number | undefined; endColumn?: number | undefined }
  >();
  for (const mod of allModules) {
    for (const b of mod.buses) {
      busLocationMap.set(b.id, { line: b.line, column: b.column, endColumn: b.endColumn });
    }
    for (const c of mod.components) {
      cmpLocationMap.set(c.id, { line: c.line, column: c.column, endColumn: c.endColumn });
    }
  }

  // 1. M6001: Check for isolated/floating buses
  for (const [busId, bus] of netlist.buses) {
    if (bus.connectedBranchIds.length === 0) {
      const busLoc = busLocationMap.get(busId);
      const cmpLoc = !busLoc && bus.sourceComponentId ? cmpLocationMap.get(bus.sourceComponentId) : undefined;
      const loc = busLoc ?? cmpLoc;
      diagnostics.push({
        code: PscadErrorCode.FLOATING_NODE.code,
        rule: PscadErrorCode.FLOATING_NODE.rule,
        severity: PscadErrorCode.FLOATING_NODE.severity,
        message: PscadErrorCode.FLOATING_NODE.message(bus.name),
        busId,
        componentId: bus.sourceComponentId,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.endColumn ?? (loc?.column !== undefined ? loc.column + (bus.name || busId).length : undefined),
      });
    }
  }

  // 2. M6002: Check transformer winding voltage matches connected bus base
  for (const xfmr of netlist.transformers) {
    const bus1 = netlist.buses.get(xfmr.fromBus);
    const bus2 = netlist.buses.get(xfmr.toBus);
    const loc = cmpLocationMap.get(xfmr.id);

    if (bus1 && bus1.explicitBaseKv && bus1.baseKv > 0 && Math.abs(bus1.baseKv - xfmr.primaryKv) > 0.05 * bus1.baseKv) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.primaryKv, bus1.baseKv, "primary"),
        componentId: xfmr.id,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.endColumn ?? (loc?.column !== undefined ? loc.column + xfmr.id.length : undefined),
      });
    }

    if (
      bus2 &&
      bus2.explicitBaseKv &&
      bus2.baseKv > 0 &&
      Math.abs(bus2.baseKv - xfmr.secondaryKv) > 0.05 * bus2.baseKv
    ) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.secondaryKv, bus2.baseKv, "secondary"),
        componentId: xfmr.id,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.endColumn ?? (loc?.column !== undefined ? loc.column + xfmr.id.length : undefined),
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

  // 9. M6009, M6010, M6011: Structural net-level lints (Duplicate IDs, Bus Voltage Conflicts, Port Domain Mismatches)
  for (const mod of allModules) {
    const seenIds = new Set<string>();
    for (const cmp of mod.components) {
      if (seenIds.has(cmp.id)) {
        diagnostics.push({
          code: PscadErrorCode.DUPLICATE_COMPONENT_ID.code,
          rule: PscadErrorCode.DUPLICATE_COMPONENT_ID.rule,
          severity: PscadErrorCode.DUPLICATE_COMPONENT_ID.severity,
          message: PscadErrorCode.DUPLICATE_COMPONENT_ID.message(cmp.id, mod.name || "Main"),
          componentId: cmp.id,
          line: cmp.line,
          column: cmp.column,
          endLine: cmp.line,
          endColumn: cmp.column !== undefined ? cmp.column + cmp.id.length : undefined,
        });
      } else {
        seenIds.add(cmp.id);
      }
    }
    for (const bus of mod.buses) {
      if (seenIds.has(bus.id)) {
        diagnostics.push({
          code: PscadErrorCode.DUPLICATE_COMPONENT_ID.code,
          rule: PscadErrorCode.DUPLICATE_COMPONENT_ID.rule,
          severity: PscadErrorCode.DUPLICATE_COMPONENT_ID.severity,
          message: PscadErrorCode.DUPLICATE_COMPONENT_ID.message(bus.id, mod.name || "Main"),
          busId: bus.id,
          line: bus.line,
          column: bus.column,
          endLine: bus.line,
          endColumn: bus.column !== undefined ? bus.column + bus.id.length : undefined,
        });
      } else {
        seenIds.add(bus.id);
      }
    }

    const busById = new Map(mod.buses.map((b) => [b.id, b]));
    const portMeta = new Map<string, { kind: string; isWirelessAdapter: boolean }>();
    for (const cmp of mod.components) {
      const cleanDef = (
        cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
      ).toLowerCase();
      const isWirelessAdapter =
        cleanDef === "datalabel" ||
        cleanDef === "data_label" ||
        cleanDef === "xnode" ||
        cleanDef === "pin" ||
        cleanDef === "radio_link";
      for (const p of cmp.ports) {
        portMeta.set(p.id, { kind: p.kind, isWirelessAdapter });
      }
    }

    const reportedBusConflictPairs = new Set<string>();
    const reportedWireDomainMismatch = new Set<string>();

    for (const wire of mod.wires) {
      // M6010: Check if a single wire net connects two explicit buses with conflicting voltageBaseKv
      const connectedBuses = wire.connectedPortIds
        .map((pid) => busById.get(pid))
        .filter((b): b is NonNullable<typeof b> => b !== undefined && (b.voltageBaseKv ?? 0) > 0);
      if (connectedBuses.length >= 2) {
        const bA = connectedBuses[0]!;
        for (let k = 1; k < connectedBuses.length; k++) {
          const bB = connectedBuses[k]!;
          const kvA = bA.voltageBaseKv!;
          const kvB = bB.voltageBaseKv!;
          if (Math.abs(kvA - kvB) > 0.05 * Math.max(kvA, kvB)) {
            const pairKey = [bA.id, bB.id].sort().join("::");
            if (!reportedBusConflictPairs.has(pairKey)) {
              reportedBusConflictPairs.add(pairKey);
              diagnostics.push({
                code: PscadErrorCode.BUS_VOLTAGE_CONFLICT.code,
                rule: PscadErrorCode.BUS_VOLTAGE_CONFLICT.rule,
                severity: PscadErrorCode.BUS_VOLTAGE_CONFLICT.severity,
                message: PscadErrorCode.BUS_VOLTAGE_CONFLICT.message(bA.name, kvA, bB.name, kvB),
                busId: bB.id,
                line: bB.line ?? wire.line,
                column: bB.column ?? 1,
                endLine: bB.line ?? wire.line,
                endColumn: (bB.column ?? 1) + bB.name.length,
              });
            }
          }
        }
      }

      // M6011: Check if a wire connects a non-adapter control signal port directly to an electrical port or bus
      if (!reportedWireDomainMismatch.has(wire.id)) {
        const sigPorts: string[] = [];
        const elecPorts: string[] = [];
        for (const pid of wire.connectedPortIds) {
          if (busById.has(pid)) {
            elecPorts.push(pid);
            continue;
          }
          const meta = portMeta.get(pid);
          if (!meta || meta.isWirelessAdapter) continue;
          if (meta.kind === "signal") sigPorts.push(pid);
          else if (meta.kind === "electrical") elecPorts.push(pid);
        }
        if (sigPorts.length > 0 && elecPorts.length > 0) {
          reportedWireDomainMismatch.add(wire.id);
          diagnostics.push({
            code: PscadErrorCode.PORT_DOMAIN_MISMATCH.code,
            rule: PscadErrorCode.PORT_DOMAIN_MISMATCH.rule,
            severity: PscadErrorCode.PORT_DOMAIN_MISMATCH.severity,
            message: PscadErrorCode.PORT_DOMAIN_MISMATCH.message(wire.id, sigPorts[0]!, elecPorts[0]!),
            line: wire.line ?? 1,
            column: 1,
            endLine: wire.line ?? 1,
            endColumn: 20,
          });
        }
      }
    }
  }

  // 10. M6012: Algebraic loops in CSMF control graph (Tarjan SCC without a stateful block)
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const kindById = new Map(netlist.controlBlocks.map((b) => [b.id, b.kind as string]));
    for (const comp of findControlCycles(netlist.controlBlocks)) {
      if (comp.some((id) => STATEFUL_BLOCK_KINDS.has(kindById.get(id) ?? ""))) continue;
      const first = comp[0]!;
      const loc = cmpLocationMap.get(first);
      diagnostics.push({
        code: PscadErrorCode.ALGEBRAIC_LOOP.code,
        rule: PscadErrorCode.ALGEBRAIC_LOOP.rule,
        severity: PscadErrorCode.ALGEBRAIC_LOOP.severity,
        message: PscadErrorCode.ALGEBRAIC_LOOP.message(comp.map((c) => `'${c}'`).join(" -> ")),
        componentId: first,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.column !== undefined ? loc.column + first.length : undefined,
      });
    }
  }

  // 11. M6013/M6014: Parallel zero-impedance voltage sources on one bus
  const noImpedance = netlist.sources.filter((s) => (s.rSourceOhm ?? 0) === 0 && (s.lSourceH ?? 0) === 0);
  const buckets = new Map<string, { strict: typeof noImpedance; loose: typeof noImpedance }>();
  for (const src of noImpedance) {
    const b = buckets.get(src.bus) ?? { strict: [], loose: [] };
    b.loose.push(src);
    if (src.rSourceSpecified) b.strict.push(src);
    buckets.set(src.bus, b);
  }
  for (const [busId, { strict, loose }] of buckets) {
    const isStrict = strict.length >= 2;
    const group = isStrict ? strict : loose;
    if (group.length < 2) continue;
    const def = isStrict ? PscadErrorCode.PARALLEL_IDEAL_SOURCES : PscadErrorCode.PARALLEL_LOW_IMPEDANCE_SOURCES;
    const second = group[1]!;
    const loc = cmpLocationMap.get(second.id);
    diagnostics.push({
      code: def.code,
      rule: def.rule,
      severity: def.severity,
      message: def.message(netlist.buses.get(busId)?.name ?? busId, group.map((s) => `'${s.name || s.id}'`).join(", ")),
      componentId: second.id,
      busId,
      line: loc?.line,
      column: loc?.column,
      endLine: loc?.line,
      endColumn: loc?.column !== undefined ? loc.column + second.id.length : undefined,
    });
  }

  // 12. M6015: Permanently saturated limiters (interval abstract interpretation, Tier 2)
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const intervals = analyzeControlIntervals(netlist.controlBlocks);
    for (const b of netlist.controlBlocks) {
      if (b.kind !== "limit" || b.inputs.length !== 1) continue;
      const input = intervals.get(b.inputs[0]!);
      if (!input || !isBounded(input)) continue;
      const lim = outputLimits(b);
      if (input.hi < lim.lo || input.lo > lim.hi) {
        const loc = cmpLocationMap.get(b.id);
        diagnostics.push({
          code: PscadErrorCode.PERMANENT_SATURATION.code,
          rule: PscadErrorCode.PERMANENT_SATURATION.rule,
          severity: PscadErrorCode.PERMANENT_SATURATION.severity,
          message: PscadErrorCode.PERMANENT_SATURATION.message(b.id, input.lo, input.hi, lim.lo, lim.hi),
          componentId: b.id,
          line: loc?.line,
          column: loc?.column,
          endLine: loc?.line,
          endColumn: loc?.column !== undefined ? loc.column + b.id.length : undefined,
        });
      }
    }
  }

  // 12. Component Parameter Checks (from <segment name="Checks">)
  if (project.definitions) {
    const allComponents = allModules.flatMap((m) => m.components);
    for (const cmp of allComponents) {
      const defName = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;
      const def = project.definitions.get(defName) ?? project.definitions.get(cmp.definitionName);
      if (!def?.checks || def.checks.length === 0) continue;

      const params: Record<string, string | number> = {
        ...(project.rootModule.parameterDefaults ?? {}),
        ...cmp.parameters,
      };

      const portDims: Record<string, number> = {};
      for (const port of cmp.ports) {
        if (port.name) {
          portDims[port.name] = port.dimension ?? 1;
        }
      }

      const failures = evaluateCheckRules(def.checks, params, portDims);
      for (const fail of failures) {
        const isWarn = fail.severity === "warning";
        const ruleDef = isWarn ? PscadErrorCode.CHECK_WARNING : PscadErrorCode.CHECK_FAILED;
        const loc = cmpLocationMap.get(cmp.id);
        diagnostics.push({
          code: ruleDef.code,
          rule: ruleDef.rule,
          severity: ruleDef.severity,
          message: isWarn
            ? PscadErrorCode.CHECK_WARNING.message(cmp.instanceName || cmp.id, fail.message)
            : PscadErrorCode.CHECK_FAILED.message(cmp.instanceName || cmp.id, fail.message),
          componentId: cmp.id,
          line: loc?.line ?? cmp.line,
          column: loc?.column ?? cmp.column,
          endLine: loc?.line ?? cmp.line,
          endColumn:
            (loc?.column ?? cmp.column) !== undefined
              ? (loc?.column ?? cmp.column)! + (cmp.instanceName || cmp.id).length
              : undefined,
        });
      }
    }
  }

  return diagnostics;
}
