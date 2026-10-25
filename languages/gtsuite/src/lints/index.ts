// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  GtCylinderComponent,
  GtDiagnostic,
  GtEnvironmentComponent,
  GtInjectorComponent,
  GtIntercoolerComponent,
  GtModel,
  GtPipeComponent,
  GtPlenumComponent,
  GtShaftComponent,
  GtTurboCompressorComponent,
  GtTurboTurbineComponent,
  GtValveComponent,
} from "../types.js";

export const GtSuiteErrorCode = {
  CFL_ACOUSTIC_VIOLATION: {
    code: 9001,
    id: "M9001",
    rule: "cfl-acoustic-violation",
    severity: "warning" as const,
    message: (pipeId: string, dt: number, maxDt: number) =>
      `Pipe '${pipeId}' cell length violates acoustic CFL condition: simulation dt (${(dt * 1e6).toFixed(1)} µs) exceeds stability limit (${(maxDt * 1e6).toFixed(1)} µs).`,
  },
  COMPRESSOR_SURGE_HAZARD: {
    code: 9002,
    id: "M9002",
    rule: "compressor-surge-hazard",
    severity: "warning" as const,
    message: (compId: string, pr: number, flow: number) =>
      `Compressor '${compId}' operating point (PR = ${pr.toFixed(2)}, ṁ = ${flow.toFixed(3)} kg/s) falls into the aerodynamic surge region.`,
  },
  COMPRESSOR_CHOKE_LIMIT: {
    code: 9003,
    id: "M9003",
    rule: "compressor-choke-limit",
    severity: "warning" as const,
    message: (compId: string, flow: number) =>
      `Compressor '${compId}' mass flow (${flow.toFixed(3)} kg/s) exceeds maximum choke/stonewall sonic flow capacity.`,
  },
  VALVE_PROFILE_OVERLAP_ERROR: {
    code: 9004,
    id: "M9004",
    rule: "valve-profile-overlap-error",
    severity: "error" as const,
    message: (valveId: string, reason: string) => `Valve '${valveId}' kinematic profile defect: ${reason}.`,
  },
  COMPRESSION_RATIO_INVALID: {
    code: 9005,
    id: "M9005",
    rule: "compression-ratio-invalid",
    severity: "error" as const,
    message: (cylId: string, cr: number) =>
      `Cylinder '${cylId}' compression ratio (${cr.toFixed(1)}) is physically unrealistic (must be between 6.0 and 26.0).`,
  },
  UNCONNECTED_PLENUM_NODE: {
    code: 9006,
    id: "M9006",
    rule: "unconnected-plenum-node",
    severity: "error" as const,
    message: (plenumId: string) =>
      `Flow split or plenum '${plenumId}' has no connected flow paths or boundary conditions.`,
  },
  DISCHARGE_COEFFICIENT_OUT_OF_BOUNDS: {
    code: 9007,
    id: "M9007",
    rule: "discharge-coefficient-out-of-bounds",
    severity: "warning" as const,
    message: (valveId: string, cd: number) =>
      `Valve or orifice '${valveId}' discharge coefficient (${cd.toFixed(2)}) is non-physical (must satisfy 0.0 < Cd <= 1.0).`,
  },
  KNOCK_MARGIN_DEFICIT: {
    code: 9008,
    id: "M9008",
    rule: "knock-margin-deficit",
    severity: "warning" as const,
    message: (cylId: string, cr: number, anchorDeg: number) =>
      `Cylinder '${cylId}' operates in severe autoignition/knock hazard (CR = ${cr.toFixed(1)}, ignition anchor = ${anchorDeg.toFixed(1)}° CA BTDC).`,
  },
  MISSING_BOUNDARY_PRESSURE: {
    code: 9009,
    id: "M9009",
    rule: "missing-boundary-pressure",
    severity: "error" as const,
    message: (envId: string) => `Environment node '${envId}' has invalid or uninitialized static pressure (<= 0 Pa).`,
  },
  TURBINE_EXPANSION_RATIO_EXCESS: {
    code: 9010,
    id: "M9010",
    rule: "turbine-expansion-ratio-excess",
    severity: "warning" as const,
    message: (turbId: string, er: number) =>
      `Turbine '${turbId}' expansion ratio (${er.toFixed(2)}) exceeds single-stage choked limit (> 4.5).`,
  },
  INTERCOOLER_EFFECTIVENESS_INVALID: {
    code: 9011,
    id: "M9011",
    rule: "intercooler-effectiveness-invalid",
    severity: "warning" as const,
    message: (icId: string, eff: number) =>
      `Intercooler '${icId}' thermal effectiveness (${eff.toFixed(2)}) violates 2nd Law of Thermodynamics (must satisfy 0.0 < eff <= 1.0).`,
  },
  AIR_FUEL_EQUIVALENCE_OUT_OF_BOUNDS: {
    code: 9012,
    id: "M9012",
    rule: "air-fuel-equivalence-out-of-bounds",
    severity: "error" as const,
    message: (lambda: number) =>
      `Air-fuel equivalence ratio lambda (${lambda.toFixed(2)}) is outside combustible flammability limits (0.50 <= lambda <= 2.50).`,
  },
  NEGATIVE_PIPE_DIMENSIONS: {
    code: 9013,
    id: "M9013",
    rule: "negative-pipe-dimensions",
    severity: "error" as const,
    message: (pipeId: string, dim: string, val: number) =>
      `Pipe '${pipeId}' has non-positive ${dim} (${val.toFixed(4)} m).`,
  },
  INJECTOR_TIMING_CONFLICT: {
    code: 9014,
    id: "M9014",
    rule: "injector-timing-conflict",
    severity: "error" as const,
    message: (injId: string, soi: number) =>
      `Injector '${injId}' start of injection (${soi.toFixed(1)}° CA) falls outside valid cycle window (-360° to +720°).`,
  },
  ISOLATED_SHAFT_INERTIA: {
    code: 9015,
    id: "M9015",
    rule: "isolated-shaft-inertia",
    severity: "warning" as const,
    message: (shaftId: string) =>
      `Turbocharger shaft '${shaftId}' has no linked compressor or turbine rotating components.`,
  },
};

