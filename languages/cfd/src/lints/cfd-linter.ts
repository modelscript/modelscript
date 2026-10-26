// SPDX-License-Identifier: AGPL-3.0-or-later

import { CfdErrorCode } from "../errors.js";
import type { CfdModelData } from "../types.js";

export { CfdErrorCode };

export interface CfdDiagnostic {
  code: number;
  standardCode?: string | undefined;
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
