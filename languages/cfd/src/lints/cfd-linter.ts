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

  const getLine = (...keys: string[]): number => {
    if (model.directiveLines) {
      for (const k of keys) {
        const ln = model.directiveLines.get(k) ?? model.directiveLines.get(k.toUpperCase());
        if (ln !== undefined) return ln;
      }
    }
    return 1;
  };

  // Check Mach number
  if (model.machNumber !== undefined) {
    if (model.machNumber < 0 || model.machNumber > 25) {
      diagnostics.push({
        code: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.code,
        rule: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.rule,
        severity: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.severity,
        message: CfdErrorCode.UNPHYSICAL_FREESTREAM_MACH.message(model.machNumber),
        line: getLine("MACH_NUMBER"),
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
      line: getLine("REYNOLDS_NUMBER"),
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
        line: getLine("CFL_NUMBER", "cfl"),
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
        line: getLine("MESH_FILENAME"),
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
      line: getLine("MATH_PROBLEM", "PHYSICAL_PROBLEM", "boundaryField"),
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
      line: getLine("MATH_PROBLEM", "PHYSICAL_PROBLEM", "boundaryField"),
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
        line: getLine("REF_AREA"),
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
        line: getLine("VISCOSITY_RATIO"),
        column: 1,
      });
    }
  }

  // M7309: Inverted cell volume check
  const minVolRaw = model.directives.get("MIN_CELL_VOLUME") ?? model.directives.get("minCellVolume");
  const invCellRaw = model.directives.get("INVERTED_CELL_ID") ?? model.directives.get("invertedCellId");
  if (minVolRaw !== undefined || invCellRaw !== undefined) {
    const minVol = minVolRaw !== undefined ? parseFloat(minVolRaw) : -1;
    const cellId = invCellRaw !== undefined ? parseInt(invCellRaw, 10) || 1 : 1;
    if ((!isNaN(minVol) && minVol <= 0) || invCellRaw !== undefined) {
      diagnostics.push({
        code: CfdErrorCode.INVERTED_CELL_VOLUME.code,
        rule: CfdErrorCode.INVERTED_CELL_VOLUME.rule,
        severity: CfdErrorCode.INVERTED_CELL_VOLUME.severity,
        message: CfdErrorCode.INVERTED_CELL_VOLUME.message(cellId),
        line: getLine("MIN_CELL_VOLUME", "INVERTED_CELL_ID", "minCellVolume"),
        column: 1,
      });
    }
  }

  // M7310: Non-conformal periodic interface check
  const periodicRaw = model.directives.get("MARKER_PERIODIC");
  if (periodicRaw) {
    const inner = periodicRaw.replace(/^\s*\(|\)\s*$/g, "");
    const parts = inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const patchA = parts[0] ?? "periodic_1";
    const patchB = parts[1] ?? "periodic_2";
    const nonConformalFlag =
      model.directives.get("PERIODIC_CONFORMAL")?.toUpperCase() === "NO" ||
      model.directives.get("NON_CONFORMAL_PERIODIC")?.toUpperCase() === "YES";
    if (nonConformalFlag || parts.length < 8) {
      diagnostics.push({
        code: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.code,
        rule: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.rule,
        severity: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.severity,
        message: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.message(patchA, patchB),
        line: getLine("MARKER_PERIODIC"),
        column: 1,
      });
    }
  } else {
    const cyclicMarkers = Array.from(model.markers.values()).filter((m) => m.type === "CYCLIC");
    if (cyclicMarkers.length === 1) {
      diagnostics.push({
        code: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.code,
        rule: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.rule,
        severity: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.severity,
        message: CfdErrorCode.NON_CONFORMAL_PERIODIC_INTERFACE.message(cyclicMarkers[0]!.name, "unpaired_cyclic"),
        line: getLine("boundaryField"),
        column: 1,
      });
    }
  }

  // M7311: Boundary layer wall y+ limit check
  const yplusRaw =
    model.directives.get("WALL_YPLUS") ?? model.directives.get("MAX_YPLUS") ?? model.directives.get("YPLUS");
  if (yplusRaw !== undefined) {
    const yplus = parseFloat(yplusRaw);
    if (!isNaN(yplus) && yplus > 5.0) {
      const wallPatch = model.wallMarkers[0] ?? "wall";
      diagnostics.push({
        code: CfdErrorCode.WALL_YPLUS_ASPECT_RATIO.code,
        rule: CfdErrorCode.WALL_YPLUS_ASPECT_RATIO.rule,
        severity: CfdErrorCode.WALL_YPLUS_ASPECT_RATIO.severity,
        message: CfdErrorCode.WALL_YPLUS_ASPECT_RATIO.message(wallPatch, yplus),
        line: getLine("WALL_YPLUS", "MAX_YPLUS", "YPLUS"),
        column: 1,
      });
    }
  }

  // M7312: Net mass flux divergence check
  const inMassRaw = model.directives.get("INLET_MASS_FLOW");
  const outMassRaw = model.directives.get("OUTLET_MASS_FLOW");
  const massImbalanceRaw = model.directives.get("MASS_FLUX_IMBALANCE");
  let hasMassDivergence = false;
  if (inMassRaw !== undefined && outMassRaw !== undefined) {
    const inFlow = parseFloat(inMassRaw);
    const outFlow = parseFloat(outMassRaw);
    if (!isNaN(inFlow) && !isNaN(outFlow) && Math.abs(inFlow - outFlow) > 1e-3) {
      hasMassDivergence = true;
    }
  } else if (massImbalanceRaw !== undefined) {
    const imb = parseFloat(massImbalanceRaw);
    if (!isNaN(imb) && Math.abs(imb) > 1e-3) {
      hasMassDivergence = true;
    }
  }
  if (hasMassDivergence) {
    diagnostics.push({
      code: CfdErrorCode.MASS_FLUX_DIVERGENCE.code,
      rule: CfdErrorCode.MASS_FLUX_DIVERGENCE.rule,
      severity: CfdErrorCode.MASS_FLUX_DIVERGENCE.severity,
      message: CfdErrorCode.MASS_FLUX_DIVERGENCE.message(),
      line: getLine("INLET_MASS_FLOW", "OUTLET_MASS_FLOW", "MASS_FLUX_IMBALANCE"),
      column: 1,
    });
  }

  return diagnostics;
}