/**
 * Executes static analysis and pre-flight diagnostics on a GtModel.
 */
export function lintGtModel(model: GtModel): GtDiagnostic[] {
  const diagnostics: GtDiagnostic[] = [];
  const dt = model.simulationSettings.timeStepSeconds;

  // 1. Global Air-Fuel ratio check (M9012)
  const lambda = model.simulationSettings.airFuelRatioLambda;
  if (lambda < 0.5 || lambda > 2.5) {
    diagnostics.push({
      code: GtSuiteErrorCode.AIR_FUEL_EQUIVALENCE_OUT_OF_BOUNDS.code,
      rule: GtSuiteErrorCode.AIR_FUEL_EQUIVALENCE_OUT_OF_BOUNDS.rule,
      severity: GtSuiteErrorCode.AIR_FUEL_EQUIVALENCE_OUT_OF_BOUNDS.severity,
      message: GtSuiteErrorCode.AIR_FUEL_EQUIVALENCE_OUT_OF_BOUNDS.message(lambda),
    });
  }

  // Build connection graph
  const connectedComponents = new Set<string>();
  for (const conn of model.connections) {
    connectedComponents.add(conn.fromComponent);
    connectedComponents.add(conn.toComponent);
  }

  for (const comp of model.components) {
    // 2. Cylinder checks (M9005, M9008)
    if (comp.kind === "cylinder") {
      const cyl = comp as GtCylinderComponent;
      if (cyl.compressionRatio < 6.0 || cyl.compressionRatio > 26.0) {
        diagnostics.push({
          code: GtSuiteErrorCode.COMPRESSION_RATIO_INVALID.code,
          rule: GtSuiteErrorCode.COMPRESSION_RATIO_INVALID.rule,
          severity: GtSuiteErrorCode.COMPRESSION_RATIO_INVALID.severity,
          message: GtSuiteErrorCode.COMPRESSION_RATIO_INVALID.message(cyl.id, cyl.compressionRatio),
          componentId: cyl.id,
        });
      }

      // Check knock hazard if CR high (> 12) with early spark/anchor (> 25 deg BTDC)
      if (cyl.compressionRatio > 12.0 && cyl.combustionModel.anchorAngleDeg > 25.0) {
        diagnostics.push({
          code: GtSuiteErrorCode.KNOCK_MARGIN_DEFICIT.code,
          rule: GtSuiteErrorCode.KNOCK_MARGIN_DEFICIT.rule,
          severity: GtSuiteErrorCode.KNOCK_MARGIN_DEFICIT.severity,
          message: GtSuiteErrorCode.KNOCK_MARGIN_DEFICIT.message(
            cyl.id,
            cyl.compressionRatio,
            cyl.combustionModel.anchorAngleDeg,
          ),
          componentId: cyl.id,
        });
      }
    }

    // 3. Pipe checks (M9001, M9013)
    if (comp.kind === "pipe" || comp.kind === "intake_runner" || comp.kind === "exhaust_runner") {
      const pipe = comp as GtPipeComponent;
      if (pipe.diameterM <= 0) {
        diagnostics.push({
          code: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.code,
          rule: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.rule,
          severity: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.severity,
          message: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.message(pipe.id, "diameter", pipe.diameterM),
          componentId: pipe.id,
        });
      }
      if (pipe.lengthM <= 0) {
        diagnostics.push({
          code: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.code,
          rule: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.rule,
          severity: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.severity,
          message: GtSuiteErrorCode.NEGATIVE_PIPE_DIMENSIONS.message(pipe.id, "length", pipe.lengthM),
          componentId: pipe.id,
        });
      }

      // Acoustic CFL: c ~= 350 m/s for intake, 600 m/s for exhaust
      const numCells = pipe.numCells ?? 10;
      const dx = pipe.lengthM / Math.max(1, numCells);
      const c = comp.kind === "exhaust_runner" ? 650.0 : 360.0;
      const maxDt = dx / c;
      if (dt > maxDt * 1.5) {
        diagnostics.push({
          code: GtSuiteErrorCode.CFL_ACOUSTIC_VIOLATION.code,
          rule: GtSuiteErrorCode.CFL_ACOUSTIC_VIOLATION.rule,
          severity: GtSuiteErrorCode.CFL_ACOUSTIC_VIOLATION.severity,
          message: GtSuiteErrorCode.CFL_ACOUSTIC_VIOLATION.message(pipe.id, dt, maxDt),
          componentId: pipe.id,
        });
      }
    }

    // 4. Plenum checks (M9006)
    if (comp.kind === "plenum" || comp.kind === "flow_split") {
      const plenum = comp as GtPlenumComponent;
      if (!connectedComponents.has(plenum.id)) {
        diagnostics.push({
          code: GtSuiteErrorCode.UNCONNECTED_PLENUM_NODE.code,
          rule: GtSuiteErrorCode.UNCONNECTED_PLENUM_NODE.rule,
          severity: GtSuiteErrorCode.UNCONNECTED_PLENUM_NODE.severity,
          message: GtSuiteErrorCode.UNCONNECTED_PLENUM_NODE.message(plenum.id),
          componentId: plenum.id,
        });
      }
    }

    // 5. Valve checks (M9004, M9007)
    if (comp.kind === "valve") {
      const valve = comp as GtValveComponent;
      if (valve.dischargeCoefficient <= 0.0 || valve.dischargeCoefficient > 1.0) {
        diagnostics.push({
          code: GtSuiteErrorCode.DISCHARGE_COEFFICIENT_OUT_OF_BOUNDS.code,
          rule: GtSuiteErrorCode.DISCHARGE_COEFFICIENT_OUT_OF_BOUNDS.rule,
          severity: GtSuiteErrorCode.DISCHARGE_COEFFICIENT_OUT_OF_BOUNDS.severity,
          message: GtSuiteErrorCode.DISCHARGE_COEFFICIENT_OUT_OF_BOUNDS.message(valve.id, valve.dischargeCoefficient),
          componentId: valve.id,
        });
      }
      if (valve.lashClearanceM < 0.0) {
        diagnostics.push({
          code: GtSuiteErrorCode.VALVE_PROFILE_OVERLAP_ERROR.code,
          rule: GtSuiteErrorCode.VALVE_PROFILE_OVERLAP_ERROR.rule,
          severity: GtSuiteErrorCode.VALVE_PROFILE_OVERLAP_ERROR.severity,
          message: GtSuiteErrorCode.VALVE_PROFILE_OVERLAP_ERROR.message(
            valve.id,
            `negative lash clearance (${(valve.lashClearanceM * 1e3).toFixed(2)} mm)`,
          ),
          componentId: valve.id,
        });
      }
    }

    // 6. Turbocharger Compressor checks (M9002, M9003)
    if (comp.kind === "turbo_compressor") {
      const compTurb = comp as GtTurboCompressorComponent;
      if (compTurb.pressureRatio > 2.2 && compTurb.massFlowKgS < 0.03) {
        diagnostics.push({
          code: GtSuiteErrorCode.COMPRESSOR_SURGE_HAZARD.code,
          rule: GtSuiteErrorCode.COMPRESSOR_SURGE_HAZARD.rule,
          severity: GtSuiteErrorCode.COMPRESSOR_SURGE_HAZARD.severity,
          message: GtSuiteErrorCode.COMPRESSOR_SURGE_HAZARD.message(
            compTurb.id,
            compTurb.pressureRatio,
            compTurb.massFlowKgS,
          ),
          componentId: compTurb.id,
        });
      }
      if (compTurb.massFlowKgS > 0.8) {
        diagnostics.push({
          code: GtSuiteErrorCode.COMPRESSOR_CHOKE_LIMIT.code,
          rule: GtSuiteErrorCode.COMPRESSOR_CHOKE_LIMIT.rule,
          severity: GtSuiteErrorCode.COMPRESSOR_CHOKE_LIMIT.severity,
          message: GtSuiteErrorCode.COMPRESSOR_CHOKE_LIMIT.message(compTurb.id, compTurb.massFlowKgS),
          componentId: compTurb.id,
        });
      }
    }

    // 7. Turbocharger Turbine checks (M9010)
    if (comp.kind === "turbo_turbine") {
      const turb = comp as GtTurboTurbineComponent;
      if (turb.expansionRatio > 4.5) {
        diagnostics.push({
          code: GtSuiteErrorCode.TURBINE_EXPANSION_RATIO_EXCESS.code,
          rule: GtSuiteErrorCode.TURBINE_EXPANSION_RATIO_EXCESS.rule,
          severity: GtSuiteErrorCode.TURBINE_EXPANSION_RATIO_EXCESS.severity,
          message: GtSuiteErrorCode.TURBINE_EXPANSION_RATIO_EXCESS.message(turb.id, turb.expansionRatio),
          componentId: turb.id,
        });
      }
    }

    // 8. Intercooler checks (M9011)
    if (comp.kind === "intercooler") {
      const ic = comp as GtIntercoolerComponent;
      if (ic.effectiveness <= 0.0 || ic.effectiveness > 1.0) {
        diagnostics.push({
          code: GtSuiteErrorCode.INTERCOOLER_EFFECTIVENESS_INVALID.code,
          rule: GtSuiteErrorCode.INTERCOOLER_EFFECTIVENESS_INVALID.rule,
          severity: GtSuiteErrorCode.INTERCOOLER_EFFECTIVENESS_INVALID.severity,
          message: GtSuiteErrorCode.INTERCOOLER_EFFECTIVENESS_INVALID.message(ic.id, ic.effectiveness),
          componentId: ic.id,
        });
      }
    }

    // 9. Environment checks (M9009)
    if (comp.kind === "environment_inlet" || comp.kind === "environment_outlet") {
      const env = comp as GtEnvironmentComponent;
      if (env.pressurePa <= 0) {
        diagnostics.push({
          code: GtSuiteErrorCode.MISSING_BOUNDARY_PRESSURE.code,
          rule: GtSuiteErrorCode.MISSING_BOUNDARY_PRESSURE.rule,
          severity: GtSuiteErrorCode.MISSING_BOUNDARY_PRESSURE.severity,
          message: GtSuiteErrorCode.MISSING_BOUNDARY_PRESSURE.message(env.id),
          componentId: env.id,
        });
      }
    }

    // 10. Injector checks (M9014)
    if (comp.kind === "injector") {
      const inj = comp as GtInjectorComponent;
      if (inj.startOfInjectionDeg < -360.0 || inj.startOfInjectionDeg > 720.0) {
        diagnostics.push({
          code: GtSuiteErrorCode.INJECTOR_TIMING_CONFLICT.code,
          rule: GtSuiteErrorCode.INJECTOR_TIMING_CONFLICT.rule,
          severity: GtSuiteErrorCode.INJECTOR_TIMING_CONFLICT.severity,
          message: GtSuiteErrorCode.INJECTOR_TIMING_CONFLICT.message(inj.id, inj.startOfInjectionDeg),
          componentId: inj.id,
        });
      }
    }

    // 11. Shaft checks (M9015)
    if (comp.kind === "shaft") {
      const shaft = comp as GtShaftComponent;
      const linkedTurbomachinery = model.components.some(
        (c) => (c.kind === "turbo_compressor" || c.kind === "turbo_turbine") && (c as any).shaftId === shaft.id,
      );
      if (!linkedTurbomachinery) {
        diagnostics.push({
          code: GtSuiteErrorCode.ISOLATED_SHAFT_INERTIA.code,
          rule: GtSuiteErrorCode.ISOLATED_SHAFT_INERTIA.rule,
          severity: GtSuiteErrorCode.ISOLATED_SHAFT_INERTIA.severity,
          message: GtSuiteErrorCode.ISOLATED_SHAFT_INERTIA.message(shaft.id),
          componentId: shaft.id,
        });
      }
    }
  }

  return diagnostics;
}
