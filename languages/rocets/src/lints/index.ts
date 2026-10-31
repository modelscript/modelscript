// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-Flight Static Analysis and Linter Engine for NASA ROCETS.
 *
 * Implements 14 propulsion domain diagnostic rules (M8001–M8014) covering
 * fluid connectivity, shaft power balance, non-physical pressures/temperatures,
 * valve schedules, pump cavitation risk, choked flow consistency, and Fortran user routines.
 */

import type { RocetsEngineModel } from "../types.js";

export interface RocetsDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  componentId?: string | undefined;
}

export const RocetsErrorCode = {
  UNCONNECTED_FLUID_PORT: {
    code: 8001,
    id: "M8001",
    rule: "unconnected-fluid-port",
    severity: "error" as const,
    message: (comp: string, port: string) =>
      `Fluid port '${comp}.${port}' is not connected in the propellant flow circuit.`,
  },
  FLUID_TYPE_MISMATCH: {
    code: 8002,
    id: "M8002",
    rule: "fluid-type-mismatch",
    severity: "error" as const,
    message: (fromFluid: string, toFluid: string, conn: string) =>
      `Incompatible fluid stream connection '${conn}': cannot mix '${fromFluid}' into '${toFluid}' without a combustion chamber.`,
  },
  SHAFT_POWER_IMBALANCE: {
    code: 8003,
    id: "M8003",
    rule: "shaft-power-imbalance",
    severity: "error" as const,
    message: (shaftId: string, reason: string) => `Turbopump shaft '${shaftId}' power imbalance: ${reason}.`,
  },
  UNBALANCED_FLOW_SPLIT: {
    code: 8004,
    id: "M8004",
    rule: "unbalanced-flow-split",
    severity: "error" as const,
    message: (junct: string, diff: number) =>
      `Mass conservation failure at junction '${junct}': inlet and outlet flow mismatch exceeds tolerance (|Δm| = ${diff.toFixed(3)} kg/s).`,
  },
  PUMP_CAVITATION_RISK: {
    code: 8005,
    id: "M8005",
    rule: "pump-cavitation-risk",
    severity: "warning" as const,
    message: (pumpId: string, margin: number) =>
      `Pump '${pumpId}' inlet suction pressure is below required NPSH margin (margin: ${margin.toFixed(1)} kPa). Cavitation risk.`,
  },
  NEGATIVE_CHAMBER_PRESSURE: {
    code: 8006,
    id: "M8006",
    rule: "negative-chamber-pressure",
    severity: "error" as const,
    message: (comp: string, val: number) =>
      `Non-physical pressure at '${comp}': computed pressure is ${val} Pa (must be > 0).`,
  },
  COMBUSTION_TEMPERATURE_LIMIT: {
    code: 8007,
    id: "M8007",
    rule: "combustion-temperature-limit",
    severity: "warning" as const,
    message: (comp: string, tempK: number, limitK: number) =>
      `Gas temperature at '${comp}' (${tempK.toFixed(0)} K) exceeds throat thermal structural limit (${limitK} K).`,
  },
  INVALID_VALVE_SCHEDULE: {
    code: 8008,
    id: "M8008",
    rule: "invalid-valve-schedule",
    severity: "error" as const,
    message: (valveId: string, reason: string) => `Invalid valve actuation profile for '${valveId}': ${reason}.`,
  },
  CHOKED_FLOW_INCONSISTENCY: {
    code: 8009,
    id: "M8009",
    rule: "choked-flow-inconsistency",
    severity: "warning" as const,
    message: (comp: string, pr: number) =>
      `Supersonic nozzle expansion at '${comp}' is not choked (pressure ratio Pc/Pa = ${pr.toFixed(2)} < 1.89).`,
  },
  USER_FORTRAN_ROUTINE_ERROR: {
    code: 8010,
    id: "M8010",
    rule: "user-fortran-routine-error",
    severity: "error" as const,
    message: (comp: string, msg: string) =>
      `Fortran user routine in component '${comp}' has syntax or semantic error: ${msg}.`,
  },
  EXTREME_MIXTURE_RATIO: {
    code: 8011,
    id: "M8011",
    rule: "extreme-mixture-ratio",
    severity: "warning" as const,
    message: (comp: string, mr: number) =>
      `Engine mixture ratio (O/F = ${mr.toFixed(2)}) at '${comp}' is outside stable combustion limits.`,
  },
  MISSING_FLUID_TABLE: {
    code: 8012,
    id: "M8012",
    rule: "missing-fluid-table",
    severity: "error" as const,
    message: (fluid: string) => `Propellant fluid table for '${fluid}' is not loaded in the session.`,
  },
  TURBINE_OVERSPEED_HAZARD: {
    code: 8013,
    id: "M8013",
    rule: "turbine-overspeed-hazard",
    severity: "warning" as const,
    message: (shaft: string, rpm: number, maxRpm: number) =>
      `Turbopump shaft '${shaft}' speed (${rpm.toFixed(0)} RPM) exceeds maximum burst rating (${maxRpm} RPM).`,
  },
  CLOSED_FLOW_CIRCUIT: {
    code: 8014,
    id: "M8014",
    rule: "closed-flow-circuit",
    severity: "error" as const,
    message: (pumpId: string) =>
      `Pump '${pumpId}' discharge is completely blocked with no open valve or recirculation path.`,
  },
};

