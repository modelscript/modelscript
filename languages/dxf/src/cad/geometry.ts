// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  assembly,
  cylinder,
  linearExtrude,
  part,
  polyhedron,
  rotate,
  translate,
  type Assembly,
  type PartEntry,
  type Solid,
  type Vec3,
} from "@modelscript/cad";
import type {
  Dxf3DFaceEntity,
  DxfBoundingBox,
  DxfDocument,
  DxfEllipseEntity,
  DxfEntity,
  DxfInsertEntity,
  DxfLwPolylineEntity,
  DxfPoint2D,
  DxfPoint3D,
  DxfPolylineEntity,
  DxfSplineEntity,
} from "../types.js";

/** Row-major 4x4 affine transformation matrix. */
export type AffineMat4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY_MAT4: AffineMat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiplyMat4(a: AffineMat4, b: AffineMat4): AffineMat4 {
  const out = new Array<number>(16).fill(0) as AffineMat4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0]! * b[0 * 4 + c]! +
        a[r * 4 + 1]! * b[1 * 4 + c]! +
        a[r * 4 + 2]! * b[2 * 4 + c]! +
        a[r * 4 + 3]! * b[3 * 4 + c]!;
    }
  }
  return out;
}

export function transformPoint3D(m: AffineMat4, p: DxfPoint3D): DxfPoint3D {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
    y: m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
    z: m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
  };
}

