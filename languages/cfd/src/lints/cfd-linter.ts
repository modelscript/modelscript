// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CfdModelData } from "../types.js";

export interface CfdDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  quickFix?: {
    title: string;
    action: string;
    replacement?: string;
  };
}

export const CfdErrorCode = {
  CFL_STABILITY_VIOLATION: {
    code: 7301,
    rule: "cfl-stability-violation",
    severity: "warning" as const,
    message: (cfl: number) =>
      `Courant-Friedrichs-Lewy stability number '${cfl}' exceeds recommended maximum limit for explicit scheme.`,
  },
  UNRESOLVED_MESH_FILE: {
    code: 7302,
    rule: "unresolved-mesh-file",
    severity: "error" as const,
    message: (mesh: string) => `Referenced grid mesh file '${mesh}' cannot be located or is invalid.`,
  },
  MISSING_INLET_BOUNDARY: {
    code: 7303,
    rule: "missing-inlet-boundary",
    severity: "warning" as const,
    message: (name: string) => `CFD domain '${name}' lacks a declared inlet boundary condition or stagnation state.`,
  },
  MISSING_OUTLET_BOUNDARY: {
    code: 7304,
    rule: "missing-outlet-boundary",
    severity: "warning" as const,
    message: (name: string) => `CFD domain '${name}' lacks a declared outlet boundary condition or pressure exit.`,
  },
  UNPHYSICAL_FREESTREAM_MACH: {
    code: 7305,
    rule: "unphysical-freestream-mach",
    severity: "error" as const,
    message: (mach: number) => `Freestream Mach number '${mach}' is non-physical or outside valid range [0, 25].`,
  },
  UNPHYSICAL_REYNOLDS_NUMBER: {
    code: 7306,
    rule: "unphysical-reynolds-number",
    severity: "error" as const,
    message: (re: number) => `Freestream Reynolds number '${re}' must be strictly positive.`,
  },
  NEGATIVE_SURFACE_AREA: {
    code: 7307,
    rule: "negative-surface-area",
    severity: "error" as const,
    message: (area: number) => `Aerodynamic reference area '${area}' must be strictly positive.`,
  },
  TURBULENT_VISCOSITY_RATIO: {
    code: 7308,
    rule: "turbulent-viscosity-ratio",
    severity: "warning" as const,
    message: (ratio: number) => `Turbulent eddy viscosity ratio '${ratio}' is non-physical.`,
  },
};

/**
 * Pre-flight static linter for CFD decks.
 */
