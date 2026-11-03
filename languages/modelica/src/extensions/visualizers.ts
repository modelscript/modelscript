// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Automatic 3D Geometry & Kinematic Binding Extractor for `Modelica.Mechanics.MultiBody.Visualizers`.
 *
 * Inspects a flattened `DAEBuilder` arena and extracts:
 *  1. `Visualizers.Advanced.Shape` (`PartialShape`) — `"box"`, `"sphere"`, `"cylinder"`, `"pipecylinder"`,
 *     `"cone"`, `"pipe"`, `"beam"`, `"gearwheel"`, `"spring"`, and external CAD URIs (`modelica://...`).
 *     Includes all built-in visualizers inside `FixedShape`, `FixedShape2`, `FixedArrow`, `SignalArrow`,
 *     `FixedFrame`, `Ground`, `Advanced.Arrow`, `Advanced.DoubleArrow`, `Internal.Lines`, `Parts.Body`,
 *     `Parts.BodyBox`, `Parts.BodyCylinder`, `Parts.BodyShape`, `Parts.FixedTranslation`, `Joints.*`,
 *     `Forces.Spring`, and `World`.
 *  2. `Visualizers.Advanced.Vector` (`PartialVector`) — `FixedArrow`, `SignalArrow`, `Advanced.Vector`, `Forces.*`.
 *  3. `Visualizers.Advanced.Surface` (`PartialSurface`) — `Torus`, `VoluminousWheel`, `Rectangle`,
 *     `PipeWithScalarField`, `Advanced.PipeWithScalarField`, and `Advanced.Surface`.
 */

import {
  quaternionFromDirections,
  quaternionFromMatrix3x3,
  quaternionMultiply,
  quaternionToEuler,
  rotateVectorByQuaternion,
  type CadDynamicBinding,
  type ComponentDefaultTransform,
  type Quat,
} from "@modelscript/cad";
import { BinOp, EqKind, ExprKind, UnaryOp } from "@modelscript/runtime";

export interface ProceduralMeshPayload {
  vertices: number[];
  normals: number[];
  indices: number[];
  color?: [number, number, number, number] | undefined;
}

export interface ExtractedVisualizerComponent {
  name: string;
  shapeType: string;
  cad: string;
  dynamicBindings: CadDynamicBinding[];
  defaults: ComponentDefaultTransform;
  proceduralMesh?: ProceduralMeshPayload | undefined;
}

// ── Procedural Mesh Generators (Canonical MSL Unit Space) ────────────────────
// In MSL Shape coordinates:
//   +X is along `lengthDirection`, extending from x = 0 to x = 1 (scaled by `length`)
//   +Y is along `widthDirection`, centered at y = 0, extending [-0.5, 0.5] (scaled by `width`)
//   +Z is along `height` direction, centered at z = 0, extending [-0.5, 0.5] (scaled by `height`)

export function createUnitBoxMesh(color?: [number, number, number, number]): ProceduralMeshPayload {
  // Extends x in [0, 1], y in [-0.5, 0.5], z in [-0.5, 0.5]
  const x0 = 0,
    x1 = 1;
  const y0 = -0.5,
    y1 = 0.5;
  const z0 = -0.5,
    z1 = 0.5;

  const vertices = [
    // Front (+Z)
    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,
    // Back (-Z)
    x0,
    y0,
    z0,
    x0,
    y1,
    z0,
    x1,
    y1,
    z0,
    x1,
    y0,
    z0,
    // Top (+Y)
    x0,
    y1,
    z0,
    x0,
    y1,
    z1,
    x1,
    y1,
    z1,
    x1,
    y1,
    z0,
    // Bottom (-Y)
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,
    x1,
    y0,
    z1,
    x0,
    y0,
    z1,
    // Right (+X)
    x1,
    y0,
    z0,
    x1,
    y1,
    z0,
    x1,
    y1,
    z1,
    x1,
    y0,
    z1,
    // Left (-X)
    x0,
    y0,
    z0,
    x0,
    y0,
    z1,
    x0,
    y1,
    z1,
    x0,
    y1,
    z0,
  ];

  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ];

  const indices = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22,
    20, 22, 23,
  ];

  return { vertices, normals, indices, color };
}

export function createUnitSphereMesh(
  segments = 20,
  rings = 16,
  color?: [number, number, number, number],
): ProceduralMeshPayload {
  // In MSL, "sphere" has center at x = 0.5, y = 0, z = 0 and diameters [1, 1, 1] (radii 0.5)
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const nx = cosPhi;
      const ny = sinPhi * Math.cos(theta);
      const nz = sinPhi * Math.sin(theta);

      vertices.push(0.5 + 0.5 * nx, 0.5 * ny, 0.5 * nz);
      normals.push(nx, ny, nz);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const first = r * (segments + 1) + s;
      const second = first + segments + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { vertices, normals, indices, color };
}

export function createUnitCylinderorConeMesh(
  topRatio = 1.0,
  segments = 24,
  color?: [number, number, number, number],
): ProceduralMeshPayload {
  // Extends along +X from x = 0 (radius r0 = 0.5) to x = 1 (radius r1 = 0.5 * topRatio)
  const r0 = 0.5;
  const r1 = 0.5 * Math.max(0, topRatio);
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const dr = r0 - r1;
  const slantLen = Math.hypot(1.0, dr) || 1.0;
  const nxSide = dr / slantLen;
  const nrSide = 1.0 / slantLen;

  // Lateral surface
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // Base ring at x = 0
    vertices.push(0, r0 * c, r0 * s);
    normals.push(nxSide, nrSide * c, nrSide * s);

    // Top ring at x = 1
    vertices.push(1, r1 * c, r1 * s);
    normals.push(nxSide, nrSide * c, nrSide * s);
  }

  for (let i = 0; i < segments; i++) {
    const b1 = i * 2;
    const t1 = b1 + 1;
    const b2 = (i + 1) * 2;
    const t2 = b2 + 1;
    indices.push(b1, b2, t1);
    indices.push(b2, t2, t1);
  }

  // Base cap at x = 0 (normal [-1, 0, 0])
  const baseCenterIdx = vertices.length / 3;
  vertices.push(0, 0, 0);
  normals.push(-1, 0, 0);
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    vertices.push(0, r0 * Math.cos(theta), r0 * Math.sin(theta));
    normals.push(-1, 0, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(baseCenterIdx, baseCenterIdx + 1 + i + 1, baseCenterIdx + 1 + i);
  }

  // Top cap at x = 1 (normal [1, 0, 0]) if r1 > 0
  if (r1 > 1e-6) {
    const topCenterIdx = vertices.length / 3;
    vertices.push(1, 0, 0);
    normals.push(1, 0, 0);
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      vertices.push(1, r1 * Math.cos(theta), r1 * Math.sin(theta));
      normals.push(1, 0, 0);
    }
    for (let i = 0; i < segments; i++) {
      indices.push(topCenterIdx, topCenterIdx + 1 + i, topCenterIdx + 1 + i + 1);
    }
  }

  return { vertices, normals, indices, color };
}

export function createUnitPipeMesh(
  extra = 0.8,
  segments = 24,
  color?: [number, number, number, number],
): ProceduralMeshPayload {
  // Hollow cylinder along +X from x = 0 to x = 1, outer radius ro = 0.5, inner radius ri = 0.5 * clamp(extra, 0, 0.98)
  const ro = 0.5;
  const ratio = Math.max(0, Math.min(0.98, Math.abs(extra)));
  if (ratio <= 1e-4) {
    return createUnitCylinderorConeMesh(1.0, segments, color);
  }
  const ri = ro * ratio;

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // 1. Outer wall
  const outerBase = 0;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    vertices.push(0, ro * c, ro * s);
    normals.push(0, c, s);
    vertices.push(1, ro * c, ro * s);
    normals.push(0, c, s);
  }
  for (let i = 0; i < segments; i++) {
    const b1 = outerBase + i * 2;
    const t1 = b1 + 1;
    const b2 = outerBase + (i + 1) * 2;
    const t2 = b2 + 1;
    indices.push(b1, b2, t1, b2, t2, t1);
  }

  // 2. Inner wall
  const innerBase = vertices.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    vertices.push(0, ri * c, ri * s);
    normals.push(0, -c, -s);
    vertices.push(1, ri * c, ri * s);
    normals.push(0, -c, -s);
  }
  for (let i = 0; i < segments; i++) {
    const b1 = innerBase + i * 2;
    const t1 = b1 + 1;
    const b2 = innerBase + (i + 1) * 2;
    const t2 = b2 + 1;
    indices.push(b1, t1, b2, b2, t1, t2);
  }

  // 3. Annular cap at x = 0 (normal [-1, 0, 0])
  const cap0Base = vertices.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    vertices.push(0, ro * c, ro * s);
    normals.push(-1, 0, 0);
    vertices.push(0, ri * c, ri * s);
    normals.push(-1, 0, 0);
  }
  for (let i = 0; i < segments; i++) {
    const o1 = cap0Base + i * 2;
    const i1 = o1 + 1;
    const o2 = cap0Base + (i + 1) * 2;
    const i2 = o2 + 1;
    indices.push(o1, i1, o2, o2, i1, i2);
  }

  // 4. Annular cap at x = 1 (normal [1, 0, 0])
  const cap1Base = vertices.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    vertices.push(1, ro * c, ro * s);
    normals.push(1, 0, 0);
    vertices.push(1, ri * c, ri * s);
    normals.push(1, 0, 0);
  }
  for (let i = 0; i < segments; i++) {
    const o1 = cap1Base + i * 2;
    const i1 = o1 + 1;
    const o2 = cap1Base + (i + 1) * 2;
    const i2 = o2 + 1;
    indices.push(o1, o2, i1, o2, i2, i1);
  }

  return { vertices, normals, indices, color };
}