export function buildInsertMatrix(ins: DxfInsertEntity, basePoint: DxfPoint3D, colIdx = 0, rowIdx = 0): AffineMat4 {
  const rad = (ins.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  const tx = ins.position.x + colIdx * ins.columnSpacing;
  const ty = ins.position.y + rowIdx * ins.rowSpacing;
  const tz = ins.position.z;

  const tNegBase: AffineMat4 = [1, 0, 0, -basePoint.x, 0, 1, 0, -basePoint.y, 0, 0, 1, -basePoint.z, 0, 0, 0, 1];
  const sMat: AffineMat4 = [ins.scaleX, 0, 0, 0, 0, ins.scaleY, 0, 0, 0, 0, ins.scaleZ, 0, 0, 0, 0, 1];
  const rMat: AffineMat4 = [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const tPos: AffineMat4 = [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];

  return multiplyMat4(tPos, multiplyMat4(rMat, multiplyMat4(sMat, tNegBase)));
}

export interface BulgeArcGeometry {
  center: DxfPoint2D;
  radius: number;
  startAngle: number; // radians
  endAngle: number; // radians
  sweepAngle: number; // signed radians (+ CCW, - CW)
  arcLength: number;
  signedSegmentArea: number;
}

/**
 * Evaluates exact AutoCAD DXF bulge arc geometry between two 2D vertices.
 * Bulge `b = tan(theta / 4)`, positive = CCW, negative = CW.
 */
export function evaluateBulgeArc(p1: DxfPoint2D, p2: DxfPoint2D, bulge: number): BulgeArcGeometry | null {
  if (Math.abs(bulge) <= 1e-12) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= 1e-12) return null;

  const absB = Math.abs(bulge);
  const theta = 4 * Math.atan(absB);
  const radius = (chord * (1 + bulge * bulge)) / (4 * absB);
  const d = (chord * (1 - bulge * bulge)) / (4 * bulge);

  const midX = 0.5 * (p1.x + p2.x);
  const midY = 0.5 * (p1.y + p2.y);
  const nx = -dy / chord;
  const ny = dx / chord;

  const cx = midX + d * nx;
  const cy = midY + d * ny;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const sweepAngle = bulge > 0 ? theta : -theta;
  const endAngle = startAngle + sweepAngle;
  const arcLength = radius * theta;
  const signedSegmentArea = (bulge > 0 ? 1 : -1) * 0.5 * radius * radius * (theta - Math.sin(theta));

  return {
    center: { x: cx, y: cy },
    radius,
    startAngle,
    endAngle,
    sweepAngle,
    arcLength,
    signedSegmentArea,
  };
}

export function sampleBulgeArc(p1: DxfPoint2D, p2: DxfPoint2D, bulge: number, segments = 16): DxfPoint2D[] {
  const arc = evaluateBulgeArc(p1, p2, bulge);
  if (!arc) return [p1, p2];
  const n = Math.max(4, Math.ceil((Math.abs(arc.sweepAngle) / (Math.PI / 2)) * (segments / 4)));
  const pts: DxfPoint2D[] = [];
  for (let i = 0; i <= n; i++) {
    const a = arc.startAngle + (arc.sweepAngle * i) / n;
    pts.push({
      x: arc.center.x + arc.radius * Math.cos(a),
      y: arc.center.y + arc.radius * Math.sin(a),
    });
  }
  return pts;
}

export function arcSweepRadians(startDeg: number, endDeg: number): number {
  let sweep = (((endDeg - startDeg) % 360) + 360) % 360;
  if (sweep === 0 && endDeg !== startDeg) sweep = 360;
  return (sweep * Math.PI) / 180;
}

export function evaluateSplinePoints(spline: DxfSplineEntity, samples = 32): DxfPoint3D[] {
  const ctrl = spline.controlPoints.length >= 2 ? spline.controlPoints : spline.fitPoints;
  if (ctrl.length < 2) return [...ctrl];
  const p = Math.min(Math.max(1, spline.degree), ctrl.length - 1);
  const n = ctrl.length - 1;
  const m = n + p + 1;

  // Use provided knots if valid length, else build uniform clamped knot vector
  let knots = spline.knots;
  if (knots.length !== m + 1) {
    knots = [];
    for (let i = 0; i <= m; i++) {
      if (i <= p) knots.push(0);
      else if (i >= m - p) knots.push(1);
      else knots.push((i - p) / (m - 2 * p));
    }
  }

  const uMin = knots[p]!;
  const uMax = knots[m - p]!;
  if (Math.abs(uMax - uMin) <= 1e-12) return [...ctrl];

  const out: DxfPoint3D[] = [];
  for (let s = 0; s <= samples; s++) {
    const u = s === samples ? uMax - 1e-12 : uMin + ((uMax - uMin) * s) / samples;
    // Find knot span k
    let k = p;
    for (let i = p; i < m - p; i++) {
      if (u >= knots[i]! && u < knots[i + 1]!) {
        k = i;
        break;
      }
    }
    if (s === samples) k = n;

    // De Boor algorithm
    const d: DxfPoint3D[] = [];
    for (let j = 0; j <= p; j++) {
      const idx = Math.max(0, Math.min(n, k - p + j));
      d.push({ ...ctrl[idx]! });
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const left = knots[j + k - p]!;
        const right = knots[j + 1 + k - r]!;
        const denom = right - left;
        const alpha = denom > 1e-12 ? (u - left) / denom : 0;
        const prev = d[j - 1]!;
        const cur = d[j]!;
        d[j] = {
          x: (1 - alpha) * prev.x + alpha * cur.x,
          y: (1 - alpha) * prev.y + alpha * cur.y,
          z: (1 - alpha) * prev.z + alpha * cur.z,
        };
      }
    }
    out.push(d[p]!);
  }
  return out;
}

export function sampleEllipsePoints(ellipse: DxfEllipseEntity, samples = 48): DxfPoint3D[] {
  const a = Math.hypot(ellipse.majorAxisEndpoint.x, ellipse.majorAxisEndpoint.y, ellipse.majorAxisEndpoint.z);
  if (a <= 1e-12) return [ellipse.center];
  const ux = ellipse.majorAxisEndpoint.x / a;
  const uy = ellipse.majorAxisEndpoint.y / a;
  const uz = ellipse.majorAxisEndpoint.z / a;
  // Minor axis perpendicular to major axis in XY plane (or cross with Z)
  const b = a * ellipse.ratio;
  const vx = -uy;
  const vy = ux;
  const vz = 0;

  let endP = ellipse.endParam;
  if (endP <= ellipse.startParam) endP += Math.PI * 2;

  const pts: DxfPoint3D[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = ellipse.startParam + ((endP - ellipse.startParam) * i) / samples;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    pts.push({
      x: ellipse.center.x + a * ct * ux + b * st * vx,
      y: ellipse.center.y + a * ct * uy + b * st * vy,
      z: ellipse.center.z + a * ct * uz + b * st * vz,
    });
  }
  return pts;
}