export function lintCfdModel(model: CfdModelData): CfdDiagnostic[] {
  const diagnostics: CfdDiagnostic[] = [];

  // Check Mach number
  if (model.machNumber !== undefined) {
    if (model.machNumber < 0 || model.machNumber > 25) {
      diagnostics.push({
        code: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.code,
        rule: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.rule,
        severity: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.severity,
        message: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.message(model.machNumber),
        line: 1,
        column: 1,
        quickFix: {
          title: "Reset Mach number to subsonic 0.8",
          action: "set_mach",
          replacement: "MACH_NUMBER= 0.8",
        },
      });
    }
  }

  // Check Reynolds number
  if (model.reynoldsNumber !== undefined && model.reynoldsNumber <= 0) {
    diagnostics.push({
      code: CfdErrorCode.UNPHYSICAL_REYNOLDS_NUMBER.code,
      rule: CfdErrorCode.UNPHYSICAL_REYNOLDS_NUMBER.rule,
      severity: CfdErrorCode.UNPHYSICAL_REYNOLDS_NUMBER.severity,
      message: CfdErrorCode.UNPHYSICAL_REYNOLDS_NUMBER.message(model.reynoldsNumber),
      line: 1,
      column: 1,
    });
  }

  // Check CFL number
  const cflRaw = model.directives.get("CFL_NUMBER") || model.directives.get("cfl");
  if (cflRaw) {
    const cfl = parseFloat(cflRaw);
    if (!isNaN(cfl) && cfl > 50.0) {
      diagnostics.push({
        code: CfdErrorCode.CFL_STABILITY_VIOLATION.code,
        rule: CfdErrorCode.CFL_STABILITY_VIOLATION.rule,
        severity: CfdErrorCode.CFL_STABILITY_VIOLATION.severity,
        message: CfdErrorCode.CFL_STABILITY_VIOLATION.message(cfl),
        line: 1,
        column: 1,
        quickFix: {
          title: "Clamp CFL number to stable limit (1.0)",
          action: "clamp_cfl",
          replacement: "CFL_NUMBER= 1.0",
        },
      });
    }
  }

  // Check mesh file
  if (model.meshFilename !== undefined) {
    const mesh = model.meshFilename.trim();
    if (mesh === "" || mesh.toLowerCase() === "none") {
      diagnostics.push({
        code: CfdErrorCode.UNRESOLVED_MESH_FILE.code,
        rule: CfdErrorCode.UNRESOLVED_MESH_FILE.rule,
        severity: CfdErrorCode.UNRESOLVED_MESH_FILE.severity,
        message: CfdErrorCode.UNRESOLVED_MESH_FILE.message(mesh || "unspecified"),
        line: 1,
        column: 1,
      });
    }
  }

  // Check inlet boundaries
  if (model.inletMarkers.length === 0 && !model.inletMarker && !model.inletVelocity) {
    diagnostics.push({
      code: CfdErrorCode.MISSING_INLET_BOUNDARY.code,
      rule: CfdErrorCode.MISSING_INLET_BOUNDARY.rule,
      severity: CfdErrorCode.MISSING_INLET_BOUNDARY.severity,
      message: CfdErrorCode.MISSING_INLET_BOUNDARY.message(model.mathProblem || "FlowDomain"),
      line: 1,
      column: 1,
    });
  }

  // Check outlet boundaries
  if (model.outletMarkers.length === 0 && !model.outletMarker) {
    diagnostics.push({
      code: CfdErrorCode.MISSING_OUTLET_BOUNDARY.code,
      rule: CfdErrorCode.MISSING_OUTLET_BOUNDARY.rule,
      severity: CfdErrorCode.MISSING_OUTLET_BOUNDARY.severity,
      message: CfdErrorCode.MISSING_OUTLET_BOUNDARY.message(model.mathProblem || "FlowDomain"),
      line: 1,
      column: 1,
    });
  }

  // Check reference area
  const refAreaRaw = model.directives.get("REF_AREA");
  if (refAreaRaw) {
    const refArea = parseFloat(refAreaRaw);
    if (!isNaN(refArea) && refArea <= 0) {
      diagnostics.push({
        code: CfdErrorCode.NEGATIVE_SURFACE_AREA.code,
        rule: CfdErrorCode.NEGATIVE_SURFACE_AREA.rule,
        severity: CfdErrorCode.NEGATIVE_SURFACE_AREA.severity,
        message: CfdErrorCode.NEGATIVE_SURFACE_AREA.message(refArea),
        line: 1,
        column: 1,
      });
    }
  }

  // Check turbulent viscosity ratio
  const turbRatioRaw = model.directives.get("VISCOSITY_RATIO");
  if (turbRatioRaw) {
    const turbRatio = parseFloat(turbRatioRaw);
    if (!isNaN(turbRatio) && (turbRatio <= 0 || turbRatio > 1e5)) {
      diagnostics.push({
        code: CfdErrorCode.TURBULENT_VISCOSITY_RATIO.code,
        rule: CfdErrorCode.TURBULENT_VISCOSITY_RATIO.rule,
        severity: CfdErrorCode.TURBULENT_VISCOSITY_RATIO.severity,
        message: CfdErrorCode.TURBULENT_VISCOSITY_RATIO.message(turbRatio),
        line: 1,
        column: 1,
      });
    }
  }

  return diagnostics;
}