export function createUnitBeamMesh(color?: [number, number, number, number]): ProceduralMeshPayload {
  // MSL "beam": stadium cross-section in Y-Z extruded along X in [0, 1]
  // Semicircles at top (+Y) and bottom (-Y), flat sides in Z
  const halfCapSegs = 10;
  const profile: { y: number; z: number; ny: number; nz: number }[] = [];
  const r = 0.5;
  const flatHalfY = 0.25;

  // Top semicircle (centered at y = +flatHalfY, radius r_cap = 0.25 in Y, 0.5 in Z)
  for (let i = 0; i <= halfCapSegs; i++) {
    const a = (i / halfCapSegs) * Math.PI;
    const nz = Math.cos(a);
    const ny = Math.sin(a);
    profile.push({
      y: flatHalfY + (0.5 - flatHalfY) * ny,
      z: r * nz,
      ny,
      nz,
    });
  }
  // Bottom semicircle
  for (let i = 0; i <= halfCapSegs; i++) {
    const a = Math.PI + (i / halfCapSegs) * Math.PI;
    const nz = Math.cos(a);
    const ny = Math.sin(a);
    profile.push({
      y: -flatHalfY + (0.5 - flatHalfY) * ny,
      z: r * nz,
      ny,
      nz,
    });
  }

  // Close loop
  profile.push(profile[0]!);

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const n = profile.length - 1;

  for (let i = 0; i <= n; i++) {
    const p = profile[i]!;
    vertices.push(0, p.y, p.z);
    normals.push(0, p.ny, p.nz);
    vertices.push(1, p.y, p.z);
    normals.push(0, p.ny, p.nz);
  }

  for (let i = 0; i < n; i++) {
    const b1 = i * 2;
    const t1 = b1 + 1;
    const b2 = (i + 1) * 2;
    const t2 = b2 + 1;
    indices.push(b1, b2, t1, b2, t2, t1);
  }

  // Caps at x = 0 and x = 1
  const c0 = vertices.length / 3;
  vertices.push(0, 0, 0);
  normals.push(-1, 0, 0);
  for (let i = 0; i <= n; i++) {
    const p = profile[i]!;
    vertices.push(0, p.y, p.z);
    normals.push(-1, 0, 0);
  }
  for (let i = 0; i < n; i++) {
    indices.push(c0, c0 + 1 + i + 1, c0 + 1 + i);
  }

  const c1 = vertices.length / 3;
  vertices.push(1, 0, 0);
  normals.push(1, 0, 0);
  for (let i = 0; i <= n; i++) {
    const p = profile[i]!;
    vertices.push(1, p.y, p.z);
    normals.push(1, 0, 0);
  }
  for (let i = 0; i < n; i++) {
    indices.push(c1, c1 + 1 + i, c1 + 1 + i + 1);
  }

  return { vertices, normals, indices, color };
}

export function createUnitGearwheelMesh(extra = 12, color?: [number, number, number, number]): ProceduralMeshPayload {
  const nTeeth = Math.max(4, Math.min(64, Math.round(Math.abs(extra) || 12)));
  const rTip = 0.5;
  const rRoot = 0.4;
  const ptsPerTooth = 4;
  const totalPts = nTeeth * ptsPerTooth;

  const profile: { y: number; z: number }[] = [];
  for (let t = 0; t < nTeeth; t++) {
    const baseAngle = (t / nTeeth) * Math.PI * 2;
    const pitch = (1 / nTeeth) * Math.PI * 2;
    const angles = [baseAngle, baseAngle + pitch * 0.2, baseAngle + pitch * 0.5, baseAngle + pitch * 0.7];
    const radii = [rRoot, rTip, rTip, rRoot];
    for (let k = 0; k < 4; k++) {
      profile.push({
        y: radii[k]! * Math.cos(angles[k]!),
        z: radii[k]! * Math.sin(angles[k]!),
      });
    }
  }
  profile.push(profile[0]!);

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < totalPts; i++) {
    const p1 = profile[i]!;
    const p2 = profile[i + 1]!;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const len = Math.hypot(dy, dz) || 1;
    const ny = dz / len;
    const nz = -dy / len;

    const base = vertices.length / 3;
    vertices.push(0, p1.y, p1.z, 1, p1.y, p1.z, 1, p2.y, p2.z, 0, p2.y, p2.z);
    normals.push(0, ny, nz, 0, ny, nz, 0, ny, nz, 0, ny, nz);
    indices.push(base, base + 3, base + 1, base + 3, base + 2, base + 1);
  }

  // Front & back faces
  const c0 = vertices.length / 3;
  vertices.push(0, 0, 0);
  normals.push(-1, 0, 0);
  for (let i = 0; i <= totalPts; i++) {
    const p = profile[i]!;
    vertices.push(0, p.y, p.z);
    normals.push(-1, 0, 0);
  }
  for (let i = 0; i < totalPts; i++) {
    indices.push(c0, c0 + 1 + i + 1, c0 + 1 + i);
  }

  const c1 = vertices.length / 3;
  vertices.push(1, 0, 0);
  normals.push(1, 0, 0);
  for (let i = 0; i <= totalPts; i++) {
    const p = profile[i]!;
    vertices.push(1, p.y, p.z);
    normals.push(1, 0, 0);
  }
  for (let i = 0; i < totalPts; i++) {
    indices.push(c1, c1 + 1 + i, c1 + 1 + i + 1);
  }

  return { vertices, normals, indices, color };
}

export function createUnitSpringMesh(
  windings = 6,
  wireRatio = 0.08,
  color?: [number, number, number, number],
): ProceduralMeshPayload {
  // 3D helical coil spring extending x in [0, 1], coil radius = 0.5 in Y-Z plane
  const nCoils = Math.max(1, Math.min(40, Math.abs(windings) || 6));
  const coilRadius = 0.5 - wireRatio;
  const rWire = Math.max(0.02, Math.min(0.2, wireRatio));
  const pathSteps = Math.max(32, Math.round(nCoils * 16));
  const tubeSteps = 8;

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= pathSteps; i++) {
    const u = i / pathSteps;
    const theta = u * nCoils * Math.PI * 2;
    const cx = u;
    const cy = coilRadius * Math.cos(theta);
    const cz = coilRadius * Math.sin(theta);

    // Normal vector pointing radially outward in Y-Z, binormal along X/tangent
    const nrY = Math.cos(theta);
    const nrZ = Math.sin(theta);

    for (let j = 0; j <= tubeSteps; j++) {
      const phi = (j / tubeSteps) * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const nx = sinPhi;
      const ny = cosPhi * nrY;
      const nz = cosPhi * nrZ;

      vertices.push(cx + rWire * nx, cy + rWire * ny, cz + rWire * nz);
      normals.push(nx, ny, nz);
    }
  }

  for (let i = 0; i < pathSteps; i++) {
    for (let j = 0; j < tubeSteps; j++) {
      const a = i * (tubeSteps + 1) + j;
      const b = a + tubeSteps + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return { vertices, normals, indices, color };
}

export function createUnitArrowMesh(
  doubleHeaded = false,
  segments = 16,
  color?: [number, number, number, number],
): ProceduralMeshPayload {
  // Arrow along +X from x = 0 to x = 1.
  // Shaft diameter = 0.5 (radius 0.25), head outer diameter = 1.0 (radius 0.5)
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const addConeOrCyl = (xStart: number, xEnd: number, rStart: number, rEnd: number) => {
    const baseIdx = vertices.length / 3;
    const dx = xEnd - xStart;
    const dr = rStart - rEnd;
    const slant = Math.hypot(dx, dr) || 1;
    const nx = dr / slant;
    const nr = dx / slant;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      vertices.push(xStart, rStart * c, rStart * s);
      normals.push(nx, nr * c, nr * s);
      vertices.push(xEnd, rEnd * c, rEnd * s);
      normals.push(nx, nr * c, nr * s);
    }
    for (let i = 0; i < segments; i++) {
      const b1 = baseIdx + i * 2;
      const t1 = b1 + 1;
      const b2 = baseIdx + (i + 1) * 2;
      const t2 = b2 + 1;
      indices.push(b1, b2, t1, b2, t2, t1);
    }
  };

  if (doubleHeaded) {
    addConeOrCyl(0, 0.65, 0.25, 0.25);
    addConeOrCyl(0.65, 0.825, 0.5, 0.0);
    addConeOrCyl(0.825, 1.0, 0.5, 0.0);
  } else {
    addConeOrCyl(0, 0.75, 0.25, 0.25);
    addConeOrCyl(0.75, 1.0, 0.5, 0.0);
  }

  return { vertices, normals, indices, color };
}