export interface DxfTriangle3D {
  v0: DxfPoint3D;
  v1: DxfPoint3D;
  v2: DxfPoint3D;
  normal: DxfPoint3D;
  area: number;
  layer: string;
}

function makeTriangle(v0: DxfPoint3D, v1: DxfPoint3D, v2: DxfPoint3D, layer: string): DxfTriangle3D | null {
  const abx = v1.x - v0.x;
  const aby = v1.y - v0.y;
  const abz = v1.z - v0.z;
  const acx = v2.x - v0.x;
  const acy = v2.y - v0.y;
  const acz = v2.z - v0.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-12) return null;
  return {
    v0,
    v1,
    v2,
    normal: { x: nx / len, y: ny / len, z: nz / len },
    area: 0.5 * len,
    layer,
  };
}

export function triangulate3DFace(face: Dxf3DFaceEntity): DxfTriangle3D[] {
  const [v0, v1, v2, v3] = face.vertices;
  const tris: DxfTriangle3D[] = [];
  const t1 = makeTriangle(v0, v1, v2, face.layer);
  if (t1) tris.push(t1);
  const d23 = Math.hypot(v3.x - v2.x, v3.y - v2.y, v3.z - v2.z);
  const d30 = Math.hypot(v3.x - v0.x, v3.y - v0.y, v3.z - v0.z);
  if (d23 > 1e-12 && d30 > 1e-12) {
    const t2 = makeTriangle(v0, v2, v3, face.layer);
    if (t2) tris.push(t2);
  }
  return tris;
}

function isUniformXYMatrix(m: AffineMat4): { uniform: boolean; scale: number; rotDeg: number; detSign: number } {
  const sx = Math.hypot(m[0], m[4]);
  const sy = Math.hypot(m[1], m[5]);
  const dot = m[0] * m[1] + m[4] * m[5];
  const det = m[0] * m[5] - m[1] * m[4];
  const uniform = Math.abs(sx - sy) <= 1e-6 * Math.max(1, sx, sy) && Math.abs(dot) <= 1e-6 * Math.max(1, sx * sy);
  const rotDeg = (Math.atan2(m[4], m[0]) * 180) / Math.PI;
  return { uniform, scale: sx, rotDeg, detSign: det >= 0 ? 1 : -1 };
}

