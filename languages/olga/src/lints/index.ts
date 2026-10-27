// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Pre-Flight Multiphase Flow Assurance Linter.
 *
 * Rules:
 * - M7001: cfl-condition-violation (numerical timestep exceeds convective/acoustic CFL stability limit)
 * - M7002: invalid-pipe-dimensions (diameter <= 0, length <= 0, or roughness < 0)
 * - M7003: missing-boundary-condition (flowpath has no defined inlet source or outlet pressure boundary)
 * - M7004: steep-elevation-warning (pipe inclination exceeds 80 degrees, risking slug/holdup oscillations)
 * - M7005: fully-closed-choke-hazard (choke valve opening is 0 without active bypass)
 * - M7006: severe-slugging-hazard (deep seabed dip followed by steep riser without active control)
 * - M7007: pig-stuck-hazard (pig friction exceeds maximum pipeline driving force)
 * - M7008: pvt-table-missing-or-invalid (fluid table file extension invalid or boundary states out of table grid)
 * - M7009: wax-deposition-risk (operating temperature drops below Wax Appearance Temperature without thermal insulation)
 * - M7010: sand-erosion-or-dropout-hazard (mixture velocity below critical sand deposition or exceeding API RP 14E erosion limits)
 * - M7011: sour-service-metallurgy-violation (NACE MR0175 / ISO 15156 H2S partial pressure limits)
 * - M7012: asphaltene-precipitation-hazard (operating inside Asphaltene Onset Pressure envelope with unstable CII index)
 * - M7013: heatexchanger-parameter-violation (heat exchanger position outside pipeline or unphysical duty/target temperature)
 */

import { parsePvtTable, type PvtTableData } from "../parser/pvt-table-parser.js";
import { evaluateAsphalteneRisk } from "../solver/asphaltene.js";
import { evaluateSourCorrosionIntegrity } from "../solver/sour-corrosion.js";
import type { OlgaModel } from "../types.js";

export interface OlgaDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string | undefined;
}