function normalizeRgba(color?: readonly number[]): [number, number, number, number] | undefined {
  if (!color || color.length < 3) return undefined;
  return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color.length >= 4 ? (color[3] ?? 1.0) : 1.0];
}

export function createMslShapeMesh(
  shapeType: string,
  extra = 0,
  color?: readonly number[],
  wireRatio = 0.08,
): ProceduralMeshPayload {
  const rgba = normalizeRgba(color);
  const kind = shapeType.trim().toLowerCase();
  switch (kind) {
    case "box":
      return createUnitBoxMesh(rgba);
    case "sphere":
      return createUnitSphereMesh(20, 16, rgba);
    case "cylinder":
    case "pipecylinder":
      return createUnitCylinderorConeMesh(1.0, 24, rgba);
    case "cone":
      return createUnitCylinderorConeMesh(Math.max(0, Math.min(1, extra)), 24, rgba);
    case "pipe":
      return createUnitPipeMesh(extra, 24, rgba);
    case "beam":
      return createUnitBeamMesh(rgba);
    case "gearwheel":
      return createUnitGearwheelMesh(extra || 12, rgba);
    case "spring":
      return createUnitSpringMesh(extra || 6, wireRatio, rgba);
    case "arrow":
    case "vector":
      return createUnitArrowMesh(false, 16, rgba);
    case "doublearrow":
      return createUnitArrowMesh(true, 16, rgba);
    default:
      return createUnitBoxMesh(rgba);
  }
}

// ── Parametric Surface Mesh Generators (`Visualizers.Advanced.Surface`) ──────

export function createMslGridSurfaceMesh(
  xOrNu: number[][] | number,
  yOrNv: number[][] | number,
  zOrColor?: number[][] | readonly number[],
  color?: readonly number[],
): ProceduralMeshPayload {
  if (typeof xOrNu === "number" && typeof yOrNv === "number") {
    return createMslRectangleSurfaceMesh(
      1.0,
      1.0,
      xOrNu,
      yOrNv,
      Array.isArray(zOrColor) && typeof zOrColor[0] === "number" ? (zOrColor as unknown as readonly number[]) : color,
    );
  }
  const X = xOrNu as number[][];
  const Y = yOrNv as number[][];
  const Z = (zOrColor as number[][]) ?? [];
  const rgba = normalizeRgba(color);
  const nu = X.length;
  const nv = X[0]?.length ?? 0;
  if (nu < 2 || nv < 2) {
    return createUnitBoxMesh(rgba);
  }

  const vertices: number[] = new Array(nu * nv * 3);
  const normals: number[] = new Array(nu * nv * 3).fill(0);
  const indices: number[] = [];

  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const idx = (i * nv + j) * 3;
      vertices[idx] = X[i]?.[j] ?? 0;
      vertices[idx + 1] = Y[i]?.[j] ?? 0;
      vertices[idx + 2] = Z[i]?.[j] ?? 0;
    }
  }

  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = i * nv + j;
      const b = (i + 1) * nv + j;
      const c = (i + 1) * nv + (j + 1);
      const d = i * nv + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // Compute smooth vertex normals
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t]! * 3;
    const ib = indices[t + 1]! * 3;
    const ic = indices[t + 2]! * 3;

    const ax = vertices[ia]!,
      ay = vertices[ia + 1]!,
      az = vertices[ia + 2]!;
    const bx = vertices[ib]!,
      by = vertices[ib + 1]!,
      bz = vertices[ib + 2]!;
    const cx = vertices[ic]!,
      cy = vertices[ic + 1]!,
      cz = vertices[ic + 2]!;

    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    for (const idx of [ia, ib, ic]) {
      normals[idx] = (normals[idx] ?? 0) + nx;
      normals[idx + 1] = (normals[idx + 1] ?? 0) + ny;
      normals[idx + 2] = (normals[idx + 2] ?? 0) + nz;
    }
  }

  for (let k = 0; k < normals.length; k += 3) {
    const len = Math.hypot(normals[k]!, normals[k + 1]!, normals[k + 2]!) || 1;
    normals[k] = normals[k]! / len;
    normals[k + 1] = normals[k + 1]! / len;
    normals[k + 2] = normals[k + 2]! / len;
  }

  return { vertices, normals, indices, color: rgba };
}

export function createMslTorusMesh(
  R = 0.5,
  r = 0.1,
  opening = 0,
  startAngle = -Math.PI,
  stopAngle = Math.PI,
  nu = 32,
  nv = 16,
  color?: readonly number[],
): ProceduralMeshPayload {
  const uSteps = Math.max(4, Math.min(64, Math.round(nu)));
  const vSteps = Math.max(4, Math.min(32, Math.round(nv)));
  const phiStart = -Math.PI + opening;
  const phiStop = Math.PI - opening;

  const X: number[][] = [];
  const Y: number[][] = [];
  const Z: number[][] = [];

  for (let i = 0; i < uSteps; i++) {
    const alpha = startAngle + ((stopAngle - startAngle) * i) / (uSteps - 1);
    const sinA = Math.sin(alpha);
    const cosA = Math.cos(alpha);
    const rowX: number[] = [];
    const rowY: number[] = [];
    const rowZ: number[] = [];

    for (let j = 0; j < vSteps; j++) {
      const beta = phiStart + ((phiStop - phiStart) * j) / (vSteps - 1);
      const cosB = Math.cos(beta);
      const sinB = Math.sin(beta);
      rowX.push((R + r * cosB) * sinA);
      rowY.push(r * sinB);
      rowZ.push((R + r * cosB) * cosA);
    }
    X.push(rowX);
    Y.push(rowY);
    Z.push(rowZ);
  }

  return createMslGridSurfaceMesh(X, Y, Z, color);
}

export function createMslRectangleSurfaceMesh(
  lu = 3,
  lv = 1,
  nu = 4,
  nv = 4,
  color?: readonly number[],
): ProceduralMeshPayload {
  const uSteps = Math.max(2, Math.min(32, Math.round(nu)));
  const vSteps = Math.max(2, Math.min(32, Math.round(nv)));
  const X: number[][] = [];
  const Y: number[][] = [];
  const Z: number[][] = [];

  for (let i = 0; i < uSteps; i++) {
    const u = -1 + (2 * i) / (uSteps - 1);
    const rowX: number[] = [];
    const rowY: number[] = [];
    const rowZ: number[] = [];
    for (let j = 0; j < vSteps; j++) {
      const v = -1 + (2 * j) / (vSteps - 1);
      rowX.push((lu / 2) * u);
      rowY.push((lv / 2) * v);
      rowZ.push(0);
    }
    X.push(rowX);
    Y.push(rowY);
    Z.push(rowZ);
  }

  return createMslGridSurfaceMesh(X, Y, Z, color);
}

export function createMslPipeSurfaceMesh(
  rOuter = 0.1,
  length = 1.0,
  nu = 16,
  nv = 24,
  color?: readonly number[],
): ProceduralMeshPayload {
  const uSteps = Math.max(2, Math.min(48, Math.round(nu)));
  const vSteps = Math.max(6, Math.min(48, Math.round(nv)));
  const X: number[][] = [];
  const Y: number[][] = [];
  const Z: number[][] = [];

  for (let i = 0; i < uSteps; i++) {
    const xsi = i / (uSteps - 1);
    const rowX: number[] = [];
    const rowY: number[] = [];
    const rowZ: number[] = [];
    for (let j = 0; j < vSteps; j++) {
      const beta = (2 * Math.PI * j) / (vSteps - 1);
      rowX.push(length * xsi);
      rowY.push(rOuter * Math.sin(beta));
      rowZ.push(rOuter * Math.cos(beta));
    }
    X.push(rowX);
    Y.push(rowY);
    Z.push(rowZ);
  }

  return createMslGridSurfaceMesh(X, Y, Z, color);
}

