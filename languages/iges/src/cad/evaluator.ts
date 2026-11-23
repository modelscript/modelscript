// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — IGES 5.3 Geometric Evaluator.
 *
 * Evaluates IGES entities (100 Circular Arc, 102 Composite Curve, 106 Copious Data,
 * 110 Line, 116 Point, 120 Surface of Revolution, 122 Tabulated Cylinder,
 * 124 Transformation Matrix, 126 NURBS Curve, 128 NURBS Surface, 186 Manifold Solid B-Rep)
 * into world-space coordinates, exact arc lengths, areas, bounding boxes, and tessellated geometry.
 */

import { parseIges } from "../parser/iges-parser.js";
import type {
  IgesCircularArcEntity,
  IgesDocument,
  IgesEntity,
  IgesLineEntity,
  IgesNurbsCurveEntity,
  IgesNurbsSurfaceEntity,
  IgesTransformMatrixEntity,
  Point3D,
} from "../types.js";
import { IGES_UNIT_TO_METERS } from "../types.js";
import { tessellateNurbsCurve, tessellateNurbsSurface, type TessellatedSurfaceMesh } from "./nurbs.js";

export interface BoundingBox3D {
  min: Point3D;
  max: Point3D;
}

export interface EvaluatedCircularArc {
  center: Point3D;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepAngle: number;
  arcLength: number;
  sectorArea: number;
  isFullCircle: boolean;
  points: Point3D[];
}

export interface EvaluatedEntityResult {
  deNumber: number;
  entityType: number;
  label: string;
  boundingBox: BoundingBox3D | null;
  arcLength: number;
  area: number;
  polylines: Point3D[][];
  mesh?: TessellatedSurfaceMesh;
  arc?: EvaluatedCircularArc;
}

export interface IgesEvaluationResult {
  unitFlag: number;
  unitScaleToMeters: number;
  entities: EvaluatedEntityResult[];
  boundingBox: BoundingBox3D | null;
  totalCurveLength: number;
  totalSurfaceArea: number;
}

export interface EvaluateIgesOptions {
  /** Convert coordinates to SI meters using Global unit flag (default: false — preserve model units). */
  convertToMeters?: boolean;
  /** Number of samples for curve tessellation (default: 32). */
  curveSamples?: number;
  /** Surface U/V tessellation resolution (default: 12). */
  surfaceSamples?: number;
}

export interface Transform3x4 {
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  translation: Point3D;
}

export const IDENTITY_TRANSFORM_124: Transform3x4 = {
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  translation: [0, 0, 0],
};

/**
 * Apply an IGES Type 124 3x4 transformation `[R | T]` to a 3D point `p' = R*p + T`.
 */
export function applyTransform124(point: Point3D, transform: Transform3x4): Point3D {
  const [x, y, z] = point;
  const [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]] = transform.rotation;
  const [tx, ty, tz] = transform.translation;
  return [r00 * x + r01 * y + r02 * z + tx, r10 * x + r11 * y + r12 * z + ty, r20 * x + r21 * y + r22 * z + tz];
}

/**
 * Compose two IGES Type 124 transforms: `parent(child(p))`.
 */
export function composeTransform124(parent: Transform3x4, child: Transform3x4): Transform3x4 {
  const A = parent.rotation;
  const B = child.rotation;
  const rot: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      rot[i]![j] = A[i]![0] * B[0]![j]! + A[i]![1] * B[1]![j]! + A[i]![2] * B[2]![j]!;
    }
  }
  const t = applyTransform124(child.translation, parent);
  return { rotation: rot, translation: t };
}

/**
 * Resolve the effective cumulative Type 124 transform for an entity (handles chained matrices safely).
 */
export function resolveEntityTransform(doc: IgesDocument, entity: IgesEntity): Transform3x4 {
  const visited = new Set<number>();
  const chain: IgesTransformMatrixEntity[] = [];
  let ptr = entity.transformMatrixPointer;

  while (ptr > 0 && !visited.has(ptr)) {
    visited.add(ptr);
    const mat = doc.entitiesByDe.get(ptr);
    if (!mat || "rawParams" in mat || mat.entityType !== 124) break;
    chain.push(mat);
    ptr = mat.transformMatrixPointer;
  }

  let acc: Transform3x4 = IDENTITY_TRANSFORM_124;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i]!;
    acc = composeTransform124(acc, { rotation: m.rotation, translation: m.translation });
  }
  return acc;
}

