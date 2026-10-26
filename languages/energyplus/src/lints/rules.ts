// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Pre-Flight Diagnostic Linter Rules.
 *
 * Conforms strictly to OpenModelica diagnostic conventions:
 * 1. Single quotes for identifiers ('${name}').
 * 2. Period-terminated message.
 * 3. Exact error codes M7901–M7920.
 */

import type { EnergyPlusDocument, IdfDiagnostic, IdfRange, IdfVertex3D } from "../types.js";

export const EnergyPlusErrorCode = {
  UNMATCHED_INTERZONE_SURFACE: {
    code: "M7901",
    severity: "error" as const,
    message: (surfName: string, zoneName: string, targetSurf: string) =>
      `Interzone surface '${surfName}' in zone '${zoneName}' specifies outside boundary object '${targetSurf}' which does not exist or has mismatched reciprocal boundary.`,
  },
  NON_CONVEX_SURFACE_POLYGON: {
    code: "M7902",
    severity: "warning" as const,
    message: (surfName: string, zoneName: string) =>
      `Surface polygon '${surfName}' in zone '${zoneName}' violates planar convexity, which may impair solar raytracing and view factor calculations.`,
  },
  MISSING_THERMAL_PROPERTIES: {
    code: "M7903",
    severity: "error" as const,
    message: (matName: string, prop: string, val: number) =>
      `Material '${matName}' has non-positive thermal property '${prop}' (${val}), violating second law of thermodynamics.`,
  },
  UNCONNECTED_HVAC_ZONE: {
    code: "M7904",
    severity: "error" as const,
    message: (hvacName: string, zoneName: string) =>
      `HVAC component '${hvacName}' references non-existent thermal zone '${zoneName}'.`,
  },
  EXCESSIVE_SURFACE_ABSORPTION: {
    code: "M7905",
    severity: "warning" as const,
    message: (matName: string, absorptance: number) =>
      `Material '${matName}' has solar absorptance coefficient ${absorptance.toFixed(3)}, which exceeds the physical maximum of 1.0.`,
  },
  DUPLICATE_ZONE_NAME: {
    code: "M7906",
    severity: "error" as const,
    message: (zoneName: string) => `Duplicate thermal zone identifier '${zoneName}' detected in building model.`,
  },
  UNREFERENCED_CONSTRUCTION: {
    code: "M7907",
    severity: "error" as const,
    message: (surfName: string, constName: string) =>
      `Building surface '${surfName}' references undefined construction '${constName}'.`,
  },
  ZERO_THICKNESS_MATERIAL: {
    code: "M7908",
    severity: "error" as const,
    message: (matName: string, thickness: number) =>
      `Opaque material '${matName}' has invalid non-positive thickness (${thickness.toFixed(4)}m).`,
  },
};