// ── Arena Expression & Equation Evaluator ────────────────────────────────────

class ArenaVisualizerInspector {
  public varByName = new Map<string, number>();
  public eqRhsByVar = new Map<string, number>();
  public aliasByVar = new Map<string, string>();

  constructor(public arena: any) {
    const varCount = arena.varCount ?? 0;
    for (let i = 0; i < varCount; i++) {
      if (arena.isVarRemoved?.(i)) continue;
      const name = arena.getVarName(i);
      if (name) {
        this.varByName.set(name, i);
      }
    }

    const eqCount = arena.eqCount ?? 0;
    for (let e = 0; e < eqCount; e++) {
      if (arena.isEqRemoved?.(e)) continue;
      const kind = arena.getEqKind(e);
      if (kind !== EqKind.Simple && kind !== EqKind.InitialSimple && kind !== EqKind.Array) continue;
      const lhs = arena.getEqLhs(e);
      const rhs = arena.getOrigEqRhs ? arena.getOrigEqRhs(e) : arena.getEqRhs(e);
      const lhsName = this.exprToVarName(lhs);
      const rhsName = this.exprToVarName(rhs);

      if (lhsName && rhs >= 0) {
        if (!this.eqRhsByVar.has(lhsName)) {
          this.eqRhsByVar.set(lhsName, rhs);
        }
        if (rhsName && !this.aliasByVar.has(lhsName)) {
          this.aliasByVar.set(lhsName, rhsName);
        }
      }
      if (rhsName && lhs >= 0) {
        if (!this.eqRhsByVar.has(rhsName)) {
          this.eqRhsByVar.set(rhsName, lhs);
        }
        if (lhsName && !this.aliasByVar.has(rhsName)) {
          this.aliasByVar.set(rhsName, lhsName);
        }
      }
    }
  }