function transformEntity(ent: DxfEntity, m: AffineMat4, effectiveLayer: string): DxfEntity {
  const layer = ent.layer === "0" ? effectiveLayer : ent.layer;
  const isIdentity = m.every((v, idx) => Math.abs(v - IDENTITY_MAT4[idx]!) < 1e-12);
  if (isIdentity) {
    return layer === ent.layer ? ent : { ...ent, layer };
  }

  switch (ent.type) {
    case "LINE":
      return {
        ...ent,
        layer,
        start: transformPoint3D(m, ent.start),
        end: transformPoint3D(m, ent.end),
      };

    case "POINT":
      return {
        ...ent,
        layer,
        position: transformPoint3D(m, ent.position),
      };

    case "TEXT":
    case "MTEXT": {
      const info = isUniformXYMatrix(m);
      return {
        ...ent,
        layer,
        position: transformPoint3D(m, ent.position),
        height: ent.height * info.scale,
        rotation: ent.rotation + info.rotDeg,
      };
    }

    case "CIRCLE": {
      const info = isUniformXYMatrix(m);
      if (info.uniform) {
        return {
          ...ent,
          layer,
          center: transformPoint3D(m, ent.center),
          radius: ent.radius * info.scale,
        };
      }
      // Non-uniform scale turns circle into ellipse
      const center = transformPoint3D(m, ent.center);
      const px = transformPoint3D(m, { x: ent.center.x + ent.radius, y: ent.center.y, z: ent.center.z });
      const py = transformPoint3D(m, { x: ent.center.x, y: ent.center.y + ent.radius, z: ent.center.z });
      const ax = { x: px.x - center.x, y: px.y - center.y, z: px.z - center.z };
      const ay = { x: py.x - center.x, y: py.y - center.y, z: py.z - center.z };
      const lx = Math.hypot(ax.x, ax.y, ax.z);
      const ly = Math.hypot(ay.x, ay.y, ay.z);
      const major = lx >= ly ? ax : ay;
      const ratio = lx >= ly ? (lx > 0 ? ly / lx : 1) : ly > 0 ? lx / ly : 1;
      return {
        type: "ELLIPSE",
        handle: ent.handle,
        layer,
        color: ent.color,
        lineType: ent.lineType,
        line: ent.line,
        startOffset: ent.startOffset,
        endOffset: ent.endOffset,
        center,
        majorAxisEndpoint: major,
        ratio,
        startParam: 0,
        endParam: Math.PI * 2,
      };
    }

    case "ARC": {
      const info = isUniformXYMatrix(m);
      if (info.uniform && info.detSign > 0) {
        return {
          ...ent,
          layer,
          center: transformPoint3D(m, ent.center),
          radius: ent.radius * info.scale,
          startAngle: ent.startAngle + info.rotDeg,
          endAngle: ent.endAngle + info.rotDeg,
        };
      }
      // Non-uniform or mirrored arc -> sampled LWPOLYLINE
      const sweep = arcSweepRadians(ent.startAngle, ent.endAngle);
      const startRad = (ent.startAngle * Math.PI) / 180;
      const segs = 24;
      const vertices = [];
      for (let i = 0; i <= segs; i++) {
        const a = startRad + (sweep * i) / segs;
        const pt = transformPoint3D(m, {
          x: ent.center.x + ent.radius * Math.cos(a),
          y: ent.center.y + ent.radius * Math.sin(a),
          z: ent.center.z,
        });
        vertices.push({ x: pt.x, y: pt.y, bulge: 0 });
      }
      return {
        type: "LWPOLYLINE",
        handle: ent.handle,
        layer,
        color: ent.color,
        lineType: ent.lineType,
        line: ent.line,
        startOffset: ent.startOffset,
        endOffset: ent.endOffset,
        vertices,
        closed: false,
        elevation: 0,
      };
    }

    case "LWPOLYLINE": {
      const info = isUniformXYMatrix(m);
      if (info.uniform) {
        return {
          ...ent,
          layer,
          vertices: ent.vertices.map((v) => {
            const p = transformPoint3D(m, { x: v.x, y: v.y, z: ent.elevation });
            return { ...v, x: p.x, y: p.y, bulge: info.detSign * v.bulge };
          }),
        };
      }
      // Non-uniform scaling with bulges -> tessellate bulges then transform
      const outVerts = [];
      const count = ent.closed ? ent.vertices.length : ent.vertices.length - 1;
      for (let i = 0; i < count; i++) {
        const v1 = ent.vertices[i]!;
        const v2 = ent.vertices[(i + 1) % ent.vertices.length]!;
        const pts = sampleBulgeArc(v1, v2, v1.bulge, 16);
        for (let k = 0; k < pts.length - 1; k++) {
          const p = transformPoint3D(m, { x: pts[k]!.x, y: pts[k]!.y, z: ent.elevation });
          outVerts.push({ x: p.x, y: p.y, bulge: 0 });
        }
      }
      if (!ent.closed && ent.vertices.length > 0) {
        const last = ent.vertices[ent.vertices.length - 1]!;
        const p = transformPoint3D(m, { x: last.x, y: last.y, z: ent.elevation });
        outVerts.push({ x: p.x, y: p.y, bulge: 0 });
      }
      return { ...ent, layer, vertices: outVerts };
    }

    case "POLYLINE":
      return {
        ...ent,
        layer,
        vertices: ent.vertices.map((v) => transformPoint3D(m, v)),
      };

    case "SPLINE":
      return {
        ...ent,
        layer,
        controlPoints: ent.controlPoints.map((v) => transformPoint3D(m, v)),
        fitPoints: ent.fitPoints.map((v) => transformPoint3D(m, v)),
      };

    case "ELLIPSE": {
      const center = transformPoint3D(m, ent.center);
      const majorTip = transformPoint3D(m, {
        x: ent.center.x + ent.majorAxisEndpoint.x,
        y: ent.center.y + ent.majorAxisEndpoint.y,
        z: ent.center.z + ent.majorAxisEndpoint.z,
      });
      return {
        ...ent,
        layer,
        center,
        majorAxisEndpoint: {
          x: majorTip.x - center.x,
          y: majorTip.y - center.y,
          z: majorTip.z - center.z,
        },
      };
    }

    case "3DFACE":
      return {
        ...ent,
        layer,
        vertices: [
          transformPoint3D(m, ent.vertices[0]),
          transformPoint3D(m, ent.vertices[1]),
          transformPoint3D(m, ent.vertices[2]),
          transformPoint3D(m, ent.vertices[3]),
        ],
      };

    default:
      return { ...ent, layer };
  }
}

