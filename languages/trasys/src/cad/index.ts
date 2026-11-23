// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TRASYS surface geometry computations and `@modelscript/cad` assembly lowering.
 */

import {
  assembly,
  box,
  cylinder,
  part,
  polyhedron,
  rotate,
  sphere,
  translate,
  type Assembly,
  type PartEntry,
  type Solid,
  type Vec3,
} from "@modelscript/cad";
import type { TrasysDeck, TrasysSurface, TrasysTransform } from "../types.js";

const DEG2RAD = Math.PI / 180;

export type Vec3Tuple = [number, number, number];

export function vecAdd(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecSub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecScale(a: Vec3Tuple, s: number): Vec3Tuple {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vecDot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vecCross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function vecLen(a: Vec3Tuple): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vecNorm(a: Vec3Tuple): Vec3Tuple {
  const len = vecLen(a);
  if (len <= 1e-15) return [0, 0, 1];
  return [a[0] / len, a[1] / len, a[2] / len];
}

/**
 * Rotates a 3D vector by intrinsic XYZ Euler angles (ROTX, ROTY, ROTZ in degrees).
 */
export function rotatePoint(p: Vec3Tuple, t: TrasysTransform): Vec3Tuple {
  let [x, y, z] = p;
  if (t.rotx !== 0) {
    const rad = t.rotx * DEG2RAD;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const ny = c * y - s * z;
    const nz = s * y + c * z;
    y = ny;
    z = nz;
  }
  if (t.roty !== 0) {
    const rad = t.roty * DEG2RAD;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const nx = c * x + s * z;
    const nz = -s * x + c * z;
    x = nx;
    z = nz;
  }
  if (t.rotz !== 0) {
    const rad = t.rotz * DEG2RAD;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const nx = c * x - s * y;
    const ny = s * x + c * y;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

/**
 * Applies rotation followed by translation (TX, TY, TZ) to a local point.
 */
export function transformPoint(p: Vec3Tuple, t: TrasysTransform): Vec3Tuple {
  const r = rotatePoint(p, t);
  return [r[0] + t.tx, r[1] + t.ty, r[2] + t.tz];
}

/**
 * Computes the exact analytical surface area (m^2) of a TRASYS surface primitive.
 */
export function computeSurfaceArea(surf: TrasysSurface): number {
  switch (surf.kind) {
    case "RECTANGLE": {
      const w = Math.max(0, surf.dims["width"] ?? 0);
      const h = Math.max(0, surf.dims["height"] ?? 0);
      return w * h;
    }
    case "DISK": {
      const r = Math.max(0, surf.dims["radius"] ?? 0);
      const rInner = Math.max(0, surf.dims["innerRadius"] ?? 0);
      return Math.PI * Math.max(0, r * r - rInner * rInner);
    }
    case "CYLINDER": {
      const r = Math.max(0, surf.dims["radius"] ?? 0);
      const len = Math.max(0, surf.dims["length"] ?? surf.dims["height"] ?? 0);
      return 2 * Math.PI * r * len;
    }
    case "CONE": {
      const r1 = Math.max(0, surf.dims["radius"] ?? 0);
      const r2 = Math.max(0, surf.dims["radiusTop"] ?? 0);
      const len = Math.max(0, surf.dims["length"] ?? surf.dims["height"] ?? 0);
      const slant = Math.hypot(r1 - r2, len);
      return Math.PI * (r1 + r2) * slant;
    }
    case "SPHERE": {
      const r = Math.max(0, surf.dims["radius"] ?? 0);
      return 4 * Math.PI * r * r;
    }
    case "PARABOLOID": {
      const r = Math.max(0, surf.dims["radius"] ?? 0);
      const f = Math.max(1e-9, surf.dims["focalLength"] ?? 1);
      return ((8 * Math.PI * f * f) / 3) * (Math.pow(1 + (r * r) / (4 * f * f), 1.5) - 1);
    }
    case "POLYGON": {
      const verts = surf.vertices ?? [];
      if (verts.length < 3) return 0;
      const v0 = verts[0]!;
      let area = 0;
      for (let i = 1; i < verts.length - 1; i++) {
        const e1 = vecSub(verts[i]!, v0);
        const e2 = vecSub(verts[i + 1]!, v0);
        area += 0.5 * vecLen(vecCross(e1, e2));
      }
      return area;
    }
  }
}

/**
 * Computes the world-space centroid of a TRASYS surface.
 */
export function computeSurfaceCentroid(surf: TrasysSurface): Vec3Tuple {
  if (surf.kind === "POLYGON" && surf.vertices && surf.vertices.length > 0) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const v of surf.vertices) {
      sx += v[0];
      sy += v[1];
      sz += v[2];
    }
    const n = surf.vertices.length;
    return transformPoint([sx / n, sy / n, sz / n], surf.transform);
  }
  return [surf.transform.tx, surf.transform.ty, surf.transform.tz];
}

/**
 * Computes the world-space unit active normal vector for planar TRASYS surfaces.
 */
export function computeSurfaceNormal(surf: TrasysSurface): Vec3Tuple {
  let localNormal: Vec3Tuple = [0, 0, 1];
  if (surf.kind === "POLYGON" && surf.vertices && surf.vertices.length >= 3) {
    const e1 = vecSub(surf.vertices[1]!, surf.vertices[0]!);
    const e2 = vecSub(surf.vertices[2]!, surf.vertices[0]!);
    localNormal = vecNorm(vecCross(e1, e2));
  }
  if (surf.active === "BOTTOM") {
    localNormal = vecScale(localNormal, -1);
  }
  return vecNorm(rotatePoint(localNormal, surf.transform));
}

function coatingColor(surf: TrasysSurface): Vec3 {
  const name = (surf.prop.name ?? "").toUpperCase();
  if (name.includes("WHITE") || name.includes("Z93")) return [0.95, 0.95, 0.97];
  if (name.includes("SILVER") || name.includes("OSR")) return [0.82, 0.86, 0.92];
  if (name.includes("GOLD") || name.includes("KAPTON")) return [0.92, 0.75, 0.22];
  if (name.includes("SOLAR")) return [0.12, 0.22, 0.55];
  if (name.includes("BLACK")) return [0.12, 0.12, 0.14];
  // Map alpha_s to grayscale albedo color
  const g = Math.max(0.15, Math.min(0.95, 1.0 - 0.8 * surf.prop.alpha));
  return [g, g, Math.min(1, g + 0.05)];
}

/**
 * Lowers a single TRASYS surface primitive into a `@modelscript/cad` Solid.
 */
export function lowerTrasysSurfaceToSolid(surf: TrasysSurface): Solid {
  const shellThickness = 0.005;
  let solid: Solid;

  switch (surf.kind) {
    case "RECTANGLE": {
      const w = Math.max(1e-4, surf.dims["width"] ?? 1);
      const h = Math.max(1e-4, surf.dims["height"] ?? 1);
      solid = box({ width: w, height: h, depth: shellThickness, name: surf.id });
      break;
    }
    case "DISK": {
      const r = Math.max(1e-4, surf.dims["radius"] ?? 0.5);
      // Cylinder in @modelscript/cad is aligned with Y; rotate 90 deg about X so disk lies in XY plane
      solid = rotate(cylinder({ radius: r, height: shellThickness, name: surf.id }), [1, 0, 0], 90);
      break;
    }
    case "CYLINDER": {
      const r = Math.max(1e-4, surf.dims["radius"] ?? 0.5);
      const len = Math.max(1e-4, surf.dims["length"] ?? surf.dims["height"] ?? 1);
      solid = rotate(cylinder({ radius: r, height: len, name: surf.id }), [1, 0, 0], 90);
      break;
    }
    case "CONE": {
      const r1 = Math.max(1e-4, surf.dims["radius"] ?? 0.5);
      const r2 = Math.max(0, surf.dims["radiusTop"] ?? 0.01);
      const len = Math.max(1e-4, surf.dims["length"] ?? surf.dims["height"] ?? 1);
      solid = rotate(
        cylinder({ radius: Math.max(r1, r2), radiusBottom: r1, radiusTop: r2, height: len, name: surf.id }),
        [1, 0, 0],
        90,
      );
      break;
    }
    case "SPHERE": {
      const r = Math.max(1e-4, surf.dims["radius"] ?? 0.5);
      solid = sphere({ radius: r, name: surf.id });
      break;
    }
    case "PARABOLOID": {
      const r = Math.max(1e-4, surf.dims["radius"] ?? 0.5);
      const f = Math.max(1e-4, surf.dims["focalLength"] ?? 0.5);
      const depth = (r * r) / (4 * f);
      // Approximate paraboloid dish as a tapered frustum shell in CAD
      solid = rotate(
        cylinder({
          radius: r,
          radiusBottom: Math.max(1e-4, r * 0.15),
          radiusTop: r,
          height: Math.max(1e-4, depth),
          name: surf.id,
        }),
        [1, 0, 0],
        90,
      );
      break;
    }
    case "POLYGON": {
      const verts = surf.vertices ?? [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ];
      const n = verts.length;
      const normal = computeSurfaceNormal({ ...surf, transform: { tx: 0, ty: 0, tz: 0, rotx: 0, roty: 0, rotz: 0 } });
      const offset = vecScale(normal, shellThickness);
      const points: Vec3[] = [
        ...verts.map((v): Vec3 => [v[0], v[1], v[2]]),
        ...verts.map((v): Vec3 => [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]]),
      ];
      const bottomFace = Array.from({ length: n }, (_, i) => i);
      const topFace = Array.from({ length: n }, (_, i) => n + i);
      const sideFaces: number[][] = [];
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        sideFaces.push([i, next, n + next, n + i]);
      }
      solid = polyhedron({ points, faces: [bottomFace, topFace, ...sideFaces], name: surf.id });
      break;
    }
  }

  const t = surf.transform;
  if (t.rotx !== 0) solid = rotate(solid, [1, 0, 0], t.rotx);
  if (t.roty !== 0) solid = rotate(solid, [0, 1, 0], t.roty);
  if (t.rotz !== 0) solid = rotate(solid, [0, 0, 1], t.rotz);
  if (t.tx !== 0 || t.ty !== 0 || t.tz !== 0) {
    solid = translate(solid, [t.tx, t.ty, t.tz]);
  }
  return solid;
}

/**
 * Lowers an entire TRASYS surface model into a `@modelscript/cad` Assembly.
 */
export function lowerTrasysToCadAssembly(deck: TrasysDeck): Assembly {
  const parts: PartEntry[] = deck.surfaces.map((surf) => {
    const solid = lowerTrasysSurfaceToSolid(surf);
    const material =
      surf.prop.name ?? `ThermalCoating(a=${surf.prop.alpha.toFixed(2)},e=${surf.prop.epsilon.toFixed(2)})`;
    return part(solid, {
      material,
      color: coatingColor(surf),
    });
  });
  return assembly(deck.name || "TrasysSpacecraft", parts);
}