  public exprToVarName(exprId: number): string | null {
    if (exprId === undefined || exprId < 0) return null;
    const kind = this.arena.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      return this.arena.interner.resolve(this.arena.getExprData1(exprId)) ?? null;
    }
    if (kind === ExprKind.Subscript) {
      const baseName = this.exprToVarName(this.arena.getExprData1(exprId));
      if (!baseName) return null;
      const subCount = this.arena.getExprRight(exprId);
      const subs: number[] = [];
      if (subCount > 0) {
        const s0 = this.evalExprNum(this.arena.getExprLeft(exprId));
        if (s0 === null) return null;
        subs.push(Math.round(s0));
        for (let i = 1; i < subCount; i++) {
          const si = this.evalExprNum(this.arena.getExprLeft(exprId + i));
          if (si === null) return null;
          subs.push(Math.round(si));
        }
      } else {
        const s0 = this.evalExprNum(this.arena.getExprLeft(exprId));
        if (s0 === null) return null;
        subs.push(Math.round(s0));
      }
      return `${baseName}[${subs.join(",")}]`;
    }
    return null;
  }

  public hasVar(name: string): boolean {
    if (this.varByName.has(name) || this.eqRhsByVar.has(name)) return true;
    const bracketIdx = name.indexOf("[");
    if (bracketIdx > 0) {
      const baseName = name.slice(0, bracketIdx);
      return this.varByName.has(baseName) || this.eqRhsByVar.has(baseName);
    }
    return false;
  }

  public evalVarString(name: string, visited = new Set<string>()): string | null {
    if (visited.has(name)) return null;
    visited.add(name);

    const varIdx = this.varByName.get(name);
    if (varIdx !== undefined) {
      const exprId = this.arena.getVarExpression?.(varIdx);
      if (exprId !== undefined && exprId >= 0) {
        const s = this.evalExprString(exprId, visited);
        if (s !== null) return s;
      }
    }
    const eqRhs = this.eqRhsByVar.get(name);
    if (eqRhs !== undefined && eqRhs >= 0) {
      const s = this.evalExprString(eqRhs, visited);
      if (s !== null) return s;
    }
    return null;
  }

  public evalExprString(exprId: number, visited = new Set<string>()): string | null {
    if (exprId === undefined || exprId < 0) return null;
    const kind = this.arena.getExprKind(exprId);
    if (kind === ExprKind.StringLiteral) {
      const raw = this.arena.interner.resolve(this.arena.getExprData1(exprId));
      if (raw === undefined) return null;
      return raw.replace(/^"(.*)"$/, "$1");
    }
    if (kind === ExprKind.Name) {
      const refName = this.arena.interner.resolve(this.arena.getExprData1(exprId));
      if (refName) return this.evalVarString(refName, visited);
    }
    if (kind === ExprKind.IfElse) {
      const cond = this.evalExprBool(this.arena.getExprData1(exprId), visited);
      if (cond !== null) {
        return this.evalExprString(cond ? this.arena.getExprLeft(exprId) : this.arena.getExprRight(exprId), visited);
      }
    }
    return null;
  }

  public evalVarBool(name: string, fallback = false, visited = new Set<string>()): boolean {
    if (visited.has(name)) return fallback;
    visited.add(name);

    const varIdx = this.varByName.get(name);
    if (varIdx !== undefined) {
      const exprId = this.arena.getVarExpression?.(varIdx);
      if (exprId !== undefined && exprId >= 0) {
        const b = this.evalExprBool(exprId, visited);
        if (b !== null) return b;
      }
      const startVal = this.arena.getVarStartValue?.(varIdx);
      if (startVal !== undefined && startVal !== 0) return true;
    }
    const eqRhs = this.eqRhsByVar.get(name);
    if (eqRhs !== undefined && eqRhs >= 0) {
      const b = this.evalExprBool(eqRhs, visited);
      if (b !== null) return b;
    }
    return fallback;
  }

  public evalExprBool(exprId: number, visited = new Set<string>()): boolean | null {
    if (exprId === undefined || exprId < 0) return null;
    const kind = this.arena.getExprKind(exprId);
    if (kind === ExprKind.BoolLiteral) {
      return this.arena.getExprData1(exprId) !== 0;
    }
    if (kind === ExprKind.IntLiteral) {
      return this.arena.getExprData1(exprId) !== 0;
    }
    if (kind === ExprKind.Unary) {
      const op = this.arena.getExprData1(exprId) as UnaryOp;
      const val = this.evalExprBool(this.arena.getExprLeft(exprId), visited);
      if (val !== null && op === UnaryOp.Not) return !val;
    }
    if (kind === ExprKind.Binary) {
      const op = this.arena.getExprData1(exprId) as BinOp;
      if (op === BinOp.And || op === BinOp.Or) {
        const l = this.evalExprBool(this.arena.getExprLeft(exprId), visited);
        const r = this.evalExprBool(this.arena.getExprRight(exprId), visited);
        if (l !== null && r !== null) return op === BinOp.And ? l && r : l || r;
      }
      const ln = this.evalExprNum(this.arena.getExprLeft(exprId), visited);
      const rn = this.evalExprNum(this.arena.getExprRight(exprId), visited);
      if (ln !== null && rn !== null) {
        switch (op) {
          case BinOp.Eq:
            return ln === rn;
          case BinOp.Neq:
            return ln !== rn;
          case BinOp.Lt:
            return ln < rn;
          case BinOp.Gt:
            return ln > rn;
          case BinOp.Lte:
            return ln <= rn;
          case BinOp.Gte:
            return ln >= rn;
        }
      }
    }
    if (kind === ExprKind.Name) {
      const refName = this.arena.interner.resolve(this.arena.getExprData1(exprId));
      if (refName) return this.evalVarBool(refName, false, visited);
    }
    return null;
  }

  public evalVarNum(name: string, fallback = 0, visited = new Set<string>()): number {
    const val = this.tryEvalVarNum(name, visited);
    return val !== null && Number.isFinite(val) ? val : fallback;
  }

  public tryEvalVarNum(name: string, visited = new Set<string>()): number | null {
    if (visited.has(name)) return null;
    visited.add(name);

    const varIdx = this.varByName.get(name);
    if (varIdx !== undefined) {
      const exprId = this.arena.getVarExpression?.(varIdx);
      if (exprId !== undefined && exprId >= 0) {
        const val = this.evalExprNum(exprId, visited);
        if (val !== null && Number.isFinite(val)) return val;
      }
    }

    const eqRhs = this.eqRhsByVar.get(name);
    if (eqRhs !== undefined && eqRhs >= 0) {
      const val = this.evalExprNum(eqRhs, visited);
      if (val !== null && Number.isFinite(val)) return val;
    }

    // Check unsubscripted array binding if name is e.g. `vis.lengthDirection[1]` or `vis.R_T[1,1]`
    const bracketIdx = name.indexOf("[");
    if (bracketIdx > 0 && name.endsWith("]")) {
      const baseName = name.slice(0, bracketIdx);
      const subStr = name.slice(bracketIdx + 1, -1);
      const subIndices = subStr.split(",").map((s) => parseInt(s.trim(), 10));
      if (subIndices.length >= 1 && subIndices.every((idx) => !isNaN(idx))) {
        const baseIdx = this.varByName.get(baseName);
        let currExpr = baseIdx !== undefined ? this.arena.getVarExpression?.(baseIdx) : undefined;
        if (currExpr === undefined || currExpr < 0) {
          currExpr = this.eqRhsByVar.get(baseName);
        }
        if (currExpr !== undefined && currExpr >= 0) {
          for (const subIdx of subIndices) {
            const nextExpr = this.getArrayElementExpr(currExpr, subIdx - 1);
            if (nextExpr === null) {
              currExpr = undefined;
              break;
            }
            currExpr = nextExpr;
          }
          if (currExpr !== undefined && currExpr >= 0) {
            const val = this.evalExprNum(currExpr, visited);
            if (val !== null && Number.isFinite(val)) return val;
          }
        }
      }
    }

    if (varIdx !== undefined) {
      const startExprId = this.arena.getVarAttrExprId?.(varIdx, "start");
      if (startExprId !== undefined && startExprId >= 0) {
        const val = this.evalExprNum(startExprId, visited);
        if (val !== null && Number.isFinite(val)) return val;
      }
      const startVal = this.arena.getVarStartValue?.(varIdx);
      if (startVal !== undefined && Number.isFinite(startVal)) {
        return startVal;
      }
    }

    return null;
  }

  private getArrayElementExpr(exprId: number, zeroBasedIdx: number): number | null {
    if (exprId < 0 || zeroBasedIdx < 0) return null;
    const kind = this.arena.getExprKind(exprId);
    if (kind === ExprKind.ArrayCtor) {
      const count = this.arena.getExprData1(exprId);
      if (zeroBasedIdx >= count) return null;
      if (zeroBasedIdx === 0) return this.arena.getExprLeft(exprId);
      const redirect = this.arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      return this.arena.getExprLeft(baseId + zeroBasedIdx);
    }
    return null;
  }

  public evalExprNum(exprId: number, visited = new Set<string>()): number | null {
    if (exprId === undefined || exprId < 0) return null;
    const kind = this.arena.getExprKind(exprId);

    switch (kind) {
      case ExprKind.RealLiteral:
        return this.arena.getExprRealValue(exprId);
      case ExprKind.IntLiteral:
      case ExprKind.EnumLiteral:
        return this.arena.getExprData1(exprId);
      case ExprKind.BoolLiteral:
        return this.arena.getExprData1(exprId) !== 0 ? 1 : 0;
      case ExprKind.Negate: {
        const v = this.evalExprNum(this.arena.getExprLeft(exprId), visited);
        return v !== null ? -v : null;
      }
      case ExprKind.Unary: {
        const op = this.arena.getExprData1(exprId) as UnaryOp;
        const v = this.evalExprNum(this.arena.getExprLeft(exprId), visited);
        if (v === null) return null;
        return op === UnaryOp.Negate ? -v : v === 0 ? 1 : 0;
      }
      case ExprKind.Binary: {
        const op = this.arena.getExprData1(exprId) as BinOp;
        const l = this.evalExprNum(this.arena.getExprLeft(exprId), visited);
        const r = this.evalExprNum(this.arena.getExprRight(exprId), visited);
        if (l === null || r === null) return null;
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return l + r;
          case BinOp.Sub:
          case BinOp.ElemSub:
            return l - r;
          case BinOp.Mul:
          case BinOp.ElemMul:
            return l * r;
          case BinOp.Div:
          case BinOp.ElemDiv:
            return r !== 0 ? l / r : 0;
          case BinOp.Pow:
          case BinOp.ElemPow:
            return Math.pow(l, r);
          default:
            return null;
        }
      }
      case ExprKind.IfElse: {
        const cond = this.evalExprBool(this.arena.getExprData1(exprId), visited);
        if (cond !== null) {
          return this.evalExprNum(cond ? this.arena.getExprLeft(exprId) : this.arena.getExprRight(exprId), visited);
        }
        return this.evalExprNum(this.arena.getExprLeft(exprId), visited);
      }
      case ExprKind.Name: {
        const name = this.arena.interner.resolve(this.arena.getExprData1(exprId));
        if (!name) return null;
        if (name === "time") return 0;
        if (name === "Modelica.Constants.pi" || name === "pi") return Math.PI;
        return this.tryEvalVarNum(name, visited);
      }
      case ExprKind.Subscript: {
        const fullName = this.exprToVarName(exprId);
        if (fullName) {
          const direct = this.tryEvalVarNum(fullName, visited);
          if (direct !== null) return direct;
        }
        const baseId = this.arena.getExprData1(exprId);
        const subIdx = this.evalExprNum(this.arena.getExprLeft(exprId), visited);
        if (subIdx !== null) {
          const elemId = this.getArrayElementExpr(baseId, Math.round(subIdx) - 1);
          if (elemId !== null) return this.evalExprNum(elemId, visited);
        }
        return null;
      }
      case ExprKind.Call: {
        const fnName = this.arena.interner.resolve(this.arena.getExprData1(exprId)) ?? "";
        const shortFn = fnName.includes(".") ? fnName.split(".").pop()! : fnName;
        const argCount = this.arena.getExprRight(exprId);
        const args: number[] = [];
        if (argCount > 0) {
          args.push(this.arena.getExprLeft(exprId));
          for (let i = 1; i < argCount; i++) {
            args.push(this.arena.getExprLeft(exprId + i));
          }
        }
        const a0 = args[0] !== undefined ? this.evalExprNum(args[0], visited) : null;
        const a1 = args[1] !== undefined ? this.evalExprNum(args[1], visited) : null;
        switch (shortFn) {
          case "sin":
            return a0 !== null ? Math.sin(a0) : null;
          case "cos":
            return a0 !== null ? Math.cos(a0) : null;
          case "tan":
            return a0 !== null ? Math.tan(a0) : null;
          case "asin":
            return a0 !== null ? Math.asin(Math.max(-1, Math.min(1, a0))) : null;
          case "acos":
            return a0 !== null ? Math.acos(Math.max(-1, Math.min(1, a0))) : null;
          case "atan":
            return a0 !== null ? Math.atan(a0) : null;
          case "atan2":
            return a0 !== null && a1 !== null ? Math.atan2(a0, a1) : null;
          case "sqrt":
            return a0 !== null && a0 >= 0 ? Math.sqrt(a0) : null;
          case "abs":
            return a0 !== null ? Math.abs(a0) : null;
          case "min":
            return a0 !== null && a1 !== null ? Math.min(a0, a1) : a0;
          case "max":
            return a0 !== null && a1 !== null ? Math.max(a0, a1) : a0;
          case "noEvent":
          case "smooth":
          case "homotopy":
            return shortFn === "smooth" ? a1 : a0;
          default:
            return null;
        }
      }
      default:
        return null;
    }
  }

  /**
   * Adds a dynamic binding for `varName` (and its alias target if equated to another variable like `frame_a.r_0[1]`).
   */
  public pushDynamicBinding(
    bindings: CadDynamicBinding[],
    property: CadDynamicBinding["property"],
    index: number,
    varName: string,
    scaleFactor?: number,
  ): void {
    const bracketIdx = varName.indexOf("[");
    const baseName = bracketIdx > 0 ? varName.slice(0, bracketIdx) : null;
    const suffix = bracketIdx > 0 ? varName.slice(bracketIdx) : "";

    if (this.varByName.has(varName) || (baseName && this.varByName.has(baseName))) {
      bindings.push({
        property,
        index,
        variable: varName,
        ...(scaleFactor !== undefined ? { scaleFactor } : {}),
      });
    }
    // If `varName` is equated to another variable (e.g. `vis.r[1] = body.frame_a.r_0[1]`),
    // also bind the alias target so if alias elimination removes `vis.r[1]`, `body.frame_a.r_0[1]` still drives it!
    const alias =
      this.aliasByVar.get(varName) ??
      (baseName && this.aliasByVar.has(baseName) ? `${this.aliasByVar.get(baseName)}${suffix}` : undefined);
    if (alias && alias !== varName && this.hasVar(alias)) {
      bindings.push({
        property,
        index,
        variable: alias,
        ...(scaleFactor !== undefined ? { scaleFactor } : {}),
      });
    }
  }
}