const SUPPORTED_FLUID_TABLES = new Set([
  "LOX",
  "OXYGEN",
  "GOX",
  "LH2",
  "HYDROGEN",
  "GH2",
  "LCH4",
  "METHANE",
  "RP1",
  "KEROSENE",
  "COMBUSTION_GAS",
  "HELIUM",
  "NITROGEN",
  "MMH",
  "NTO",
  "N2O4",
  "H2O",
  "WATER",
  "AIR",
]);

/**
 * Runs all pre-flight static propulsion diagnostics on a parsed ROCETS model.
 */
export function lintRocets(model: RocetsEngineModel): RocetsDiagnostic[] {
  const diags: RocetsDiagnostic[] = [];

  // Track incoming and outgoing connections per component port
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const compOutgoingTargets = new Map<string, string[]>();

  for (const conn of model.connections) {
    const fromKey = `${conn.fromComponent}.${conn.fromPort}`;
    const toKey = `${conn.toComponent}.${conn.toPort}`;

    const outList = outgoing.get(fromKey) || [];
    outList.push(toKey);
    outgoing.set(fromKey, outList);

    const inList = incoming.get(toKey) || [];
    inList.push(fromKey);
    incoming.set(toKey, inList);

    const cTargets = compOutgoingTargets.get(conn.fromComponent) || [];
    cTargets.push(conn.toComponent);
    compOutgoingTargets.set(conn.fromComponent, cTargets);
  }

  const emittedFluids = new Set<string>();
  const checkFluidTable = (fluid: string | undefined, compId?: string, line?: number, col?: number) => {
    if (!fluid) return;
    const upper = fluid.toUpperCase();
    if (!SUPPORTED_FLUID_TABLES.has(upper) && !emittedFluids.has(`${compId ?? ""}:${upper}`)) {
      emittedFluids.add(`${compId ?? ""}:${upper}`);
      diags.push({
        ...RocetsErrorCode.MISSING_FLUID_TABLE,
        message: RocetsErrorCode.MISSING_FLUID_TABLE.message(fluid),
        componentId: compId,
        line,
        column: col,
      });
    }
  };

  let pumpCount = 0;
  let turbineCount = 0;
  let explicitPumpPowerSum = 0;
  let explicitTurbPowerSum = 0;
  for (const [, c] of model.components) {
    const ct = c.type.toUpperCase();
    if (ct === "PUMP") {
      pumpCount++;
      if (typeof c.parameters["POWER"] === "number") explicitPumpPowerSum += c.parameters["POWER"];
    } else if (ct === "TURBINE") {
      turbineCount++;
      if (typeof c.parameters["POWER"] === "number") explicitTurbPowerSum += c.parameters["POWER"];
    }
  }

  // 1. Component checks
  for (const [compId, comp] of model.components) {
    const t = comp.type.toUpperCase();

    // M8012: Fluid table check on component parameter and ports
    if (typeof comp.parameters["FLUID"] === "string") {
      checkFluidTable(comp.parameters["FLUID"], compId, comp.line, comp.column);
    }
    for (const port of Object.values(comp.ports)) {
      checkFluidTable(port.fluid, compId, comp.line, comp.column);
    }

    // M8010: User Fortran routine check
    if (comp.userCode !== undefined || t === "USER_ROUTINE") {
      const code = comp.userCode ?? "";
      if (!code.trim()) {
        diags.push({
          ...RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR,
          message: RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR.message(
            compId,
            "missing SUBROUTINE body in USER_ROUTINE block",
          ),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      } else {
        const lines = code.split(/\r?\n/);
        let hasSubroutine = false;
        let hasEnd = false;
        for (const raw of lines) {
          const trimmed = raw.trim().toUpperCase();
          if (!trimmed || trimmed.startsWith("C ") || trimmed.startsWith("!")) continue;
          if (trimmed.startsWith("SUBROUTINE ")) hasSubroutine = true;
          if (trimmed === "END" || trimmed.startsWith("END SUBROUTINE")) hasEnd = true;
          let depth = 0;
          for (const ch of trimmed) {
            if (ch === "(") depth++;
            if (ch === ")") depth--;
          }
          if (depth !== 0) {
            diags.push({
              ...RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR,
              message: RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR.message(
                compId,
                "unbalanced parentheses in Fortran expression",
              ),
              componentId: compId,
              line: comp.line,
              column: comp.column,
              startOffset: comp.startOffset,
              endOffset: comp.endOffset,
            });
          }
        }
        if (!hasSubroutine) {
          diags.push({
            ...RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR,
            message: RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR.message(
              compId,
              "missing SUBROUTINE header declaration",
            ),
            componentId: compId,
            line: comp.line,
            column: comp.column,
            startOffset: comp.startOffset,
            endOffset: comp.endOffset,
          });
        }
        if (!hasEnd) {
          diags.push({
            ...RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR,
            message: RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR.message(compId, "missing END statement"),
            componentId: compId,
            line: comp.line,
            column: comp.column,
            startOffset: comp.startOffset,
            endOffset: comp.endOffset,
          });
        }
      }
    }

    // Valve checks
    if (t === "VALVE" || t === "ORIFICE") {
      const pos = comp.parameters["POSITION"] ?? comp.parameters["X"] ?? 1.0;
      if (typeof pos === "number" && (pos < 0.0 || pos > 1.0)) {
        diags.push({
          ...RocetsErrorCode.INVALID_VALVE_SCHEDULE,
          message: RocetsErrorCode.INVALID_VALVE_SCHEDULE.message(
            compId,
            `position ${pos} is outside allowable [0.0, 1.0] stroke range`,
          ),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    }

    // Pump checks: M8005 (cavitation risk) & M8014 (closed flow circuit)
    if (t === "PUMP") {
      const npshMargin = comp.parameters["NPSH_MARGIN"];
      const pIn =
        (typeof comp.parameters["P_IN"] === "number" ? comp.parameters["P_IN"] : undefined) ??
        (typeof comp.parameters["IN_P"] === "number" ? comp.parameters["IN_P"] : undefined) ??
        comp.ports["IN_P"]?.pressurePa;
      const pVap = typeof comp.parameters["P_VAP"] === "number" ? comp.parameters["P_VAP"] : 1.0e5;
      const npshReq = typeof comp.parameters["NPSH_R"] === "number" ? comp.parameters["NPSH_R"] : 5.0e4;

      if (typeof npshMargin === "number" && npshMargin < 0) {
        diags.push({
          ...RocetsErrorCode.PUMP_CAVITATION_RISK,
          message: RocetsErrorCode.PUMP_CAVITATION_RISK.message(compId, npshMargin / 1000.0),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      } else if (
        typeof pIn === "number" &&
        (comp.parameters["P_IN"] !== undefined ||
          comp.parameters["IN_P"] !== undefined ||
          comp.parameters["P_VAP"] !== undefined ||
          comp.parameters["NPSH_R"] !== undefined) &&
        pIn - pVap - npshReq < 0
      ) {
        const marginKpa = (pIn - pVap - npshReq) / 1000.0;
        diags.push({
          ...RocetsErrorCode.PUMP_CAVITATION_RISK,
          message: RocetsErrorCode.PUMP_CAVITATION_RISK.message(compId, marginKpa),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }

      // M8014: Closed flow circuit from pump discharge
      const targets = compOutgoingTargets.get(compId) ?? [];
      if (targets.length > 0) {
        const allBlocked = targets.every((tId) => {
          const targetComp = model.components.get(tId);
          if (!targetComp) return false;
          const tt = targetComp.type.toUpperCase();
          if (tt !== "VALVE" && tt !== "ORIFICE") return false;
          const pos = targetComp.parameters["POSITION"] ?? targetComp.parameters["X"];
          return typeof pos === "number" && pos === 0.0;
        });
        if (allBlocked) {
          diags.push({
            ...RocetsErrorCode.CLOSED_FLOW_CIRCUIT,
            message: RocetsErrorCode.CLOSED_FLOW_CIRCUIT.message(compId),
            componentId: compId,
            line: comp.line,
            column: comp.column,
            startOffset: comp.startOffset,
            endOffset: comp.endOffset,
          });
        }
      }
    }

    // M8004: Unbalanced flow split at junctions/splitters/components with explicit flow rates
    const mdotInParam = comp.parameters["MDOT_IN"];
    const mdotOutParam = comp.parameters["MDOT_OUT"];
    if (typeof mdotInParam === "number" && typeof mdotOutParam === "number") {
      const diff = Math.abs(mdotInParam - mdotOutParam);
      if (diff > 1e-2) {
        diags.push({
          ...RocetsErrorCode.UNBALANCED_FLOW_SPLIT,
          message: RocetsErrorCode.UNBALANCED_FLOW_SPLIT.message(compId, diff),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    } else if (Array.isArray(comp.parameters["SPLIT_FRACTIONS"])) {
      const fracs = comp.parameters["SPLIT_FRACTIONS"];
      const sum = fracs.reduce((a, b) => a + b, 0);
      const diff = Math.abs(sum - 1.0);
      if (diff > 1e-2) {
        diags.push({
          ...RocetsErrorCode.UNBALANCED_FLOW_SPLIT,
          message: RocetsErrorCode.UNBALANCED_FLOW_SPLIT.message(compId, diff),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    } else if (t === "JUNCTION" || t === "SPLITTER" || t === "MIXER" || t === "TEE") {
      let portInFlow = 0;
      let portOutFlow = 0;
      let hasInFlow = false;
      let hasOutFlow = false;
      for (const p of Object.values(comp.ports)) {
        if (typeof p.massFlowKgS === "number") {
          if (p.direction === "in") {
            portInFlow += p.massFlowKgS;
            hasInFlow = true;
          } else if (p.direction === "out") {
            portOutFlow += p.massFlowKgS;
            hasOutFlow = true;
          }
        }
      }
      if (hasInFlow && hasOutFlow && Math.abs(portInFlow - portOutFlow) > 1e-2) {
        diags.push({
          ...RocetsErrorCode.UNBALANCED_FLOW_SPLIT,
          message: RocetsErrorCode.UNBALANCED_FLOW_SPLIT.message(compId, Math.abs(portInFlow - portOutFlow)),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    }

    // Chamber / Nozzle checks
    if (t === "CHAMBER" || t === "TC" || t === "COMBUSTOR" || t === "NOZZLE") {
      const pc = comp.parameters["PC"] ?? comp.parameters["P_CHAMBER"];
      if (typeof pc === "number" && pc <= 0) {
        diags.push({
          ...RocetsErrorCode.NEGATIVE_CHAMBER_PRESSURE,
          message: RocetsErrorCode.NEGATIVE_CHAMBER_PRESSURE.message(compId, pc),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }

      // M8009: Choked flow inconsistency (PR = Pc / Pa < 1.89)
      const pa =
        (typeof comp.parameters["PA"] === "number" ? comp.parameters["PA"] : undefined) ??
        (typeof comp.parameters["P_AMB"] === "number" ? comp.parameters["P_AMB"] : undefined) ??
        (typeof comp.parameters["P_EXIT"] === "number" ? comp.parameters["P_EXIT"] : undefined) ??
        101325.0;
      if (typeof pc === "number" && pc > 0 && pa > 0 && pc / pa < 1.89) {
        diags.push({
          ...RocetsErrorCode.CHOKED_FLOW_INCONSISTENCY,
          message: RocetsErrorCode.CHOKED_FLOW_INCONSISTENCY.message(compId, pc / pa),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }

      const mr = comp.parameters["MR"] ?? comp.parameters["OF"] ?? comp.parameters["MIXTURE_RATIO"];
      if (typeof mr === "number" && (mr < 0.3 || mr > 15.0)) {
        diags.push({
          ...RocetsErrorCode.EXTREME_MIXTURE_RATIO,
          message: RocetsErrorCode.EXTREME_MIXTURE_RATIO.message(compId, mr),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }

      const tc = comp.parameters["TEMP_GAS"] ?? comp.parameters["TC"];
      if (typeof tc === "number" && tc > 3800.0) {
        diags.push({
          ...RocetsErrorCode.COMBUSTION_TEMPERATURE_LIMIT,
          message: RocetsErrorCode.COMBUSTION_TEMPERATURE_LIMIT.message(compId, tc, 3800),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    }

    // Shaft checks: M8013 (overspeed) & M8003 (shaft power imbalance)
    if (t === "SHAFT") {
      const rpm = comp.parameters["SPEED_RPM"] ?? comp.parameters["N"] ?? 30000;
      const maxRpm = comp.parameters["MAX_RPM"] ?? 45000;
      if (typeof rpm === "number" && typeof maxRpm === "number" && rpm > maxRpm) {
        diags.push({
          ...RocetsErrorCode.TURBINE_OVERSPEED_HAZARD,
          message: RocetsErrorCode.TURBINE_OVERSPEED_HAZARD.message(compId, rpm, maxRpm),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }

      const pPumpExplicit =
        typeof comp.parameters["P_PUMP"] === "number"
          ? comp.parameters["P_PUMP"]
          : typeof comp.parameters["PUMP_POWER"] === "number"
            ? comp.parameters["PUMP_POWER"]
            : explicitPumpPowerSum;
      const pTurbExplicit =
        typeof comp.parameters["P_TURB"] === "number"
          ? comp.parameters["P_TURB"]
          : typeof comp.parameters["TURBINE_POWER"] === "number"
            ? comp.parameters["TURBINE_POWER"]
            : explicitTurbPowerSum;

      if (pPumpExplicit > 0 && pTurbExplicit > 0) {
        const relDiff = Math.abs(pTurbExplicit - pPumpExplicit) / Math.max(pPumpExplicit, pTurbExplicit);
        if (relDiff > 0.1) {
          diags.push({
            ...RocetsErrorCode.SHAFT_POWER_IMBALANCE,
            message: RocetsErrorCode.SHAFT_POWER_IMBALANCE.message(
              compId,
              `turbine power (${pTurbExplicit} W) does not balance pump power (${pPumpExplicit} W)`,
            ),
            componentId: compId,
            line: comp.line,
            column: comp.column,
            startOffset: comp.startOffset,
            endOffset: comp.endOffset,
          });
        }
      } else if ((pumpCount > 0 && turbineCount === 0) || (turbineCount > 0 && pumpCount === 0)) {
        diags.push({
          ...RocetsErrorCode.SHAFT_POWER_IMBALANCE,
          message: RocetsErrorCode.SHAFT_POWER_IMBALANCE.message(
            compId,
            pumpCount > 0
              ? "pumps present on shaft without any driving turbine"
              : "turbine present on shaft without any driven pump load",
          ),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    }

    // Port connection checks
    for (const [portName, port] of Object.entries(comp.ports)) {
      const portKey = `${compId}.${portName}`;
      if (port.direction === "in" && !incoming.has(portKey)) {
        diags.push({
          ...RocetsErrorCode.UNCONNECTED_FLUID_PORT,
          message: RocetsErrorCode.UNCONNECTED_FLUID_PORT.message(compId, portName),
          componentId: compId,
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
        });
      }
    }
  }

  // 2. Connection checks (Fluid type continuity & M8012 fluid table)
  for (const conn of model.connections) {
    checkFluidTable(conn.fluid, conn.fromComponent, conn.line, conn.column);

    const fromComp = model.components.get(conn.fromComponent);
    const toComp = model.components.get(conn.toComponent);

    if (fromComp && toComp) {
      const fromPort = fromComp.ports[conn.fromPort];
      const toPort = toComp.ports[conn.toPort];

      if (fromPort?.fluid && toPort?.fluid && fromPort.fluid !== toPort.fluid) {
        const toType = toComp.type.toUpperCase();
        // Allowed if target is a combustion element
        const isReactor = toType === "CHAMBER" || toType === "TC" || toType === "GAS_GENERATOR" || toType === "PREBURN";
        if (!isReactor) {
          diags.push({
            ...RocetsErrorCode.FLUID_TYPE_MISMATCH,
            message: RocetsErrorCode.FLUID_TYPE_MISMATCH.message(
              fromPort.fluid,
              toPort.fluid,
              `${conn.fromComponent}.${conn.fromPort} -> ${conn.toComponent}.${conn.toPort}`,
            ),
            line: conn.line,
            column: conn.column,
          });
        }
      }
    }
  }

  return diags;
}