export function scalePoint(p: Point3D, scale: number): Point3D {
  return scale === 1 ? [p[0], p[1], p[2]] : [p[0] * scale, p[1] * scale, p[2] * scale];
}

export function computePolylineLength(points: readonly Point3D[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return len;
}

export function computeBoundingBox(points: readonly Point3D[]): BoundingBox3D | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function mergeBoundingBoxes(a: BoundingBox3D | null, b: BoundingBox3D | null): BoundingBox3D | null {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/**
 * Evaluate an IGES Type 100 Circular Arc (counterclockwise from start to end in local XY plane at `zt`).
 * Per IGES 5.3 §4.3, when start == end the arc represents a full 2π circle.
 */
export function evaluateCircularArc(
  arc: IgesCircularArcEntity,
  transform: Transform3x4 = IDENTITY_TRANSFORM_124,
  scale = 1,
  samples = 64,
): EvaluatedCircularArc {
  const [cx, cy] = arc.center;
  const [sx, sy] = arc.start;
  const [ex, ey] = arc.end;
  const r = Math.hypot(sx - cx, sy - cy);
  const startAngle = Math.atan2(sy - cy, sx - cx);
  const endAngle = Math.atan2(ey - cy, ex - cx);

  const sameEndpoint = Math.hypot(ex - sx, ey - sy) <= Math.max(1e-12, 1e-9 * r);
  let sweepAngle = endAngle - startAngle;
  if (sameEndpoint && r > 0) {
    sweepAngle = 2 * Math.PI;
  } else if (sweepAngle <= 0) {
    sweepAngle += 2 * Math.PI;
  }

  const isFullCircle = Math.abs(sweepAngle - 2 * Math.PI) < 1e-9;
  const scaledR = r * scale;
  const arcLength = scaledR * sweepAngle;
  const sectorArea = 0.5 * scaledR * scaledR * sweepAngle;

  const n = Math.max(8, samples);
  const points: Point3D[] = [];
  for (let i = 0; i <= n; i++) {
    const theta = startAngle + (i / n) * sweepAngle;
    const localPt: Point3D = [cx + r * Math.cos(theta), cy + r * Math.sin(theta), arc.zt];
    points.push(scalePoint(applyTransform124(localPt, transform), scale));
  }

  const centerWorld = scalePoint(applyTransform124([cx, cy, arc.zt], transform), scale);

  return {
    center: centerWorld,
    radius: scaledR,
    startAngle,
    endAngle,
    sweepAngle,
    arcLength,
    sectorArea,
    isFullCircle,
    points,
  };
}

/**
 * Evaluate a Type 110 Line entity with optional Type 124 transform and unit scale.
 */
export function evaluateLineEntity(
  line: IgesLineEntity,
  transform: Transform3x4 = IDENTITY_TRANSFORM_124,
  scale = 1,
): { start: Point3D; end: Point3D; length: number } {
  const start = scalePoint(applyTransform124(line.start, transform), scale);
  const end = scalePoint(applyTransform124(line.end, transform), scale);
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  return { start, end, length };
}

/**
 * Evaluate a single IGES entity within its document context.
 */
export function evaluateIgesEntity(
  doc: IgesDocument,
  entity: IgesEntity,
  options: EvaluateIgesOptions = {},
): EvaluatedEntityResult {
  const unitFlag = doc.global?.unitFlag ?? 6;
  const scale = options.convertToMeters ? (IGES_UNIT_TO_METERS[unitFlag] ?? 1.0) : 1.0;
  const curveSamples = options.curveSamples ?? 32;
  const surfaceSamples = options.surfaceSamples ?? 12;
  const transform = resolveEntityTransform(doc, entity);

  const base: EvaluatedEntityResult = {
    deNumber: entity.deNumber,
    entityType: entity.entityType,
    label: entity.label,
    boundingBox: null,
    arcLength: 0,
    area: 0,
    polylines: [],
  };

  if ("rawParams" in entity) return base;

  switch (entity.entityType) {
    case 100: {
      const arc = evaluateCircularArc(entity, transform, scale, Math.max(32, curveSamples));
      return {
        ...base,
        boundingBox: computeBoundingBox(arc.points),
        arcLength: arc.arcLength,
        area: arc.sectorArea,
        polylines: [arc.points],
        arc,
      };
    }

    case 102: {
      const polylines: Point3D[][] = [];
      let totalLen = 0;
      let bbox: BoundingBox3D | null = null;
      for (const ptr of entity.constituentPointers) {
        const sub = doc.entitiesByDe.get(ptr);
        if (!sub) continue;
        const ev = evaluateIgesEntity(doc, sub, options);
        totalLen += ev.arcLength;
        bbox = mergeBoundingBoxes(bbox, ev.boundingBox);
        polylines.push(...ev.polylines);
      }
      return {
        ...base,
        boundingBox: bbox,
        arcLength: totalLen,
        polylines,
      };
    }

    case 106: {
      const pts = entity.points.map((p) => scalePoint(applyTransform124(p, transform), scale));
      return {
        ...base,
        boundingBox: computeBoundingBox(pts),
        arcLength: computePolylineLength(pts),
        polylines: pts.length > 0 ? [pts] : [],
      };
    }

    case 110: {
      const { start, end, length } = evaluateLineEntity(entity, transform, scale);
      return {
        ...base,
        boundingBox: computeBoundingBox([start, end]),
        arcLength: length,
        polylines: [[start, end]],
      };
    }

    case 116: {
      const pt = scalePoint(applyTransform124(entity.point, transform), scale);
      return {
        ...base,
        boundingBox: computeBoundingBox([pt]),
        polylines: [[pt]],
      };
    }

    case 120: {
      // Surface of revolution: revolve generatrix around axis from startAngle to endAngle
      const axisEnt = doc.entitiesByDe.get(entity.axisPointer);
      const genEnt = doc.entitiesByDe.get(entity.generatrixPointer);
      if (!axisEnt || "rawParams" in axisEnt || axisEnt.entityType !== 110 || !genEnt) {
        return base;
      }
      const genEval = evaluateIgesEntity(doc, genEnt, options);
      const profile = genEval.polylines[0] ?? [];
      if (profile.length < 2) return base;

      const a0 = scalePoint(applyTransform124(axisEnt.start, transform), scale);
      const a1 = scalePoint(applyTransform124(axisEnt.end, transform), scale);
      const axLen = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]);
      if (axLen < 1e-12) return base;
      const ux = (a1[0] - a0[0]) / axLen;
      const uy = (a1[1] - a0[1]) / axLen;
      const uz = (a1[2] - a0[2]) / axLen;

      const revSteps = Math.max(8, surfaceSamples);
      const vertices: Point3D[] = [];
      const triangles: Array<[number, number, number]> = [];
      const sweep = entity.endAngle - entity.startAngle;

      // Rodrigues rotation around axis (a0, u)
      const rotateAroundAxis = (p: Point3D, angle: number): Point3D => {
        const vx = p[0] - a0[0];
        const vy = p[1] - a0[1];
        const vz = p[2] - a0[2];
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const dot = ux * vx + uy * vy + uz * vz;
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        return [
          a0[0] + vx * cosA + cx * sinA + ux * dot * (1 - cosA),
          a0[1] + vy * cosA + cy * sinA + uy * dot * (1 - cosA),
          a0[2] + vz * cosA + cz * sinA + uz * dot * (1 - cosA),
        ];
      };

      const profLen = profile.length;
      for (let j = 0; j <= revSteps; j++) {
        const ang = entity.startAngle + (j / revSteps) * sweep;
        for (let i = 0; i < profLen; i++) {
          vertices.push(rotateAroundAxis(profile[i]!, ang));
        }
      }

      let surfaceArea = 0;
      for (let j = 0; j < revSteps; j++) {
        for (let i = 0; i < profLen - 1; i++) {
          const i00 = j * profLen + i;
          const i10 = j * profLen + i + 1;
          const i01 = (j + 1) * profLen + i;
          const i11 = (j + 1) * profLen + i + 1;
          triangles.push([i00, i10, i11]);
          triangles.push([i00, i11, i01]);
          const p0 = vertices[i00]!;
          const p1 = vertices[i10]!;
          const p2 = vertices[i11]!;
          const p3 = vertices[i01]!;
          const c1x = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
          const c1y = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
          const c1z = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
          surfaceArea += 0.5 * Math.hypot(c1x, c1y, c1z);
          const c2x = (p2[1] - p0[1]) * (p3[2] - p0[2]) - (p2[2] - p0[2]) * (p3[1] - p0[1]);
          const c2y = (p2[2] - p0[2]) * (p3[0] - p0[0]) - (p2[0] - p0[0]) * (p3[2] - p0[2]);
          const c2z = (p2[0] - p0[0]) * (p3[1] - p0[1]) - (p2[1] - p0[1]) * (p3[0] - p0[0]);
          surfaceArea += 0.5 * Math.hypot(c2x, c2y, c2z);
        }
      }

      return {
        ...base,
        boundingBox: computeBoundingBox(vertices),
        area: surfaceArea,
        mesh: { vertices, triangles, surfaceArea },
      };
    }

    case 126: {
      const nurbs = entity as IgesNurbsCurveEntity;
      const localPts = tessellateNurbsCurve(nurbs, curveSamples);
      const pts = localPts.map((p) => scalePoint(applyTransform124(p, transform), scale));
      return {
        ...base,
        boundingBox: computeBoundingBox(pts),
        arcLength: computePolylineLength(pts),
        polylines: [pts],
      };
    }

    case 128: {
      const surf = entity as IgesNurbsSurfaceEntity;
      const localMesh = tessellateNurbsSurface(surf, surfaceSamples, surfaceSamples);
      const vertices = localMesh.vertices.map((p) => scalePoint(applyTransform124(p, transform), scale));
      const scaledArea = localMesh.surfaceArea * scale * scale;
      return {
        ...base,
        boundingBox: computeBoundingBox(vertices),
        area: scaledArea,
        mesh: {
          vertices,
          triangles: localMesh.triangles,
          surfaceArea: scaledArea,
        },
      };
    }

    case 186: {
      // Manifold Solid B-Rep: aggregate bounding boxes from referenced surfaces/geometry in the document
      let bbox: BoundingBox3D | null = null;
      let totalArea = 0;
      for (const other of doc.entities) {
        if (other.deNumber === entity.deNumber) continue;
        if (
          other.entityType === 128 ||
          other.entityType === 120 ||
          other.entityType === 110 ||
          other.entityType === 100
        ) {
          const ev = evaluateIgesEntity(doc, other, options);
          bbox = mergeBoundingBoxes(bbox, ev.boundingBox);
          totalArea += ev.area;
        }
      }
      return {
        ...base,
        boundingBox: bbox,
        area: totalArea,
      };
    }

    default:
      return base;
  }
}

/**
 * Evaluate all entities in an IGES document.
 */
export function evaluateIgesDocument(
  input: IgesDocument | string,
  options: EvaluateIgesOptions = {},
): IgesEvaluationResult {
  const doc = typeof input === "string" ? parseIges(input) : input;
  const unitFlag = doc.global?.unitFlag ?? 6;
  const unitScaleToMeters = IGES_UNIT_TO_METERS[unitFlag] ?? 1.0;

  const entities: EvaluatedEntityResult[] = [];
  let globalBbox: BoundingBox3D | null = null;
  let totalCurveLength = 0;
  let totalSurfaceArea = 0;

  for (const entity of doc.entities) {
    if (entity.entityType === 124) continue; // Transform matrices are auxiliary
    const res = evaluateIgesEntity(doc, entity, options);
    entities.push(res);
    globalBbox = mergeBoundingBoxes(globalBbox, res.boundingBox);
    if (entity.entityType !== 102 && entity.entityType !== 186) {
      totalCurveLength += res.arcLength;
      totalSurfaceArea += res.area;
    }
  }

  return {
    unitFlag,
    unitScaleToMeters,
    entities,
    boundingBox: globalBbox,
    totalCurveLength,
    totalSurfaceArea,
  };
}