export function lintOlgaModel(
  model: OlgaModel,
  options?: { pvtTable?: PvtTableData | string | undefined } | undefined,
): OlgaDiagnostic[] {
  const diagnostics: OlgaDiagnostic[] = [];

  for (const flowpath of model.flowpaths) {
    let hasInlet = flowpath.sources.length > 0 || flowpath.ipr != null;
    let hasOutlet = false;

    // Check nodes connected to this flowpath
    for (const node of model.nodes) {
      if (node.flowpath === flowpath.name) {
        if (node.boundaryPosition <= 0.05 || node.type === "TERMINAL" || node.type === "MASS_SOURCE") {
          hasInlet = true;
        }
        if (node.boundaryPosition >= 0.95 || node.type === "PRESSURE" || node.type === "SEPARATOR") {
          hasOutlet = true;
        }
      }
    }

    if (!hasInlet) {
      diagnostics.push({
        code: "M7003",
        rule: "missing-boundary-condition",
        severity: "error",
        message: `Flowpath '${flowpath.name}' is missing an inlet source or terminal boundary condition.`,
        target: flowpath.name,
      });
    }

    if (!hasOutlet) {
      diagnostics.push({
        code: "M7003",
        rule: "missing-boundary-condition",
        severity: "error",
        message: `Flowpath '${flowpath.name}' is missing an outlet pressure/separator boundary condition.`,
        target: flowpath.name,
      });
    }

    for (const pipe of flowpath.pipes) {
      // M7002: Dimension check
      if (pipe.diameter <= 0) {
        diagnostics.push({
          code: "M7002",
          rule: "invalid-pipe-dimensions",
          severity: "error",
          message: `Pipe '${pipe.label}' has non-positive diameter (${pipe.diameter} m).`,
          target: pipe.label,
        });
      }
      if (pipe.length <= 0) {
        diagnostics.push({
          code: "M7002",
          rule: "invalid-pipe-dimensions",
          severity: "error",
          message: `Pipe '${pipe.label}' has non-positive length (${pipe.length} m).`,
          target: pipe.label,
        });
      }
      if (pipe.roughness < 0) {
        diagnostics.push({
          code: "M7002",
          rule: "invalid-pipe-dimensions",
          severity: "error",
          message: `Pipe '${pipe.label}' has negative roughness (${pipe.roughness} m).`,
          target: pipe.label,
        });
      }

      // M7001: CFL stability check
      const nCells = Math.max(1, pipe.discretization);
      const dx = pipe.length / nCells;
      // In multiphase gas-liquid, sound speed c ~ 300 m/s, mixture velocity vm ~ 15 m/s
      const maxCflDt = dx / 315.0;
      if (model.maxDt > maxCflDt * 2.5) {
        diagnostics.push({
          code: "M7001",
          rule: "cfl-condition-violation",
          severity: "warning",
          message: `Pipe '${pipe.label}' spatial step dx=${dx.toFixed(1)}m violates Courant-Friedrichs-Lewy stability (max recommended dt=${maxCflDt.toFixed(3)}s, configured maxDt=${model.maxDt}s).`,
          target: pipe.label,
        });
      }

      // M7004: Steep elevation warning
      const hyp = Math.sqrt(pipe.length * pipe.length + pipe.elevation * pipe.elevation);
      if (hyp > 0) {
        const inclinationDeg = (Math.asin(Math.abs(pipe.elevation) / hyp) * 180.0) / Math.PI;
        if (inclinationDeg > 80.0) {
          diagnostics.push({
            code: "M7004",
            rule: "steep-elevation-warning",
            severity: "info",
            message: `Pipe '${pipe.label}' has steep inclination angle (${inclinationDeg.toFixed(1)} deg); monitor for severe riser slugging.`,
            target: pipe.label,
          });
        }
      }
    }

    // M7005: Fully closed choke check
    for (const valve of flowpath.valves) {
      if (valve.opening <= 0.0) {
        diagnostics.push({
          code: "M7005",
          rule: "fully-closed-choke-hazard",
          severity: "warning",
          message: `Valve '${valve.name}' is fully closed (opening=0.0); flowline shut-in overpressurization possible.`,
          target: valve.name,
        });
      }
    }

    // M7006: Severe slugging vulnerability check (seabed dip followed by riser)
    const hasDownwardDip = flowpath.pipes.some((p) => p.elevation < -150);
    const hasSteepRiser = flowpath.pipes.some((p) => p.elevation > 150);
    const hasActiveControl = flowpath.controllers.length > 0;
    if (hasDownwardDip && hasSteepRiser && !hasActiveControl) {
      diagnostics.push({
        code: "M7006",
        rule: "severe-slugging-hazard",
        severity: "warning",
        message: `Flowpath '${flowpath.name}' features a deep seabed tieback followed by a steep riser without active slug controller; high susceptibility to severe riser-base slugging.`,
        target: flowpath.name,
      });
    }

    // M7007: Pig stuck hazard check
    if (flowpath.pigs) {
      for (const pig of flowpath.pigs) {
        const diam = pig.diameter ?? flowpath.pipes[0]?.diameter ?? 0.3;
        const area = 0.25 * Math.PI * diam * diam;
        const maxDeltaP = 200.0e5; // 200 bar max tieback delivery pressure
        const maxDriveForce = maxDeltaP * area;
        const friction = pig.frictionForce ?? 2500.0;
        if (friction > maxDriveForce) {
          diagnostics.push({
            code: "M7007",
            rule: "pig-stuck-hazard",
            severity: "error",
            message: `Pig '${pig.name}' friction force (${friction} N) exceeds maximum flowline drive capability (${maxDriveForce.toFixed(0)} N); catastrophic stuck pig hazard.`,
            target: pig.name,
          });
        }
      }
    }

    // M7009: Wax deposition risk check
    if (flowpath.waxConfig) {
      const wat = flowpath.waxConfig.cloudPointTemp;
      const ambT = flowpath.heatTransfer?.ambientTemperature ?? 277.15;
      const hasInsulation = (flowpath.heatTransfer?.layers.length ?? 0) > 0;
      if (ambT < wat && !hasInsulation) {
        diagnostics.push({
          code: "M7009",
          rule: "wax-deposition-risk",
          severity: "warning",
          message: `Flowpath '${flowpath.name}' ambient temperature (${(ambT - 273.15).toFixed(1)} C) is below Wax Appearance Temperature (${(wat - 273.15).toFixed(1)} C) without thermal wall insulation; severe wax deposition hazard.`,
          target: flowpath.name,
        });
      }
    }

    // M7010: Sand transport and erosion risk check
    if (flowpath.sandConfig && flowpath.sandConfig.sandMassRate > 0) {
      const d = flowpath.pipes[0]?.diameter ?? 0.25;
      const area = 0.25 * Math.PI * d * d;
      const inletRate = flowpath.sources[0]?.totalMassRate ?? 25.0;
      const approxVm = inletRate / (area * 750.0);
      if (approxVm < 0.6) {
        diagnostics.push({
          code: "M7010",
          rule: "sand-erosion-or-dropout-hazard",
          severity: "warning",
          message: `Flowpath '${flowpath.name}' estimated velocity (${approxVm.toFixed(2)} m/s) is below critical sand transport threshold (~0.7 m/s); sand settling and bed accumulation hazard.`,
          target: flowpath.name,
        });
      } else if (approxVm > 18.0) {
        diagnostics.push({
          code: "M7010",
          rule: "sand-erosion-or-dropout-hazard",
          severity: "warning",
          message: `Flowpath '${flowpath.name}' estimated velocity (${approxVm.toFixed(2)} m/s) exceeds API RP 14E sand erosion threshold; pipe wall erosion risk.`,
          target: flowpath.name,
        });
      }
    }

    // M7011: Sour gas (H2S) and NACE MR0175 / ISO 15156 metallurgy compliance check
    const inletNode = model.nodes.find(
      (n) => n.flowpath === flowpath.name && (n.type === "TERMINAL" || n.type === "MASS_SOURCE"),
    );
    const h2sFrac = inletNode?.h2sMoleFraction ?? flowpath.sources[0]?.h2sMoleFraction ?? 0.0;
    if (h2sFrac > 0.0005) {
      const pPa = inletNode?.pressure ?? 100e5;
      const tK = inletNode?.temperature ?? 330.15;
      const pipe0 = flowpath.pipes[0];
      const sourEval = evaluateSourCorrosionIntegrity({
        operatingPressurePa: pPa,
        operatingTemperatureK: tK,
        h2sMoleFraction: h2sFrac,
        mixtureVelocity: 2.0,
        pipeDiameterM: pipe0?.diameter ?? 0.254,
        nominalWallThicknessMm: 19.1,
        corrosionAllowanceMm: 3.0,
        metallurgy: pipe0?.metallurgy,
        hasCraCladding: pipe0?.cladding != null,
      });

      if (!sourEval.isMetallurgyCompliant) {
        diagnostics.push({
          code: "M7011",
          rule: "sour-service-metallurgy-violation",
          severity: "error",
          message: `Flowpath '${flowpath.name}' operates in NACE MR0175/ISO 15156 ${sourEval.naceRegion} (p_H2S=${sourEval.h2sPartialPressureBar.toFixed(3)} bar, in-situ pH=${sourEval.inSituPh.toFixed(1)}) which exceeds standard linepipe metallurgy limits; ${sourEval.complianceViolations.join("; ")}`,
          target: flowpath.name,
        });
      }
    }

    // M7012: Asphaltene phase stability and AOP precipitation envelope check
    if (flowpath.asphalteneConfig) {
      const inletNode = model.nodes.find(
        (n) => n.flowpath === flowpath.name && (n.type === "TERMINAL" || n.type === "MASS_SOURCE"),
      );
      const pPa = inletNode?.pressure ?? 120e5;
      const tK = inletNode?.temperature ?? 330.15;
      const pipe0 = flowpath.pipes[0];
      const asphRisk = evaluateAsphalteneRisk({
        sara: flowpath.asphalteneConfig.sara,
        operatingPressurePa: pPa,
        operatingTemperatureK: tK,
        bubblePointPressurePa: flowpath.asphalteneConfig.bubblePointPressure ?? pPa * 0.75,
        mixtureVelocity: 1.5,
        pipeDiameter: pipe0?.diameter ?? 0.254,
        exposureTimeHours: flowpath.asphalteneConfig.exposureTimeHours ?? 720,
        existingDepositThicknessM: flowpath.asphalteneConfig.existingDepositThicknessM,
      });

      if (asphRisk.isInPrecipitationEnvelope) {
        diagnostics.push({
          code: "M7012",
          rule: "asphaltene-precipitation-hazard",
          severity: asphRisk.stabilityStatus === "UNSTABLE" ? "error" : "warning",
          message: `Flowpath '${flowpath.name}' operates inside Asphaltene Onset Pressure (AOP) precipitation envelope [${(asphRisk.lowerAopPressurePa / 1e5).toFixed(1)}, ${(asphRisk.upperAopPressurePa / 1e5).toFixed(1)}] bar (CII=${asphRisk.colloidalInstabilityIndex.toFixed(2)}, status=${asphRisk.stabilityStatus}); ${asphRisk.mitigationRecommendation}`,
          target: flowpath.name,
        });
      }
    }

    // M7013: Heat exchanger parameter validation
    if (flowpath.heatExchangers) {
      let totalLength = 0;
      for (const p of flowpath.pipes) totalLength += p.length;

      for (const hex of flowpath.heatExchangers) {
        if (hex.position < 0 || hex.position > totalLength) {
          diagnostics.push({
            code: "M7013",
            rule: "heatexchanger-parameter-violation",
            severity: "error",
            message: `Heat exchanger '${hex.name}' position (${hex.position} m) lies outside flowpath '${flowpath.name}' total length (${totalLength} m).`,
            target: hex.name,
          });
        }
        if (hex.dutyKw !== undefined && !Number.isFinite(hex.dutyKw)) {
          diagnostics.push({
            code: "M7013",
            rule: "heatexchanger-parameter-violation",
            severity: "error",
            message: `Heat exchanger '${hex.name}' has non-finite duty (${hex.dutyKw} kW).`,
            target: hex.name,
          });
        }
        if (hex.targetTemperature !== undefined && (hex.targetTemperature < 100 || hex.targetTemperature > 1000)) {
          diagnostics.push({
            code: "M7013",
            rule: "heatexchanger-parameter-violation",
            severity: "error",
            message: `Heat exchanger '${hex.name}' target temperature (${hex.targetTemperature} K) is outside physical bounds [100, 1000] K.`,
            target: hex.name,
          });
        }
        if (hex.overallUa !== undefined && hex.overallUa <= 0) {
          diagnostics.push({
            code: "M7013",
            rule: "heatexchanger-parameter-violation",
            severity: "error",
            message: `Heat exchanger '${hex.name}' has non-positive overall UA (${hex.overallUa} W/K).`,
            target: hex.name,
          });
        }
      }
    }
  }

  // M7008: Fluid property table validation
  if (model.tableFile != null) {
    const trimmed = model.tableFile.trim();
    if (trimmed.length === 0) {
      diagnostics.push({
        code: "M7008",
        rule: "pvt-table-missing-or-invalid",
        severity: "warning",
        message: "Model declares an empty fluid property table filename.",
      });
    } else if (!/\.(tab|pvt)$/i.test(trimmed)) {
      diagnostics.push({
        code: "M7008",
        rule: "pvt-table-missing-or-invalid",
        severity: "warning",
        message: `Fluid property table file '${trimmed}' has an unsupported file extension; expected .tab or .pvt.`,
        target: trimmed,
      });
    }
  }

  if (options?.pvtTable) {
    const pvt = typeof options.pvtTable === "string" ? parsePvtTable(options.pvtTable) : options.pvtTable;
    const minP = pvt.pressures[0] ?? 0;
    const maxP = pvt.pressures[pvt.pressures.length - 1] ?? 1e8;
    const minT = pvt.temperatures[0] ?? 0;
    const maxT = pvt.temperatures[pvt.temperatures.length - 1] ?? 1000;

    for (const node of model.nodes) {
      if (node.pressure != null) {
        if (node.pressure > maxP * 1.5 || node.pressure < minP * 0.5) {
          diagnostics.push({
            code: "M7008",
            rule: "pvt-table-missing-or-invalid",
            severity: "warning",
            message: `Boundary node '${node.name}' pressure (${(node.pressure / 1e5).toFixed(1)} bar) deviates significantly from PVT table bounds [${(minP / 1e5).toFixed(1)}, ${(maxP / 1e5).toFixed(1)}] bar.`,
            target: node.name,
          });
        }
      }
      if (node.temperature != null) {
        if (node.temperature > maxT + 50 || node.temperature < minT - 50) {
          diagnostics.push({
            code: "M7008",
            rule: "pvt-table-missing-or-invalid",
            severity: "warning",
            message: `Boundary node '${node.name}' temperature (${(node.temperature - 273.15).toFixed(1)} C) deviates significantly from PVT table bounds [${(minT - 273.15).toFixed(1)}, ${(maxT - 273.15).toFixed(1)}] C.`,
            target: node.name,
          });
        }
      }
    }
  }

  return diagnostics;
}

export * from "./quick-fixes.js";