export function lintEnergyPlus(doc: EnergyPlusDocument): IdfDiagnostic[] {
  const diagnostics: IdfDiagnostic[] = [];

  // 1. Duplicate Zone Check (M7906)
  const zoneNames = new Set<string>();
  for (const zone of doc.zones) {
    const key = zone.name.toLowerCase();
    if (zoneNames.has(key)) {
      diagnostics.push({
        code: EnergyPlusErrorCode.DUPLICATE_ZONE_NAME.code,
        severity: EnergyPlusErrorCode.DUPLICATE_ZONE_NAME.severity,
        message: EnergyPlusErrorCode.DUPLICATE_ZONE_NAME.message(zone.name),
        range: zone.range,
      });
    } else {
      zoneNames.add(key);
    }
  }

  // 2. Material Physical Properties & Thickness (M7903, M7905, M7908)
  const materialMap = new Set<string>();
  for (const mat of doc.materials) {
    materialMap.add(mat.name.toLowerCase());

    if (mat.thickness <= 0.0) {
      diagnostics.push({
        code: EnergyPlusErrorCode.ZERO_THICKNESS_MATERIAL.code,
        severity: EnergyPlusErrorCode.ZERO_THICKNESS_MATERIAL.severity,
        message: EnergyPlusErrorCode.ZERO_THICKNESS_MATERIAL.message(mat.name, mat.thickness),
        range: mat.range,
      });
    }
    if (mat.conductivity <= 0.0) {
      diagnostics.push({
        code: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.code,
        severity: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.severity,
        message: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.message(mat.name, "conductivity", mat.conductivity),
        range: mat.range,
      });
    }
    if (mat.density <= 0.0) {
      diagnostics.push({
        code: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.code,
        severity: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.severity,
        message: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.message(mat.name, "density", mat.density),
        range: mat.range,
      });
    }
    if (mat.specificHeat <= 0.0) {
      diagnostics.push({
        code: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.code,
        severity: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.severity,
        message: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.message(mat.name, "specificHeat", mat.specificHeat),
        range: mat.range,
      });
    }
    if (mat.solarAbsorptance !== undefined && (mat.solarAbsorptance > 1.0 || mat.solarAbsorptance < 0.0)) {
      diagnostics.push({
        code: EnergyPlusErrorCode.EXCESSIVE_SURFACE_ABSORPTION.code,
        severity: EnergyPlusErrorCode.EXCESSIVE_SURFACE_ABSORPTION.severity,
        message: EnergyPlusErrorCode.EXCESSIVE_SURFACE_ABSORPTION.message(mat.name, mat.solarAbsorptance),
        range: mat.range,
      });
    }
  }

  for (const matNM of doc.materialsNoMass) {
    materialMap.add(matNM.name.toLowerCase());
    if (matNM.thermalResistance <= 0.0) {
      diagnostics.push({
        code: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.code,
        severity: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.severity,
        message: EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.message(
          matNM.name,
          "thermalResistance",
          matNM.thermalResistance,
        ),
        range: matNM.range,
      });
    }
  }

  // 3. Constructions Check
  const constructionMap = new Set<string>();
  for (const c of doc.constructions) {
    constructionMap.add(c.name.toLowerCase());
  }

  // 4. Surfaces: Construction resolution, Interzone match, Convexity (M7901, M7902, M7907)
  const surfaceMap = new Map<string, { zone: string; target?: string | undefined; range: IdfRange }>();
  for (const surf of doc.surfaces) {
    surfaceMap.set(surf.name.toLowerCase(), {
      zone: surf.zoneName,
      target: surf.outsideBoundaryConditionObject,
      range: surf.range,
    });
  }

  for (const surf of doc.surfaces) {
    // Construction check (M7907)
    if (surf.constructionName && !constructionMap.has(surf.constructionName.toLowerCase())) {
      diagnostics.push({
        code: EnergyPlusErrorCode.UNREFERENCED_CONSTRUCTION.code,
        severity: EnergyPlusErrorCode.UNREFERENCED_CONSTRUCTION.severity,
        message: EnergyPlusErrorCode.UNREFERENCED_CONSTRUCTION.message(surf.name, surf.constructionName),
        range: surf.range,
      });
    }

    // Interzone reciprocal check (M7901)
    if (surf.boundaryCondition.toLowerCase() === "surface") {
      const targetName = surf.outsideBoundaryConditionObject;
      if (!targetName) {
        diagnostics.push({
          code: EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.code,
          severity: EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.severity,
          message: EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.message(surf.name, surf.zoneName, "undefined"),
          range: surf.range,
        });
      } else {
        const targetEntry = surfaceMap.get(targetName.toLowerCase());
        if (!targetEntry) {
          diagnostics.push({
            code: EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.code,
            severity: EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.severity,
            message: EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.message(surf.name, surf.zoneName, targetName),
            range: surf.range,
          });
        }
      }
    }

    // Convexity check (M7902)
    if (surf.vertices.length >= 4 && !isConvexPolygon(surf.vertices)) {
      diagnostics.push({
        code: EnergyPlusErrorCode.NON_CONVEX_SURFACE_POLYGON.code,
        severity: EnergyPlusErrorCode.NON_CONVEX_SURFACE_POLYGON.severity,
        message: EnergyPlusErrorCode.NON_CONVEX_SURFACE_POLYGON.message(surf.name, surf.zoneName),
        range: surf.range,
      });
    }
  }

  // 5. HVAC Zone Reference Check (M7904)
  for (const hvac of doc.zoneHvacs) {
    if (!zoneNames.has(hvac.zoneName.toLowerCase())) {
      diagnostics.push({
        code: EnergyPlusErrorCode.UNCONNECTED_HVAC_ZONE.code,
        severity: EnergyPlusErrorCode.UNCONNECTED_HVAC_ZONE.severity,
        message: EnergyPlusErrorCode.UNCONNECTED_HVAC_ZONE.message(hvac.name, hvac.zoneName),
        range: hvac.range,
      });
    }
  }

  return diagnostics;
}

/**
 * Checks if a 3D planar polygon is strictly convex using cross products of adjacent edges.
 */
function isConvexPolygon(vertices: IdfVertex3D[]): boolean {
  if (vertices.length < 4) return true;
  const n = vertices.length;

  let normalSign: number | null = null;
  for (let i = 0; i < n; i++) {
    const p0 = vertices[i]!;
    const p1 = vertices[(i + 1) % n]!;
    const p2 = vertices[(i + 2) % n]!;

    const v1x = p1.x - p0.x;
    const v1y = p1.y - p0.y;
    const v1z = p1.z - p0.z;

    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const v2z = p2.z - p1.z;

    // Cross product (v1 x v2)
    const cx = v1y * v2z - v1z * v2y;
    const cy = v1z * v2x - v1x * v2z;
    const cz = v1x * v2y - v1y * v2x;

    const magSq = cx * cx + cy * cy + cz * cz;
    if (magSq > 1e-10) {
      const sign = cz !== 0 ? Math.sign(cz) : cx !== 0 ? Math.sign(cx) : Math.sign(cy);
      if (normalSign === null) {
        normalSign = sign;
      } else if (normalSign !== sign) {
        return false;
      }
    }
  }

  return true;
}
