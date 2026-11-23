// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static analysis and diagnostic linter for NASA TRASYS decks (TRA1001–TRA5006).
 */

import { TrasysErrorCode } from "../errors.js";
import type { TrasysDeck, TrasysDiagnostic, TrasysSurface } from "../types.js";

export { TrasysErrorCode };

function checkSurfaceDimensions(surface: TrasysSurface, diagnostics: TrasysDiagnostic[]): void {
  const pushDimError = (dimName: string, value: number) => {
    const spec = TrasysErrorCode.NON_POSITIVE_DIMENSION;
    diagnostics.push({
      code: spec.code,
      id: spec.id,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(surface.id, dimName, value),
      line: surface.line,
      surfaceId: surface.id,
    });
  };

  switch (surface.kind) {
    case "RECTANGLE": {
      const w = surface.dims["width"] ?? surface.dims["xmax"] ?? 0;
      const h = surface.dims["height"] ?? surface.dims["ymax"] ?? 0;
      if (!(w > 0)) pushDimError("width", w);
      if (!(h > 0)) pushDimError("height", h);
      break;
    }
    case "DISK": {
      const r = surface.dims["radius"] ?? surface.dims["rmax"] ?? 0;
      if (!(r > 0)) pushDimError("radius", r);
      const rInner = surface.dims["innerRadius"] ?? surface.dims["rmin"];
      if (rInner !== undefined && (rInner < 0 || rInner >= r)) {
        pushDimError("innerRadius", rInner);
      }
      break;
    }
    case "CYLINDER": {
      const r = surface.dims["radius"] ?? 0;
      const len = surface.dims["length"] ?? surface.dims["height"] ?? 0;
      if (!(r > 0)) pushDimError("radius", r);
      if (!(len > 0)) pushDimError("length", len);
      break;
    }
    case "CONE": {
      const r1 = surface.dims["radius"] ?? surface.dims["r1"] ?? 0;
      const r2 = surface.dims["radiusTop"] ?? surface.dims["r2"] ?? 0;
      const len = surface.dims["length"] ?? surface.dims["height"] ?? 0;
      if (!(r1 > 0 || r2 > 0) || r1 < 0 || r2 < 0) pushDimError("radius", r1);
      if (!(len > 0)) pushDimError("length", len);
      break;
    }
    case "SPHERE": {
      const r = surface.dims["radius"] ?? 0;
      if (!(r > 0)) pushDimError("radius", r);
      break;
    }
    case "PARABOLOID": {
      const r = surface.dims["radius"] ?? 0;
      const f = surface.dims["focalLength"] ?? surface.dims["height"] ?? 0;
      if (!(r > 0)) pushDimError("radius", r);
      if (!(f > 0)) pushDimError("focalLength", f);
      break;
    }
    case "POLYGON": {
      const count = surface.vertices?.length ?? 0;
      if (count < 3) {
        const spec = TrasysErrorCode.INVALID_POLYGON_VERTICES;
        diagnostics.push({
          code: spec.code,
          id: spec.id,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(surface.id, count),
          line: surface.line,
          surfaceId: surface.id,
        });
      }
      break;
    }
  }
}

/**
 * Runs all TRASYS domain lints (TRA1001–TRA5006) on a parsed deck.
 */
export function lintTrasys(deck: TrasysDeck): TrasysDiagnostic[] {
  const diagnostics: TrasysDiagnostic[] = [];

  // TRA1001: Syntax errors recorded by parser
  for (const err of deck.parseErrors) {
    const spec = TrasysErrorCode.SYNTAX_ERROR;
    diagnostics.push({
      code: spec.code,
      id: spec.id,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // TRA1002: Missing END OF DATA
  if (!deck.hasEndOfData) {
    const spec = TrasysErrorCode.MISSING_END_OF_DATA;
    diagnostics.push({
      code: spec.code,
      id: spec.id,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(),
    });
  }

  // Surface checks
  const seenSurfaceIds = new Set<string>();
  const seenNodeIds = new Set<number>();
  let activeCount = 0;

  for (const surf of deck.surfaces) {
    // TRA2001: Duplicate surface ID
    if (seenSurfaceIds.has(surf.id)) {
      const spec = TrasysErrorCode.DUPLICATE_SURFACE_ID;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.id),
        line: surf.line,
        surfaceId: surf.id,
      });
    } else {
      seenSurfaceIds.add(surf.id);
    }

    // TRA2002: Duplicate node ID
    if (surf.nodeId !== undefined) {
      if (seenNodeIds.has(surf.nodeId)) {
        const spec = TrasysErrorCode.DUPLICATE_NODE_ID;
        diagnostics.push({
          code: spec.code,
          id: spec.id,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(surf.nodeId, surf.id),
          line: surf.line,
          surfaceId: surf.id,
        });
      } else {
        seenNodeIds.add(surf.nodeId);
      }
    }

    // TRA3001: Solar absorptance alpha_s in [0, 1]
    if (!Number.isFinite(surf.prop.alpha) || surf.prop.alpha < 0 || surf.prop.alpha > 1) {
      const spec = TrasysErrorCode.INVALID_SOLAR_ABSORPTANCE;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.id, surf.prop.alpha),
        line: surf.line,
        surfaceId: surf.id,
      });
    }

    // TRA3002: IR emissivity epsilon_IR in [0, 1]
    if (!Number.isFinite(surf.prop.epsilon) || surf.prop.epsilon < 0 || surf.prop.epsilon > 1) {
      const spec = TrasysErrorCode.INVALID_IR_EMISSIVITY;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.id, surf.prop.epsilon),
        line: surf.line,
        surfaceId: surf.id,
      });
    }

    // TRA4001 / TRA4002: Geometric dimensions
    checkSurfaceDimensions(surf, diagnostics);

    // TRA5005: Active surface without NODE mapping
    if (surf.active !== "NONE") {
      activeCount++;
      if (surf.nodeId === undefined) {
        const spec = TrasysErrorCode.UNMAPPED_THERMAL_NODE;
        diagnostics.push({
          code: spec.code,
          id: spec.id,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(surf.id),
          line: surf.line,
          surfaceId: surf.id,
        });
      }
    }
  }

  // TRA5006: No active radiative surfaces
  if (activeCount === 0) {
    const spec = TrasysErrorCode.NO_ACTIVE_SURFACES;
    diagnostics.push({
      code: spec.code,
      id: spec.id,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(),
    });
  }

  // Orbit checks (TRA5001–TRA5004)
  if (deck.orbit) {
    const orb = deck.orbit;
    if (!Number.isFinite(orb.altitudeKm) || orb.altitudeKm <= 0) {
      const spec = TrasysErrorCode.INVALID_ORBIT_ALTITUDE;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(orb.altitudeKm),
        line: orb.line,
      });
    }
    if (!Number.isFinite(orb.betaDeg) || orb.betaDeg < -90 || orb.betaDeg > 90) {
      const spec = TrasysErrorCode.INVALID_ORBIT_BETA;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(orb.betaDeg),
        line: orb.line,
      });
    }
    if (!Number.isFinite(orb.albedo) || orb.albedo < 0 || orb.albedo > 1) {
      const spec = TrasysErrorCode.INVALID_ORBIT_ALBEDO;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(orb.albedo),
        line: orb.line,
      });
    }
    if (!Number.isFinite(orb.solarFlux) || orb.solarFlux < 0) {
      const spec = TrasysErrorCode.INVALID_SOLAR_FLUX;
      diagnostics.push({
        code: spec.code,
        id: spec.id,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(orb.solarFlux),
        line: orb.line,
      });
    }
  }

  return diagnostics;
}