/**
 * Recursively expands all hierarchical `INSERT` block references into flat world-space entities.
 */
export function expandDxfEntities(doc: DxfDocument, maxDepth = 16): DxfEntity[] {
  const out: DxfEntity[] = [];

  function walk(entities: DxfEntity[], mat: AffineMat4, parentLayer: string, stack: Set<string>, depth: number): void {
    if (depth > maxDepth) return;
    for (const ent of entities) {
      if (ent.type === "INSERT") {
        const blk = doc.blocks.get(ent.blockName);
        if (!blk || stack.has(ent.blockName)) continue;
        const effectiveLayer = ent.layer === "0" ? parentLayer : ent.layer;
        stack.add(ent.blockName);
        for (let r = 0; r < ent.rowCount; r++) {
          for (let c = 0; c < ent.columnCount; c++) {
            const insMat = buildInsertMatrix(ent, blk.basePoint, c, r);
            const combined = multiplyMat4(mat, insMat);
            walk(blk.entities, combined, effectiveLayer, stack, depth + 1);
          }
        }
        stack.delete(ent.blockName);
      } else {
        out.push(transformEntity(ent, mat, parentLayer));
      }
    }
  }

  walk(doc.entities, IDENTITY_MAT4, "0", new Set<string>(), 0);
  return out;
}

export function computeLwPolylineLength(ent: DxfLwPolylineEntity): number {
  const n = ent.vertices.length;
  if (n < 2) return 0;
  const segCount = ent.closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const p1 = ent.vertices[i]!;
    const p2 = ent.vertices[(i + 1) % n]!;
    const arc = evaluateBulgeArc(p1, p2, p1.bulge);
    total += arc ? arc.arcLength : Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return total;
}

export function computeLwPolylineArea(ent: DxfLwPolylineEntity): number {
  const n = ent.vertices.length;
  if (!ent.closed || n < 2) return 0;
  let shoelace = 0;
  let segArea = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ent.vertices[i]!;
    const p2 = ent.vertices[(i + 1) % n]!;
    shoelace += p1.x * p2.y - p2.x * p1.y;
    const arc = evaluateBulgeArc(p1, p2, p1.bulge);
    if (arc) segArea += arc.signedSegmentArea;
  }
  return Math.abs(0.5 * shoelace + segArea);
}

export function computePolylineLength(ent: DxfPolylineEntity): number {
  const n = ent.vertices.length;
  if (n < 2) return 0;
  const segCount = ent.closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const p1 = ent.vertices[i]!;
    const p2 = ent.vertices[(i + 1) % n]!;
    const bulge = ent.bulges[i] ?? 0;
    const arc = !ent.is3D ? evaluateBulgeArc(p1, p2, bulge) : null;
    total += arc ? arc.arcLength : Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
  }
  return total;
}