// ── Main Visualizer Extractor ────────────────────────────────────────────────

export function extractArenaVisualizers(arena: any): ExtractedVisualizerComponent[] {
  if (!arena || typeof arena.varCount !== "number") return [];

  const inspector = new ArenaVisualizerInspector(arena);
  const results: ExtractedVisualizerComponent[] = [];
  const seenPrefixes = new Set<string>();

  // 1. Discover all `Visualizers.Advanced.Shape` (`PartialShape`) instances via `<prefix>.shapeType` or `<prefix>.lengthDirection[1]`
  for (const [varName] of inspector.varByName.entries()) {
    let prefix: string | null = null;
    if (varName.endsWith(".shapeType") || varName === "shapeType") {
      prefix = varName === "shapeType" ? "" : varName.slice(0, -".shapeType".length);
    } else if (
      varName.endsWith(".lengthDirection[1]") ||
      varName === "lengthDirection[1]" ||
      varName.endsWith(".lengthDirection") ||
      varName === "lengthDirection"
    ) {
      const suffix = varName.endsWith("[1]") ? "lengthDirection[1]" : "lengthDirection";
      const cand = varName === suffix ? "" : varName.slice(0, -(suffix.length + 1));
      const cp = cand ? `${cand}.` : "";
      if (inspector.hasVar(`${cp}r_shape[1]`) && inspector.hasVar(`${cp}widthDirection[1]`)) {
        prefix = cand;
      }
    }
    if (prefix === null) continue;

    const compName = prefix || "shape";
    if (seenPrefixes.has(compName)) continue;
    seenPrefixes.add(compName);

    const p = prefix ? `${prefix}.` : "";
    const rawShapeType = inspector.evalVarString(`${p}shapeType`) || "box";
    const shapeType = rawShapeType.trim();

    // Evaluate baseline attributes
    const r: [number, number, number] = [
      inspector.evalVarNum(`${p}r[1]`, 0),
      inspector.evalVarNum(`${p}r[2]`, 0),
      inspector.evalVarNum(`${p}r[3]`, 0),
    ];
    const rShape: [number, number, number] = [
      inspector.evalVarNum(`${p}r_shape[1]`, 0),
      inspector.evalVarNum(`${p}r_shape[2]`, 0),
      inspector.evalVarNum(`${p}r_shape[3]`, 0),
    ];
    const lengthDir: [number, number, number] = [
      inspector.evalVarNum(`${p}lengthDirection[1]`, 1),
      inspector.evalVarNum(`${p}lengthDirection[2]`, 0),
      inspector.evalVarNum(`${p}lengthDirection[3]`, 0),
    ];
    const widthDir: [number, number, number] = [
      inspector.evalVarNum(`${p}widthDirection[1]`, 0),
      inspector.evalVarNum(`${p}widthDirection[2]`, 1),
      inspector.evalVarNum(`${p}widthDirection[3]`, 0),
    ];

    const rotMatPrefix = inspector.hasVar(`${p}R.T[1,1]`) ? `${p}R.T` : `${p}R_T`;
    const rMat: number[] = [
      inspector.evalVarNum(`${rotMatPrefix}[1,1]`, 1),
      inspector.evalVarNum(`${rotMatPrefix}[1,2]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[1,3]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[2,1]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[2,2]`, 1),
      inspector.evalVarNum(`${rotMatPrefix}[2,3]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,1]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,2]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,3]`, 1),
    ];

    const length = inspector.evalVarNum(`${p}length`, 0.1);
    const width = inspector.evalVarNum(`${p}width`, 0.1);
    const height = inspector.evalVarNum(`${p}height`, 0.1);
    const extra = inspector.evalVarNum(`${p}extra`, 0);

    const cR = inspector.evalVarNum(`${p}color[1]`, 0);
    const cG = inspector.evalVarNum(`${p}color[2]`, 128);
    const cB = inspector.evalVarNum(`${p}color[3]`, 255);
    const is255 = cR > 1.0 || cG > 1.0 || cB > 1.0;
    const rgb: [number, number, number] = is255
      ? [Math.min(1, Math.max(0, cR / 255)), Math.min(1, Math.max(0, cG / 255)), Math.min(1, Math.max(0, cB / 255))]
      : [Math.min(1, Math.max(0, cR)), Math.min(1, Math.max(0, cG)), Math.min(1, Math.max(0, cB))];
    const rgba: [number, number, number, number] = [rgb[0], rgb[1], rgb[2], 1.0];

    const isSpring = shapeType.toLowerCase() === "spring";
    // For "spring", MSL `width` is coil width/radius and `height` is wire diameter
    const scale: [number, number, number] = isSpring ? [length, width, width] : [length, width, height];
    const wireRatio = isSpring && width > 1e-6 ? Math.max(0.02, Math.min(0.25, height / (2 * width))) : 0.08;

    // Compute initial world position & orientation for static preview (before animation starts)
    const qFrame: Quat = quaternionFromMatrix3x3(rMat, true);
    const qShape: Quat = quaternionFromDirections(lengthDir, widthDir);
    const qWorld: Quat = quaternionMultiply(qFrame, qShape);
    const worldOffset = rotateVectorByQuaternion(rShape, qFrame);
    const worldPos: [number, number, number] = [r[0] + worldOffset[0], r[1] + worldOffset[1], r[2] + worldOffset[2]];
    const worldRotDeg = quaternionToEuler(qWorld, "XYZ", true);

    const dynamicBindings: CadDynamicBinding[] = [];
    for (let k = 0; k < 3; k++) {
      inspector.pushDynamicBinding(dynamicBindings, "position", k, `${p}r[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "shapeOffset", k, `${p}r_shape[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "lengthDirection", k, `${p}lengthDirection[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "widthDirection", k, `${p}widthDirection[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "color", k, `${p}color[${k + 1}]`);
    }
    let rotIdx = 0;
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        inspector.pushDynamicBinding(dynamicBindings, "rotation", rotIdx++, `${rotMatPrefix}[${row},${col}]`);
      }
    }
    inspector.pushDynamicBinding(dynamicBindings, "scale", 0, `${p}length`);
    inspector.pushDynamicBinding(dynamicBindings, "scale", 1, `${p}width`);
    inspector.pushDynamicBinding(dynamicBindings, "scale", 2, isSpring ? `${p}width` : `${p}height`);

    const isExternalUri =
      /^(?:modelica|file|https?):\/\//i.test(shapeType) || /\.(?:stl|obj|glb|gltf|step|stp|dxf)$/i.test(shapeType);
    const uri = isExternalUri ? shapeType : `procedural://msl/${shapeType.toLowerCase()}`;
    const proceduralMesh = isExternalUri ? undefined : createMslShapeMesh(shapeType, extra, rgba, wireRatio);

    const defaults: ComponentDefaultTransform = {
      position: r,
      rotation: worldRotDeg,
      quaternion: qFrame,
      scale,
      shapeOffset: rShape,
      lengthDirection: lengthDir,
      widthDirection: widthDir,
      color: rgb,
    };

    const cadStr =
      `CAD(uri="${uri}", feature="${compName}", ` +
      `position={${worldPos[0]}, ${worldPos[1]}, ${worldPos[2]}}, ` +
      `rotation={${worldRotDeg[0]}, ${worldRotDeg[1]}, ${worldRotDeg[2]}}, ` +
      `scale={${scale[0]}, ${scale[1]}, ${scale[2]}}, ` +
      `dynamicPosition="{${p}r[1], ${p}r[2], ${p}r[3]}", ` +
      `dynamicRotation="${rotMatPrefix}", ` +
      `dynamicScale="{${p}length, ${p}width, ${isSpring ? `${p}width` : `${p}height`}}")`;

    results.push({
      name: compName,
      shapeType,
      cad: cadStr,
      dynamicBindings,
      defaults,
      proceduralMesh,
    });
  }

  // 2. Discover all `Visualizers.Advanced.Vector` (`PartialVector`) instances via `<prefix>.coordinates[1]` or `<prefix>.coordinates`
  for (const [varName] of inspector.varByName.entries()) {
    let prefix: string | null = null;
    if (varName.endsWith(".coordinates[1]") || varName === "coordinates[1]") {
      prefix = varName === "coordinates[1]" ? "" : varName.slice(0, -".coordinates[1]".length);
    } else if (varName.endsWith(".coordinates") || varName === "coordinates") {
      prefix = varName === "coordinates" ? "" : varName.slice(0, -".coordinates".length);
    }
    if (prefix === null) continue;
    const compName = prefix || "vector";
    if (seenPrefixes.has(compName)) continue;

    const p = prefix ? `${prefix}.` : "";
    if (
      !inspector.hasVar(`${p}headAtOrigin`) &&
      !inspector.hasVar(`${p}twoHeadedArrow`) &&
      !inspector.hasVar(`${p}quantity`) &&
      !inspector.hasVar(`${p}r[1]`)
    ) {
      continue;
    }
    seenPrefixes.add(compName);

    const r: [number, number, number] = [
      inspector.evalVarNum(`${p}r[1]`, 0),
      inspector.evalVarNum(`${p}r[2]`, 0),
      inspector.evalVarNum(`${p}r[3]`, 0),
    ];
    const rShape: [number, number, number] = [
      inspector.evalVarNum(`${p}r_shape[1]`, 0),
      inspector.evalVarNum(`${p}r_shape[2]`, 0),
      inspector.evalVarNum(`${p}r_shape[3]`, 0),
    ];
    const coords: [number, number, number] = [
      inspector.evalVarNum(`${p}coordinates[1]`, 0.2),
      inspector.evalVarNum(`${p}coordinates[2]`, 0),
      inspector.evalVarNum(`${p}coordinates[3]`, 0),
    ];
    const rotMatPrefix = inspector.hasVar(`${p}R.T[1,1]`) ? `${p}R.T` : `${p}R_T`;
    const rMat: number[] = [
      inspector.evalVarNum(`${rotMatPrefix}[1,1]`, 1),
      inspector.evalVarNum(`${rotMatPrefix}[1,2]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[1,3]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[2,1]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[2,2]`, 1),
      inspector.evalVarNum(`${rotMatPrefix}[2,3]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,1]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,2]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,3]`, 1),
    ];
    const headAtOrigin = inspector.evalVarBool(`${p}headAtOrigin`, false);
    const twoHeaded = inspector.evalVarBool(`${p}twoHeadedArrow`, false);

    const cR = inspector.evalVarNum(`${p}color[1]`, 0);
    const cG = inspector.evalVarNum(`${p}color[2]`, 128);
    const cB = inspector.evalVarNum(`${p}color[3]`, 255);
    const is255 = cR > 1.0 || cG > 1.0 || cB > 1.0;
    const rgb: [number, number, number] = is255
      ? [Math.min(1, Math.max(0, cR / 255)), Math.min(1, Math.max(0, cG / 255)), Math.min(1, Math.max(0, cB / 255))]
      : [Math.min(1, Math.max(0, cR)), Math.min(1, Math.max(0, cG)), Math.min(1, Math.max(0, cB))];
    const rgba: [number, number, number, number] = [rgb[0], rgb[1], rgb[2], 1.0];

    const vecLen = Math.hypot(coords[0], coords[1], coords[2]);
    const diameter = inspector.evalVarNum("world.defaultArrowDiameter", 0.04);
    const scale: [number, number, number] = [vecLen || 0.2, diameter, diameter];
    const lengthDir: [number, number, number] =
      vecLen > 1e-9 ? [coords[0] / vecLen, coords[1] / vecLen, coords[2] / vecLen] : [1, 0, 0];

    const qFrame = quaternionFromMatrix3x3(rMat, true);
    const qShape = quaternionFromDirections(lengthDir, [0, 1, 0]);
    const qWorld = quaternionMultiply(qFrame, qShape);
    const worldRotDeg = quaternionToEuler(qWorld, "XYZ", true);

    const localOffset: [number, number, number] = headAtOrigin
      ? [rShape[0] - coords[0], rShape[1] - coords[1], rShape[2] - coords[2]]
      : [rShape[0], rShape[1], rShape[2]];
    const worldOffset = rotateVectorByQuaternion(localOffset, qFrame);
    const worldPos: [number, number, number] = [r[0] + worldOffset[0], r[1] + worldOffset[1], r[2] + worldOffset[2]];

    const dynamicBindings: CadDynamicBinding[] = [];
    for (let k = 0; k < 3; k++) {
      inspector.pushDynamicBinding(dynamicBindings, "position", k, `${p}r[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "shapeOffset", k, `${p}r_shape[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "vectorCoordinates", k, `${p}coordinates[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "color", k, `${p}color[${k + 1}]`);
    }
    let rotIdx = 0;
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        inspector.pushDynamicBinding(dynamicBindings, "rotation", rotIdx++, `${rotMatPrefix}[${row},${col}]`);
      }
    }

    const shapeKind = twoHeaded ? "doublearrow" : "vector";
    const proceduralMesh = createUnitArrowMesh(twoHeaded, 16, rgba);
    const defaults: ComponentDefaultTransform = {
      position: r,
      rotation: worldRotDeg,
      quaternion: qFrame,
      scale,
      shapeOffset: rShape,
      vectorCoordinates: coords,
      headAtOrigin,
      color: rgb,
    };

    const cadStr =
      `CAD(uri="procedural://msl/${shapeKind}", feature="${compName}", ` +
      `position={${worldPos[0]}, ${worldPos[1]}, ${worldPos[2]}}, ` +
      `rotation={${worldRotDeg[0]}, ${worldRotDeg[1]}, ${worldRotDeg[2]}}, ` +
      `scale={${scale[0]}, ${scale[1]}, ${scale[2]}}, ` +
      `dynamicPosition="{${p}r[1], ${p}r[2], ${p}r[3]}", ` +
      `dynamicRotation="${rotMatPrefix}")`;

    results.push({
      name: compName,
      shapeType: shapeKind,
      cad: cadStr,
      dynamicBindings,
      defaults,
      proceduralMesh,
    });
  }

  // 3. Discover all `Visualizers.Advanced.Surface` (`PartialSurface`) instances via `<prefix>.nu` & `<prefix>.nv`
  for (const [varName] of inspector.varByName.entries()) {
    if (!varName.endsWith(".nu") && varName !== "nu") continue;
    const prefix = varName === "nu" ? "" : varName.slice(0, -".nu".length);
    const p = prefix ? `${prefix}.` : "";
    if (!inspector.hasVar(`${p}nv`)) continue;
    if (
      !inspector.hasVar(`${p}r_0[1]`) &&
      !inspector.hasVar(`${p}wireframe`) &&
      !inspector.hasVar(`${p}multiColoredSurface`)
    ) {
      continue;
    }

    const compName = prefix || "surface";
    if (seenPrefixes.has(compName)) continue;
    seenPrefixes.add(compName);

    const parentPrefix = prefix.includes(".") ? prefix.slice(0, prefix.lastIndexOf(".")) : "";
    const pp = parentPrefix ? `${parentPrefix}.` : "";

    const nu = Math.max(2, Math.round(inspector.evalVarNum(`${p}nu`, 20)));
    const nv = Math.max(2, Math.round(inspector.evalVarNum(`${p}nv`, 12)));

    const r0: [number, number, number] = [
      inspector.evalVarNum(`${p}r_0[1]`, inspector.evalVarNum(`${pp}frame_a.r_0[1]`, 0)),
      inspector.evalVarNum(`${p}r_0[2]`, inspector.evalVarNum(`${pp}frame_a.r_0[2]`, 0)),
      inspector.evalVarNum(`${p}r_0[3]`, inspector.evalVarNum(`${pp}frame_a.r_0[3]`, 0)),
    ];
    const rotMatPrefix = inspector.hasVar(`${p}R.T[1,1]`)
      ? `${p}R.T`
      : inspector.hasVar(`${p}R_T[1,1]`)
        ? `${p}R_T`
        : `${pp}frame_a.R.T`;
    const rMat: number[] = [
      inspector.evalVarNum(`${rotMatPrefix}[1,1]`, 1),
      inspector.evalVarNum(`${rotMatPrefix}[1,2]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[1,3]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[2,1]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[2,2]`, 1),
      inspector.evalVarNum(`${rotMatPrefix}[2,3]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,1]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,2]`, 0),
      inspector.evalVarNum(`${rotMatPrefix}[3,3]`, 1),
    ];

    const cR = inspector.evalVarNum(`${p}color[1]`, inspector.evalVarNum(`${pp}color[1]`, 0));
    const cG = inspector.evalVarNum(`${p}color[2]`, inspector.evalVarNum(`${pp}color[2]`, 128));
    const cB = inspector.evalVarNum(`${p}color[3]`, inspector.evalVarNum(`${pp}color[3]`, 255));
    const transparency = inspector.evalVarNum(`${p}transparency`, inspector.evalVarNum(`${pp}transparency`, 0));
    const is255 = cR > 1.0 || cG > 1.0 || cB > 1.0;
    const rgb: [number, number, number] = is255
      ? [Math.min(1, Math.max(0, cR / 255)), Math.min(1, Math.max(0, cG / 255)), Math.min(1, Math.max(0, cB / 255))]
      : [Math.min(1, Math.max(0, cR)), Math.min(1, Math.max(0, cG)), Math.min(1, Math.max(0, cB))];
    const rgba: [number, number, number, number] = [rgb[0], rgb[1], rgb[2], Math.max(0.1, 1.0 - transparency)];

    let surfaceKind = "surface";
    let proceduralMesh: ProceduralMeshPayload;
    let lengthDir: [number, number, number] | undefined;
    let widthDir: [number, number, number] | undefined;

    if (inspector.hasVar(`${pp}rTire`) && inspector.hasVar(`${pp}rCurvature`)) {
      // VoluminousWheel torus tire surface
      surfaceKind = "voluminousWheelTire";
      const rTire = inspector.evalVarNum(`${pp}rTire`, 0.25);
      const width = inspector.evalVarNum(`${pp}width`, 0.25);
      const rCurv = inspector.evalVarNum(`${pp}rCurvature`, 0.3);
      const rw = width / 2;
      const rCurv2 = Math.max(rCurv, rw);
      const kw = rCurv2 > 1e-9 ? Math.min(1, rw / rCurv2) : 1;
      const ri = rTire - rCurv2;
      const opening = Math.PI - Math.asin(kw);
      proceduralMesh = createMslTorusMesh(ri, rCurv2, opening, -Math.PI, Math.PI, nu, nv, rgba);
    } else if (
      (inspector.hasVar(`${pp}R`) && inspector.hasVar(`${pp}r`)) ||
      (inspector.hasVar(`${p}R`) && inspector.hasVar(`${p}r`)) ||
      (inspector.hasVar(`${pp}ri`) && inspector.hasVar(`${pp}ro`)) ||
      (inspector.hasVar(`${p}ri`) && inspector.hasVar(`${p}ro`))
    ) {
      // Torus visualizer
      surfaceKind = "torus";
      const R = inspector.evalVarNum(
        `${pp}R`,
        inspector.evalVarNum(`${p}R`, inspector.evalVarNum(`${pp}ri`, inspector.evalVarNum(`${p}ri`, 0.5))),
      );
      const rMinor = inspector.evalVarNum(
        `${pp}r`,
        inspector.evalVarNum(`${p}r`, inspector.evalVarNum(`${pp}ro`, inspector.evalVarNum(`${p}ro`, 0.1))),
      );
      const opening = inspector.evalVarNum(`${pp}opening`, inspector.evalVarNum(`${p}opening`, 0));
      const startAngle = inspector.evalVarNum(`${pp}startAngle`, inspector.evalVarNum(`${p}startAngle`, -Math.PI));
      const stopAngle = inspector.evalVarNum(`${pp}stopAngle`, inspector.evalVarNum(`${p}stopAngle`, Math.PI));
      proceduralMesh = createMslTorusMesh(R, rMinor, opening, startAngle, stopAngle, nu, nv, rgba);
    } else if (
      (inspector.hasVar(`${pp}length_u`) && inspector.hasVar(`${pp}length_v`)) ||
      (inspector.hasVar(`${p}length_u`) && inspector.hasVar(`${p}length_v`)) ||
      (inspector.hasVar(`${pp}length`) && inspector.hasVar(`${pp}width`)) ||
      (inspector.hasVar(`${p}length`) && inspector.hasVar(`${p}width`))
    ) {
      // Rectangle visualizer
      surfaceKind = "rectangle";
      const lu = inspector.evalVarNum(
        `${pp}length_u`,
        inspector.evalVarNum(
          `${p}length_u`,
          inspector.evalVarNum(`${pp}length`, inspector.evalVarNum(`${p}length`, 3)),
        ),
      );
      const lv = inspector.evalVarNum(
        `${pp}length_v`,
        inspector.evalVarNum(`${p}length_v`, inspector.evalVarNum(`${pp}width`, inspector.evalVarNum(`${p}width`, 1))),
      );
      const dirPrefix = inspector.hasVar(`${pp}direction_u[1]`) ? pp : p;
      if (inspector.hasVar(`${dirPrefix}direction_u[1]`)) {
        lengthDir = [
          inspector.evalVarNum(`${dirPrefix}direction_u[1]`, 1),
          inspector.evalVarNum(`${dirPrefix}direction_u[2]`, 0),
          inspector.evalVarNum(`${dirPrefix}direction_u[3]`, 0),
        ];
      }
      if (inspector.hasVar(`${dirPrefix}direction_v[1]`)) {
        widthDir = [
          inspector.evalVarNum(`${dirPrefix}direction_v[1]`, 0),
          inspector.evalVarNum(`${dirPrefix}direction_v[2]`, 1),
          inspector.evalVarNum(`${dirPrefix}direction_v[3]`, 0),
        ];
      }
      proceduralMesh = createMslRectangleSurfaceMesh(lu, lv, nu, nv, rgba);
    } else if (
      (inspector.hasVar(`${pp}rOuter`) && inspector.hasVar(`${pp}length`)) ||
      (inspector.hasVar(`${p}rOuter`) && inspector.hasVar(`${p}length`))
    ) {
      // PipeWithScalarField visualizer
      surfaceKind = "pipeWithScalarField";
      const rOuter = inspector.evalVarNum(`${pp}rOuter`, inspector.evalVarNum(`${p}rOuter`, 0.1));
      const len = inspector.evalVarNum(`${pp}length`, inspector.evalVarNum(`${p}length`, 1.0));
      proceduralMesh = createMslPipeSurfaceMesh(rOuter, len, nu, nv, rgba);
    } else if (inspector.hasVar(`${p}X[1,1]`)) {
      // Custom parametric Surface X[nu, nv], Y[nu, nv], Z[nu, nv]
      const X: number[][] = [];
      const Y: number[][] = [];
      const Z: number[][] = [];
      const uLim = Math.min(nu, 50);
      const vLim = Math.min(nv, 50);
      for (let i = 1; i <= uLim; i++) {
        const rx: number[] = [];
        const ry: number[] = [];
        const rz: number[] = [];
        for (let j = 1; j <= vLim; j++) {
          rx.push(inspector.evalVarNum(`${p}X[${i},${j}]`, 0));
          ry.push(inspector.evalVarNum(`${p}Y[${i},${j}]`, 0));
          rz.push(inspector.evalVarNum(`${p}Z[${i},${j}]`, 0));
        }
        X.push(rx);
        Y.push(ry);
        Z.push(rz);
      }
      proceduralMesh = createMslGridSurfaceMesh(X, Y, Z, rgba);
    } else {
      proceduralMesh = createMslTorusMesh(0.5, 0.1, 0, -Math.PI, Math.PI, nu, nv, rgba);
    }

    const qFrame = quaternionFromMatrix3x3(rMat, true);
    const qWorld = lengthDir ? quaternionMultiply(qFrame, quaternionFromDirections(lengthDir, widthDir)) : qFrame;
    const worldRotDeg = quaternionToEuler(qWorld, "XYZ", true);

    const posPrefix = inspector.hasVar(`${p}r_0[1]`) ? `${p}r_0` : `${pp}frame_a.r_0`;

    const dynamicBindings: CadDynamicBinding[] = [];
    for (let k = 0; k < 3; k++) {
      inspector.pushDynamicBinding(dynamicBindings, "position", k, `${posPrefix}[${k + 1}]`);
      inspector.pushDynamicBinding(dynamicBindings, "color", k, `${p}color[${k + 1}]`);
    }
    let rotIdx = 0;
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        inspector.pushDynamicBinding(dynamicBindings, "rotation", rotIdx++, `${rotMatPrefix}[${row},${col}]`);
      }
    }

    const defaults: ComponentDefaultTransform = {
      position: r0,
      rotation: worldRotDeg,
      quaternion: qFrame,
      scale: [1, 1, 1],
      lengthDirection: lengthDir,
      widthDirection: widthDir,
      color: rgb,
    };

    const cadStr =
      `CAD(uri="procedural://msl/${surfaceKind}", feature="${compName}", ` +
      `position={${r0[0]}, ${r0[1]}, ${r0[2]}}, ` +
      `rotation={${worldRotDeg[0]}, ${worldRotDeg[1]}, ${worldRotDeg[2]}}, ` +
      `scale={1, 1, 1}, ` +
      `dynamicPosition="{${posPrefix}[1], ${posPrefix}[2], ${posPrefix}[3]}", ` +
      `dynamicRotation="${rotMatPrefix}")`;

    results.push({
      name: compName,
      shapeType: surfaceKind,
      cad: cadStr,
      dynamicBindings,
      defaults,
      proceduralMesh,
    });
  }

  return results;
}
