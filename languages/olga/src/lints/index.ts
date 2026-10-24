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
 */

import type { OlgaModel } from "../types.js";

export interface OlgaDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string | undefined;
}

export function lintOlgaModel(model: OlgaModel): OlgaDiagnostic[] {
  const diagnostics: OlgaDiagnostic[] = [];

  for (const flowpath of model.flowpaths) {
    let hasInlet = flowpath.sources.length > 0;
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
  }

  return diagnostics;
}