export function computePolylineArea(ent: DxfPolylineEntity): number {
  const n = ent.vertices.length;
  if (!ent.closed || n < 2) return 0;
  let shoelace = 0;
  let segArea = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ent.vertices[i]!;
    const p2 = ent.vertices[(i + 1) % n]!;
    shoelace += p1.x * p2.y - p2.x * p1.y;
    const bulge = ent.bulges[i] ?? 0;
    const arc = !ent.is3D ? evaluateBulgeArc(p1, p2, bulge) : null;
    if (arc) segArea += arc.signedSegmentArea;
  }
  return Math.abs(0.5 * shoelace + segArea);
}

export function computeEntityPathLength(ent: DxfEntity): number {
  switch (ent.type) {
    case "LINE":
      return Math.hypot(ent.end.x - ent.start.x, ent.end.y - ent.start.y, ent.end.z - ent.start.z);
    case "CIRCLE":
      return ent.radius > 0 ? 2 * Math.PI * ent.radius : 0;
    case "ARC":
      return ent.radius > 0 ? ent.radius * arcSweepRadians(ent.startAngle, ent.endAngle) : 0;
    case "LWPOLYLINE":
      return computeLwPolylineLength(ent);
    case "POLYLINE":
      return computePolylineLength(ent);
    case "ELLIPSE": {
      const pts = sampleEllipsePoints(ent, 128);
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y, pts[i]!.z - pts[i - 1]!.z);
      }
      return len;
    }
    case "SPLINE": {
      const pts = evaluateSplinePoints(ent, 64);
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y, pts[i]!.z - pts[i - 1]!.z);
      }
      return len;
    }
    default:
      return 0;
  }
}

export function computeEntityEnclosedArea(ent: DxfEntity): number {
  switch (ent.type) {
    case "CIRCLE":
      return ent.radius > 0 ? Math.PI * ent.radius * ent.radius : 0;
    case "LWPOLYLINE":
      return computeLwPolylineArea(ent);
    case "POLYLINE":
      return computePolylineArea(ent);
    case "ELLIPSE": {
      const a = Math.hypot(ent.majorAxisEndpoint.x, ent.majorAxisEndpoint.y, ent.majorAxisEndpoint.z);
      const b = a * ent.ratio;
      const span = Math.abs(ent.endParam - ent.startParam);
      return span >= Math.PI * 2 - 1e-6 ? Math.PI * a * b : 0;
    }
    default:
      return 0;
  }
}

function expandBBox(bb: DxfBoundingBox, x: number, y: number, z: number): void {
  if (x < bb.minX) bb.minX = x;
  if (y < bb.minY) bb.minY = y;
  if (z < bb.minZ) bb.minZ = z;
  if (x > bb.maxX) bb.maxX = x;
  if (y > bb.maxY) bb.maxY = y;
  if (z > bb.maxZ) bb.maxZ = z;
}

function angleInSweep(angleRad: number, startRad: number, sweepRad: number): boolean {
  const twoPi = Math.PI * 2;
  if (Math.abs(sweepRad) >= twoPi - 1e-9) return true;
  if (sweepRad >= 0) {
    const diff = (((angleRad - startRad) % twoPi) + twoPi) % twoPi;
    return diff <= sweepRad + 1e-9;
  }
  const diff = (((startRad - angleRad) % twoPi) + twoPi) % twoPi;
  return diff <= -sweepRad + 1e-9;
}

function addArcToBBox(
  bb: DxfBoundingBox,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  startRad: number,
  sweepRad: number,
): void {
  expandBBox(bb, cx + r * Math.cos(startRad), cy + r * Math.sin(startRad), cz);
  const endRad = startRad + sweepRad;
  expandBBox(bb, cx + r * Math.cos(endRad), cy + r * Math.sin(endRad), cz);
  const cardinals = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (const ca of cardinals) {
    if (angleInSweep(ca, startRad, sweepRad)) {
      expandBBox(bb, cx + r * Math.cos(ca), cy + r * Math.sin(ca), cz);
    }
  }
}

export interface DxfGeometryReport {
  flatEntities: DxfEntity[];
  boundingBox: DxfBoundingBox;
  totalPathLength: number;
  totalEnclosedArea: number;
  enclosedAreasByEntity: Array<{ index: number; type: string; layer: string; area: number }>;
  meshTriangles: DxfTriangle3D[];
  totalMeshSurfaceArea: number;
  entityCounts: Record<string, number>;
}

/**
 * Flattens `INSERT` blocks and computes exact geometric metrics: bounding box,
 * total path length, enclosed polygon/circle areas, and `3DFACE` mesh triangles.
 */
export function analyzeDxfGeometry(doc: DxfDocument): DxfGeometryReport {
  const flatEntities = expandDxfEntities(doc);
  const bb: DxfBoundingBox = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };

  let totalPathLength = 0;
  let totalEnclosedArea = 0;
  const enclosedAreasByEntity: Array<{ index: number; type: string; layer: string; area: number }> = [];
  const meshTriangles: DxfTriangle3D[] = [];
  let totalMeshSurfaceArea = 0;
  const entityCounts: Record<string, number> = {};

  for (let i = 0; i < flatEntities.length; i++) {
    const ent = flatEntities[i]!;
    entityCounts[ent.type] = (entityCounts[ent.type] ?? 0) + 1;
    totalPathLength += computeEntityPathLength(ent);

    const area = computeEntityEnclosedArea(ent);
    if (area > 0) {
      totalEnclosedArea += area;
      enclosedAreasByEntity.push({ index: i, type: ent.type, layer: ent.layer, area });
    }

    switch (ent.type) {
      case "LINE":
        expandBBox(bb, ent.start.x, ent.start.y, ent.start.z);
        expandBBox(bb, ent.end.x, ent.end.y, ent.end.z);
        break;
      case "POINT":
      case "TEXT":
      case "MTEXT":
        expandBBox(bb, ent.position.x, ent.position.y, ent.position.z);
        break;
      case "CIRCLE":
        expandBBox(bb, ent.center.x - ent.radius, ent.center.y - ent.radius, ent.center.z);
        expandBBox(bb, ent.center.x + ent.radius, ent.center.y + ent.radius, ent.center.z);
        break;
      case "ARC":
        addArcToBBox(
          bb,
          ent.center.x,
          ent.center.y,
          ent.center.z,
          ent.radius,
          (ent.startAngle * Math.PI) / 180,
          arcSweepRadians(ent.startAngle, ent.endAngle),
        );
        break;
      case "LWPOLYLINE": {
        const n = ent.vertices.length;
        const segs = ent.closed ? n : n - 1;
        for (const v of ent.vertices) {
          expandBBox(bb, v.x, v.y, ent.elevation);
        }
        for (let k = 0; k < segs; k++) {
          const p1 = ent.vertices[k]!;
          const p2 = ent.vertices[(k + 1) % n]!;
          const arc = evaluateBulgeArc(p1, p2, p1.bulge);
          if (arc) {
            addArcToBBox(bb, arc.center.x, arc.center.y, ent.elevation, arc.radius, arc.startAngle, arc.sweepAngle);
          }
        }
        break;
      }
      case "POLYLINE":
        for (const v of ent.vertices) expandBBox(bb, v.x, v.y, v.z);
        break;
      case "ELLIPSE":
        for (const p of sampleEllipsePoints(ent, 64)) expandBBox(bb, p.x, p.y, p.z);
        break;
      case "SPLINE":
        for (const p of evaluateSplinePoints(ent, 48)) expandBBox(bb, p.x, p.y, p.z);
        break;
      case "3DFACE": {
        for (const v of ent.vertices) expandBBox(bb, v.x, v.y, v.z);
        const tris = triangulate3DFace(ent);
        for (const t of tris) {
          meshTriangles.push(t);
          totalMeshSurfaceArea += t.area;
        }
        break;
      }
      default:
        break;
    }
  }

  if (!Number.isFinite(bb.minX)) {
    bb.minX = bb.minY = bb.minZ = bb.maxX = bb.maxY = bb.maxZ = 0;
  }

  return {
    flatEntities,
    boundingBox: bb,
    totalPathLength,
    totalEnclosedArea,
    enclosedAreasByEntity,
    meshTriangles,
    totalMeshSurfaceArea,
    entityCounts,
  };
}

export interface DxfCadLoweringOptions {
  assemblyName?: string | undefined;
  extrusionHeight?: number | undefined;
  arcSegments?: number | undefined;
}

export interface DxfCadLoweringResult {
  assembly: Assembly;
  solids: Solid[];
  report: DxfGeometryReport;
}

/**
 * Lowers a DXF document into `@modelscript/cad` solids (`linearExtrude`, `cylinder`, `polyhedron`)
 * packaged inside an {@link Assembly}.
 */
export function lowerDxfToCad(doc: DxfDocument, options: DxfCadLoweringOptions = {}): DxfCadLoweringResult {
  const height = options.extrusionHeight ?? 10;
  const arcSegments = options.arcSegments ?? 16;
  const assemblyName = options.assemblyName ?? "DxfAssembly";
  const report = analyzeDxfGeometry(doc);

  const solids: Solid[] = [];
  const parts: PartEntry[] = [];
  let idx = 0;

  for (const ent of report.flatEntities) {
    if (ent.type === "LWPOLYLINE" && ent.closed && ent.vertices.length >= 2) {
      const poly: [number, number][] = [];
      const n = ent.vertices.length;
      for (let i = 0; i < n; i++) {
        const p1 = ent.vertices[i]!;
        const p2 = ent.vertices[(i + 1) % n]!;
        const pts = sampleBulgeArc(p1, p2, p1.bulge, arcSegments);
        for (let k = 0; k < pts.length - 1; k++) {
          poly.push([pts[k]!.x, pts[k]!.y]);
        }
      }
      if (poly.length >= 3) {
        const name = `Profile_${ent.layer}_${++idx}`;
        const solid = linearExtrude(poly, height, { name });
        const placed = ent.elevation !== 0 ? translate(solid, [0, 0, ent.elevation]) : solid;
        solids.push(placed);
        parts.push(part(placed));
      }
    } else if (ent.type === "POLYLINE" && ent.closed && ent.vertices.length >= 3) {
      const poly: [number, number][] = ent.vertices.map((v) => [v.x, v.y]);
      const name = `Polyline_${ent.layer}_${++idx}`;
      const solid = linearExtrude(poly, height, { name });
      solids.push(solid);
      parts.push(part(solid));
    } else if (ent.type === "CIRCLE" && ent.radius > 0) {
      const name = `Circle_${ent.layer}_${++idx}`;
      // @modelscript/cad cylinder axis is along Y; rotate +90deg around X to align with Z
      const cyl = cylinder({ radius: ent.radius, height, segments: Math.max(16, arcSegments), name });
      const placed = translate(rotate(cyl, [1, 0, 0], 90), [ent.center.x, ent.center.y, ent.center.z + height / 2]);
      solids.push(placed);
      parts.push(part(placed));
    }
  }

  // Group 3DFACE triangles into a polyhedron solid if present
  if (report.meshTriangles.length > 0) {
    const points: Vec3[] = [];
    const faces: number[][] = [];
    for (const tri of report.meshTriangles) {
      const base = points.length;
      points.push([tri.v0.x, tri.v0.y, tri.v0.z]);
      points.push([tri.v1.x, tri.v1.y, tri.v1.z]);
      points.push([tri.v2.x, tri.v2.y, tri.v2.z]);
      faces.push([base, base + 1, base + 2]);
    }
    const meshName = "Dxf3DFaceMesh";
    const meshSolid = polyhedron({ points, faces, name: meshName });
    solids.push(meshSolid);
    parts.push(part(meshSolid));
  }

  return {
    assembly: assembly(assemblyName, parts),
    solids,
    report,
  };
}
