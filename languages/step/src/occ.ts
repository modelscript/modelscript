// SPDX-License-Identifier: AGPL-3.0-or-later

import { scanStepEntities, type StepEntity } from "./schema.js";

export type Vec3 = [number, number, number];

export interface StepTessellationOptions {
  /** Number of circumferential/parametric subdivisions for curved edges and surfaces (default: 16). */
  segments?: number | undefined;
  /** Optional chordal deflection tolerance for adaptive curve/surface sampling. */
  chordalDeflection?: number | undefined;
}

export interface StepFacePatch {
  faceId: string;
  faceName?: string | undefined;
  surfaceId: string;
  surfaceType: string;
  sameSense: boolean;
  vertices: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  boundaryLoopPoints: Vec3[][];
  area?: number | undefined;
}

export interface StepMeshMassProperties {
  volume: number;
  surfaceArea: number;
  mass: number;
  density: number;
  centerOfMass: Vec3;
  covarianceMatrix: [Vec3, Vec3, Vec3];
  inertiaTensor: {
    I_11: number;
    I_22: number;
    I_33: number;
    I_21: number;
    I_31: number;
    I_32: number;
  };
  inertiaMatrix: [Vec3, Vec3, Vec3];
  crossSectionArea: {
    yz: number;
    xz: number;
    xy: number;
  };
}

export interface StepSolidMesh {
  name: string;
  solidId: string;
  vertices: Float32Array;
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  triangleCount: number;
  vertexCount: number;
  faceCount: number;
  faces: StepFacePatch[];
  surfaceTypes: string[];
  boundingBox: { min: Vec3; max: Vec3 };
  isWatertight: boolean;
  solids: StepSolidMesh[];
}

interface Axis2Placement3D {
  origin: Vec3;
  zAxis: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
}

// ── Vector Math Helpers ──────────────────────────────────────────────────────

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm3(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 1e-12 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 1];
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ── STEP Argument Parsing Helpers ────────────────────────────────────────────

/**
 * Splits a top-level comma-separated STEP argument string, respecting nested parentheses and strings.
 */
export function splitStepArgs(argsStr: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i]!;
    if (ch === "'") {
      if (inString && argsStr[i + 1] === "'") {
        i++;
        continue;
      }
      inString = !inString;
    } else if (!inString) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        result.push(argsStr.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  const tail = argsStr.slice(start).trim();
  if (tail.length > 0) result.push(tail);
  return result;
}

function stripOuterParens(s: string): string {
  const t = s.trim();
  if (t.startsWith("(") && t.endsWith(")")) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function parseStepString(s: string | undefined): string {
  if (!s) return "";
  const t = s.trim();
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

function parseStepBool(s: string | undefined, defaultVal = true): boolean {
  if (!s) return defaultVal;
  const t = s.trim().toUpperCase();
  if (t === ".F." || t === "FALSE") return false;
  if (t === ".T." || t === "TRUE") return true;
  return defaultVal;
}

function parseRefList(s: string | undefined): string[] {
  if (!s) return [];
  const inner = stripOuterParens(s);
  if (!inner) return [];
  return splitStepArgs(inner).filter((tok) => tok.startsWith("#"));
}

function parseNumberList(s: string | undefined): number[] {
  if (!s) return [];
  const inner = stripOuterParens(s);
  if (!inner) return [];
  return splitStepArgs(inner).map((tok) => Number(tok));
}

// ── Entity Resolution Context ────────────────────────────────────────────────

class StepBrepResolver {
  public entities = new Map<string, StepEntity>();
  private pointCache = new Map<string, Vec3>();
  private dirCache = new Map<string, Vec3>();
  private axisCache = new Map<string, Axis2Placement3D>();

  constructor(
    stepText: string,
    public segments: number,
  ) {
    for (const ent of scanStepEntities(stepText)) {
      this.entities.set(ent.id, ent);
    }
  }

  public getPoint(id: string | undefined): Vec3 {
    if (!id || !id.startsWith("#")) return [0, 0, 0];
    const cached = this.pointCache.get(id);
    if (cached) return cached;
    const ent = this.entities.get(id);
    if (!ent) return [0, 0, 0];

    if (ent.type === "VERTEX_POINT") {
      const args = splitStepArgs(ent.args);
      const pt = this.getPoint(args[1]);
      this.pointCache.set(id, pt);
      return pt;
    }

    if (ent.type === "CARTESIAN_POINT") {
      const args = splitStepArgs(ent.args);
      const coords = parseNumberList(args[1]);
      const pt: Vec3 = [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0];
      this.pointCache.set(id, pt);
      return pt;
    }

    return [0, 0, 0];
  }

  public getDirection(id: string | undefined, fallback: Vec3 = [0, 0, 1]): Vec3 {
    if (!id || !id.startsWith("#")) return fallback;
    const cached = this.dirCache.get(id);
    if (cached) return cached;
    const ent = this.entities.get(id);
    if (!ent) return fallback;

    if (ent.type === "DIRECTION") {
      const args = splitStepArgs(ent.args);
      const coords = parseNumberList(args[1]);
      const dir = norm3([coords[0] ?? fallback[0], coords[1] ?? fallback[1], coords[2] ?? fallback[2]]);
      this.dirCache.set(id, dir);
      return dir;
    }

    if (ent.type === "VECTOR") {
      const args = splitStepArgs(ent.args);
      return this.getDirection(args[1], fallback);
    }

    return fallback;
  }

  public getAxis2Placement3D(id: string | undefined): Axis2Placement3D {
    const defaultFrame: Axis2Placement3D = {
      origin: [0, 0, 0],
      zAxis: [0, 0, 1],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
    };
    if (!id || !id.startsWith("#")) return defaultFrame;
    const cached = this.axisCache.get(id);
    if (cached) return cached;
    const ent = this.entities.get(id);
    if (!ent || ent.type !== "AXIS2_PLACEMENT_3D") return defaultFrame;

    const args = splitStepArgs(ent.args);
    const origin = this.getPoint(args[1]);
    const zAxis: Vec3 = args[2] && args[2].startsWith("#") ? this.getDirection(args[2], [0, 0, 1]) : [0, 0, 1];
    let refDir: Vec3 =
      args[3] && args[3].startsWith("#")
        ? this.getDirection(args[3], [1, 0, 0])
        : Math.abs(zAxis[2]) < 0.9
          ? [0, 0, 1]
          : [1, 0, 0];

    // Gram-Schmidt orthonormalization
    const proj = dot3(refDir, zAxis);
    let xRaw = sub3(refDir, scale3(zAxis, proj));
    if (Math.hypot(xRaw[0], xRaw[1], xRaw[2]) < 1e-9) {
      refDir = Math.abs(zAxis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      xRaw = sub3(refDir, scale3(zAxis, dot3(refDir, zAxis)));
    }
    const xAxis = norm3(xRaw);
    const yAxis = norm3(cross3(zAxis, xAxis));

    const frame: Axis2Placement3D = { origin, zAxis, xAxis, yAxis };
    this.axisCache.set(id, frame);
    return frame;
  }

  /**
   * Samples an `EDGE_CURVE` into an ordered list of 3D points according to `orientedSense`.
   */
  public sampleOrientedEdge(orientedEdgeId: string): Vec3[] {
    const oeEnt = this.entities.get(orientedEdgeId);
    if (!oeEnt || oeEnt.type !== "ORIENTED_EDGE") return [];
    const oeArgs = splitStepArgs(oeEnt.args);
    // ORIENTED_EDGE(name, edge_start, edge_end, edge_element, orientation)
    const edgeCurveId = oeArgs[3];
    const oeSense = parseStepBool(oeArgs[4], true);
    if (!edgeCurveId || !edgeCurveId.startsWith("#")) return [];

    const ecEnt = this.entities.get(edgeCurveId);
    if (!ecEnt) return [];
    const ecArgs = splitStepArgs(ecEnt.args);
    // EDGE_CURVE(name, edge_start, edge_end, edge_geometry, same_sense)
    const vStart = this.getPoint(ecArgs[1]);
    const vEnd = this.getPoint(ecArgs[2]);
    const curveGeomId = ecArgs[3];
    const ecSense = parseStepBool(ecArgs[4], true);
    const forward = oeSense === ecSense;

    const pts = this.sampleCurveGeometry(curveGeomId, vStart, vEnd, ecSense);
    if (!forward) {
      pts.reverse();
    }
    return pts;
  }

  private sampleCurveGeometry(curveId: string | undefined, vStart: Vec3, vEnd: Vec3, sameSense: boolean): Vec3[] {
    if (!curveId || !curveId.startsWith("#")) return [vStart, vEnd];
    const curveEnt = this.entities.get(curveId);
    if (!curveEnt) return [vStart, vEnd];

    if (curveEnt.type === "LINE") {
      return [vStart, vEnd];
    }

    if (curveEnt.type === "CIRCLE" || curveEnt.type === "ELLIPSE") {
      const cArgs = splitStepArgs(curveEnt.args);
      const frame = this.getAxis2Placement3D(cArgs[1]);
      const r1 = Math.max(1e-6, Number(cArgs[2] ?? 1));
      const r2 = curveEnt.type === "ELLIPSE" ? Math.max(1e-6, Number(cArgs[3] ?? r1)) : r1;

      const relStart = sub3(vStart, frame.origin);
      const relEnd = sub3(vEnd, frame.origin);
      const u0 = Math.atan2(dot3(relStart, frame.yAxis) / r2, dot3(relStart, frame.xAxis) / r1);
      let u1 = Math.atan2(dot3(relEnd, frame.yAxis) / r2, dot3(relEnd, frame.xAxis) / r1);

      const isClosed = dist3(vStart, vEnd) < 1e-5;
      if (isClosed) {
        u1 = sameSense ? u0 + 2 * Math.PI : u0 - 2 * Math.PI;
      } else if (sameSense) {
        while (u1 <= u0 + 1e-6) u1 += 2 * Math.PI;
      } else {
        while (u1 >= u0 - 1e-6) u1 -= 2 * Math.PI;
      }

      const span = Math.abs(u1 - u0);
      const steps = Math.max(4, Math.ceil((span / (2 * Math.PI)) * this.segments));
      const pts: Vec3[] = [];
      for (let i = 0; i <= steps; i++) {
        if (i === 0 && !isClosed) {
          pts.push(vStart);
          continue;
        }
        if (i === steps && !isClosed) {
          pts.push(vEnd);
          continue;
        }
        const u = u0 + (i / steps) * (u1 - u0);
        const p = add3(
          frame.origin,
          add3(scale3(frame.xAxis, r1 * Math.cos(u)), scale3(frame.yAxis, r2 * Math.sin(u))),
        );
        pts.push(p);
      }
      return pts;
    }

    if (
      curveEnt.type === "B_SPLINE_CURVE_WITH_KNOTS" ||
      curveEnt.type === "B_SPLINE_CURVE" ||
      curveEnt.type === "BEZIER_CURVE"
    ) {
      const cArgs = splitStepArgs(curveEnt.args);
      const degree = Math.max(1, Number(cArgs[1] ?? 1));
      const ctrlRefs = parseRefList(cArgs[2]);
      if (ctrlRefs.length >= 2) {
        const ctrlPts = ctrlRefs.map((ref) => this.getPoint(ref));
        const steps = Math.max(4, Math.min(this.segments, ctrlPts.length * 4));
        const pts: Vec3[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          pts.push(evaluateBsplineCurve(ctrlPts, degree, t));
        }
        return pts;
      }
    }

    return [vStart, vEnd];
  }

  /**
   * Resolves a `FACE_OUTER_BOUND` or `FACE_BOUND` into an ordered 3D polygon loop.
   */
  public resolveFaceBound(boundId: string): { isOuter: boolean; points: Vec3[] } | null {
    const boundEnt = this.entities.get(boundId);
    if (!boundEnt) return null;
    const isOuter = boundEnt.type === "FACE_OUTER_BOUND";
    const bArgs = splitStepArgs(boundEnt.args);
    const loopId = bArgs[1];
    const boundSense = parseStepBool(bArgs[2], true);
    if (!loopId || !loopId.startsWith("#")) return null;

    const loopEnt = this.entities.get(loopId);
    if (!loopEnt) return null;

    if (loopEnt.type === "POLY_LOOP") {
      const lArgs = splitStepArgs(loopEnt.args);
      const ptRefs = parseRefList(lArgs[1]);
      const pts = ptRefs.map((r) => this.getPoint(r));
      if (!boundSense) pts.reverse();
      return { isOuter, points: pts };
    }

    if (loopEnt.type === "VERTEX_LOOP") {
      const lArgs = splitStepArgs(loopEnt.args);
      return { isOuter, points: [this.getPoint(lArgs[1])] };
    }

    if (loopEnt.type === "EDGE_LOOP") {
      const lArgs = splitStepArgs(loopEnt.args);
      const oeRefs = parseRefList(lArgs[1]);
      const loopPts: Vec3[] = [];
      for (const oeId of oeRefs) {
        const edgePts = this.sampleOrientedEdge(oeId);
        for (const p of edgePts) {
          if (loopPts.length === 0 || dist3(loopPts[loopPts.length - 1]!, p) > 1e-6) {
            loopPts.push(p);
          }
        }
      }
      if (loopPts.length > 1 && dist3(loopPts[0]!, loopPts[loopPts.length - 1]!) < 1e-5) {
        loopPts.pop();
      }
      if (!boundSense) loopPts.reverse();
      return { isOuter, points: loopPts };
    }

    return null;
  }
}

// ── B-Spline Curve & Tensor-Product Surface Evaluation (De Boor / Bernstein) ─

function evaluateBsplineCurve(ctrlPts: Vec3[], degree: number, t: number): Vec3 {
  const n = ctrlPts.length - 1;
  if (n <= 0) return ctrlPts[0] ?? [0, 0, 0];
  const p = Math.min(degree, n);
  // Clamped uniform knot vector of length n + p + 2
  const m = n + p + 1;
  const knots = new Float64Array(m + 1);
  for (let i = 0; i <= m; i++) {
    if (i <= p) knots[i] = 0;
    else if (i >= m - p) knots[i] = 1;
    else knots[i] = (i - p) / (m - 2 * p);
  }
  return deBoorCurve(ctrlPts, p, knots, Math.max(0, Math.min(1, t)));
}

function deBoorCurve(ctrlPts: Vec3[], p: number, knots: ArrayLike<number>, u: number): Vec3 {
  const n = ctrlPts.length - 1;
  const uMin = knots[p]!;
  const uMax = knots[n + 1]!;
  const uClamped = Math.max(uMin, Math.min(uMax, u));

  // Find knot span k such that knots[k] <= uClamped < knots[k+1]
  let k = p;
  for (let i = p; i <= n; i++) {
    if (uClamped >= knots[i]! && uClamped <= knots[i + 1]!) {
      k = i;
      if (uClamped < knots[i + 1]!) break;
    }
  }

  const d: Vec3[] = [];
  for (let j = 0; j <= p; j++) {
    const idx = Math.max(0, Math.min(n, k - p + j));
    const pt = ctrlPts[idx]!;
    d.push([pt[0], pt[1], pt[2]]);
  }

  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const denom = knots[i + p - r + 1]! - knots[i]!;
      const alpha = Math.abs(denom) > 1e-12 ? (uClamped - knots[i]!) / denom : 0;
      const prev = d[j - 1]!;
      const curr = d[j]!;
      d[j] = [
        (1 - alpha) * prev[0] + alpha * curr[0],
        (1 - alpha) * prev[1] + alpha * curr[1],
        (1 - alpha) * prev[2] + alpha * curr[2],
      ];
    }
  }

  return d[p]!;
}

function expandKnots(knotValues: number[], multiplicities: number[], nCtrl: number, degree: number): Float64Array {
  if (knotValues.length > 0 && knotValues.length === multiplicities.length) {
    const expanded: number[] = [];
    for (let i = 0; i < knotValues.length; i++) {
      const mult = Math.max(1, Math.round(multiplicities[i]!));
      for (let m = 0; m < mult; m++) expanded.push(knotValues[i]!);
    }
    if (expanded.length >= nCtrl + degree + 1) {
      return new Float64Array(expanded);
    }
  }
  // Fallback: clamped uniform knots in [0, 1]
  const p = Math.min(degree, Math.max(1, nCtrl - 1));
  const m = nCtrl + p;
  const knots = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    if (i <= p) knots[i] = 0;
    else if (i >= m - p - 1) knots[i] = 1;
    else knots[i] = (i - p) / (m - 2 * p - 1);
  }
  return knots;
}

// ── 2D Polygon Ear-Clipping with Hole Bridging ──────────────────────────────

interface Pt2D {
  u: number;
  v: number;
  pt3: Vec3;
}

function signedArea2D(poly: Pt2D[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.u * b.v - b.u * a.v;
  }
  return 0.5 * area;
}

function pointInTriangle2D(p: Pt2D, a: Pt2D, b: Pt2D, c: Pt2D): boolean {
  const c1 = (b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u);
  const c2 = (c.u - b.u) * (p.v - b.v) - (c.v - b.v) * (p.u - b.u);
  const c3 = (a.u - c.u) * (p.v - c.v) - (a.v - c.v) * (p.u - c.u);
  return c1 >= -1e-9 && c2 >= -1e-9 && c3 >= -1e-9;
}

/**
 * Merges inner hole rings into an outer CCW 2D polygon using bridge edges, then ear-clips.
 */
function triangulatePlanarFaceWithHoles(
  outerLoop: Vec3[],
  innerLoops: Vec3[][],
  frame: Axis2Placement3D,
  normalSign: number,
): { vertices: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const project = (pts: Vec3[]): Pt2D[] =>
    pts.map((pt3) => {
      const rel = sub3(pt3, frame.origin);
      return {
        u: dot3(rel, frame.xAxis),
        v: dot3(rel, frame.yAxis),
        pt3,
      };
    });

  let outer2D = project(outerLoop);
  if (outer2D.length < 3) {
    return { vertices: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) };
  }
  // Ensure outer polygon is CCW in (u, v)
  if (signedArea2D(outer2D) < 0) {
    outer2D = [...outer2D].reverse();
  }

  // Bridge each inner hole into outer2D (sorted by rightmost u coordinate)
  const holes2D = innerLoops
    .filter((h) => h.length >= 3)
    .map((h) => {
      const h2 = project(h);
      // Ensure hole is CW in (u, v)
      return signedArea2D(h2) > 0 ? [...h2].reverse() : h2;
    });

  for (const hole of holes2D) {
    // Find vertex in hole with maximum u
    let holeMaxIdx = 0;
    for (let i = 1; i < hole.length; i++) {
      if (hole[i]!.u > hole[holeMaxIdx]!.u) holeMaxIdx = i;
    }
    const hPt = hole[holeMaxIdx]!;

    // Find closest visible vertex on outer2D to the right (or nearest overall)
    let bestOuterIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < outer2D.length; i++) {
      const oPt = outer2D[i]!;
      const d = Math.hypot(oPt.u - hPt.u, oPt.v - hPt.v) + (oPt.u >= hPt.u ? 0 : 1000);
      if (d < bestDist) {
        bestDist = d;
        bestOuterIdx = i;
      }
    }

    // Splice hole into outer2D at bestOuterIdx via bridge
    const merged: Pt2D[] = [];
    for (let i = 0; i <= bestOuterIdx; i++) merged.push(outer2D[i]!);
    for (let i = 0; i <= hole.length; i++) {
      merged.push(hole[(holeMaxIdx + i) % hole.length]!);
    }
    merged.push(outer2D[bestOuterIdx]!);
    for (let i = bestOuterIdx + 1; i < outer2D.length; i++) merged.push(outer2D[i]!);
    outer2D = merged;
  }

  // Ear-clipping on outer2D
  const verts = outer2D.map((p) => p.pt3);
  const avail = outer2D.map((_, i) => i);
  const triIndices: number[] = [];

  let guard = avail.length * avail.length + 16;
  while (avail.length > 3 && guard-- > 0) {
    let earFound = false;
    const m = avail.length;
    for (let i = 0; i < m; i++) {
      const iPrev = avail[(i + m - 1) % m]!;
      const iCurr = avail[i]!;
      const iNext = avail[(i + 1) % m]!;
      const a = outer2D[iPrev]!;
      const b = outer2D[iCurr]!;
      const c = outer2D[iNext]!;

      const cross = (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
      if (cross <= 1e-9) continue;

      let hasInside = false;
      for (let j = 0; j < m; j++) {
        const idx = avail[j]!;
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = outer2D[idx]!;
        if (
          Math.hypot(p.u - a.u, p.v - a.v) < 1e-7 ||
          Math.hypot(p.u - b.u, p.v - b.v) < 1e-7 ||
          Math.hypot(p.u - c.u, p.v - c.v) < 1e-7
        ) {
          continue;
        }
        if (pointInTriangle2D(p, a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        if (normalSign >= 0) {
          triIndices.push(iPrev, iCurr, iNext);
        } else {
          triIndices.push(iPrev, iNext, iCurr);
        }
        avail.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      const iPrev = avail[0]!;
      const iCurr = avail[1]!;
      const iNext = avail[2]!;
      if (normalSign >= 0) {
        triIndices.push(iPrev, iCurr, iNext);
      } else {
        triIndices.push(iPrev, iNext, iCurr);
      }
      avail.splice(1, 1);
    }
  }

  if (avail.length === 3) {
    if (normalSign >= 0) {
      triIndices.push(avail[0]!, avail[1]!, avail[2]!);
    } else {
      triIndices.push(avail[0]!, avail[2]!, avail[1]!);
    }
  }

  const n = scale3(frame.zAxis, normalSign);
  const vertices = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    vertices[i * 3] = v[0];
    vertices[i * 3 + 1] = v[1];
    vertices[i * 3 + 2] = v[2];
    normals[i * 3] = n[0];
    normals[i * 3 + 1] = n[1];
    normals[i * 3 + 2] = n[2];
  }

  return {
    vertices,
    indices: new Uint32Array(triIndices),
    normals,
  };
}

// ── Analytic & NURBS Surface Patch Tessellation ──────────────────────────────

function tessellateSurfacePatch(
  resolver: StepBrepResolver,
  faceId: string,
  surfaceId: string,
  sameSense: boolean,
  outerLoop: Vec3[],
  innerLoops: Vec3[][],
): StepFacePatch {
  const surfEnt = resolver.entities.get(surfaceId);
  const surfType = surfEnt?.type ?? "PLANE";
  const normalSign = sameSense ? 1 : -1;
  const allLoopPts = [outerLoop, ...innerLoops].flat();

  if (!surfEnt || surfType === "PLANE") {
    const sArgs = surfEnt ? splitStepArgs(surfEnt.args) : [];
    const frame = resolver.getAxis2Placement3D(sArgs[1]);
    const mesh = triangulatePlanarFaceWithHoles(outerLoop, innerLoops, frame, normalSign);
    return {
      faceId,
      surfaceId,
      surfaceType: "PLANE",
      sameSense,
      vertices: mesh.vertices,
      indices: mesh.indices,
      normals: mesh.normals,
      boundaryLoopPoints: [outerLoop, ...innerLoops].filter((l) => l.length > 0),
    };
  }

  if (surfType === "CYLINDRICAL_SURFACE") {
    const sArgs = splitStepArgs(surfEnt.args);
    const frame = resolver.getAxis2Placement3D(sArgs[1]);
    const radius = Math.max(1e-6, Number(sArgs[2] ?? 1));

    let vMin = Infinity;
    let vMax = -Infinity;
    const angles: number[] = [];
    for (const pt of allLoopPts) {
      const rel = sub3(pt, frame.origin);
      const v = dot3(rel, frame.zAxis);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
      const u = Math.atan2(dot3(rel, frame.yAxis), dot3(rel, frame.xAxis));
      angles.push(u);
    }
    if (!Number.isFinite(vMin) || Math.abs(vMax - vMin) < 1e-6) {
      vMin = 0;
      vMax = radius * 2;
    }

    // Determine angular span
    let u0 = 0;
    let u1 = 2 * Math.PI;
    if (angles.length >= 2) {
      const minA = Math.min(...angles);
      const maxA = Math.max(...angles);
      if (maxA - minA > 1e-3 && maxA - minA < 1.85 * Math.PI) {
        u0 = minA;
        u1 = maxA;
      }
    }

    const uSteps = Math.max(8, resolver.segments);
    const vSteps = Math.max(2, Math.floor(resolver.segments / 4));
    return buildUvGridPatch(
      faceId,
      surfaceId,
      surfType,
      sameSense,
      uSteps,
      vSteps,
      (s, t) => {
        const u = u0 + s * (u1 - u0);
        const v = vMin + t * (vMax - vMin);
        const radial = add3(scale3(frame.xAxis, Math.cos(u)), scale3(frame.yAxis, Math.sin(u)));
        const pos = add3(frame.origin, add3(scale3(radial, radius), scale3(frame.zAxis, v)));
        const norm = scale3(radial, normalSign);
        return { pos, norm };
      },
      [outerLoop, ...innerLoops].filter((l) => l.length > 0),
    );
  }

  if (surfType === "CONICAL_SURFACE") {
    const sArgs = splitStepArgs(surfEnt.args);
    const frame = resolver.getAxis2Placement3D(sArgs[1]);
    const baseRadius = Math.max(0, Number(sArgs[2] ?? 1));
    const semiAngle = Number(sArgs[3] ?? 0.25);
    const tanAlpha = Math.tan(semiAngle);
    const cosAlpha = Math.cos(semiAngle);
    const sinAlpha = Math.sin(semiAngle);

    let vMin = Infinity;
    let vMax = -Infinity;
    for (const pt of allLoopPts) {
      const rel = sub3(pt, frame.origin);
      const v = dot3(rel, frame.zAxis);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    if (!Number.isFinite(vMin) || Math.abs(vMax - vMin) < 1e-6) {
      vMin = 0;
      vMax = Math.max(1, baseRadius);
    }

    const uSteps = Math.max(8, resolver.segments);
    const vSteps = Math.max(2, Math.floor(resolver.segments / 4));
    return buildUvGridPatch(
      faceId,
      surfaceId,
      surfType,
      sameSense,
      uSteps,
      vSteps,
      (s, t) => {
        const u = s * 2 * Math.PI;
        const v = vMin + t * (vMax - vMin);
        const r = Math.max(0, baseRadius + v * tanAlpha);
        const radial = add3(scale3(frame.xAxis, Math.cos(u)), scale3(frame.yAxis, Math.sin(u)));
        const pos = add3(frame.origin, add3(scale3(radial, r), scale3(frame.zAxis, v)));
        const norm = scale3(norm3(sub3(scale3(radial, cosAlpha), scale3(frame.zAxis, sinAlpha))), normalSign);
        return { pos, norm };
      },
      [outerLoop, ...innerLoops].filter((l) => l.length > 0),
    );
  }

  if (surfType === "SPHERICAL_SURFACE") {
    const sArgs = splitStepArgs(surfEnt.args);
    const frame = resolver.getAxis2Placement3D(sArgs[1]);
    const radius = Math.max(1e-6, Number(sArgs[2] ?? 1));

    let vMin = -Math.PI / 2;
    let vMax = Math.PI / 2;
    if (allLoopPts.length >= 2) {
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const pt of allLoopPts) {
        const z = dot3(sub3(pt, frame.origin), frame.zAxis);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      if (maxZ - minZ > 1e-4 && (minZ > -radius * 0.99 || maxZ < radius * 0.99)) {
        vMin = Math.asin(Math.max(-1, Math.min(1, minZ / radius)));
        vMax = Math.asin(Math.max(-1, Math.min(1, maxZ / radius)));
      }
    }

    const uSteps = Math.max(8, resolver.segments);
    const vSteps = Math.max(6, Math.floor(resolver.segments / 2));
    return buildUvGridPatch(
      faceId,
      surfaceId,
      surfType,
      sameSense,
      uSteps,
      vSteps,
      (s, t) => {
        const u = s * 2 * Math.PI;
        const v = vMin + t * (vMax - vMin);
        const dir = add3(
          add3(scale3(frame.xAxis, Math.cos(v) * Math.cos(u)), scale3(frame.yAxis, Math.cos(v) * Math.sin(u))),
          scale3(frame.zAxis, Math.sin(v)),
        );
        const pos = add3(frame.origin, scale3(dir, radius));
        const norm = scale3(norm3(dir), normalSign);
        return { pos, norm };
      },
      [outerLoop, ...innerLoops].filter((l) => l.length > 0),
    );
  }

  if (surfType === "TOROIDAL_SURFACE") {
    const sArgs = splitStepArgs(surfEnt.args);
    const frame = resolver.getAxis2Placement3D(sArgs[1]);
    const majorR = Math.max(1e-6, Number(sArgs[2] ?? 5));
    const minorR = Math.max(1e-6, Number(sArgs[3] ?? 1));

    const uSteps = Math.max(8, resolver.segments);
    const vSteps = Math.max(8, Math.floor(resolver.segments / 2));
    return buildUvGridPatch(
      faceId,
      surfaceId,
      surfType,
      sameSense,
      uSteps,
      vSteps,
      (s, t) => {
        const u = s * 2 * Math.PI;
        const v = t * 2 * Math.PI;
        const radial = add3(scale3(frame.xAxis, Math.cos(u)), scale3(frame.yAxis, Math.sin(u)));
        const rEff = majorR + minorR * Math.cos(v);
        const pos = add3(frame.origin, add3(scale3(radial, rEff), scale3(frame.zAxis, minorR * Math.sin(v))));
        const normalDir = add3(scale3(radial, Math.cos(v)), scale3(frame.zAxis, Math.sin(v)));
        return { pos, norm: scale3(norm3(normalDir), normalSign) };
      },
      [outerLoop, ...innerLoops].filter((l) => l.length > 0),
    );
  }

  if (
    surfType === "B_SPLINE_SURFACE_WITH_KNOTS" ||
    surfType === "B_SPLINE_SURFACE" ||
    surfType === "BOUNDED_SURFACE" ||
    surfType === "COMPLEX_ENTITY"
  ) {
    // Extract B-spline control grid: B_SPLINE_SURFACE_WITH_KNOTS(name, u_deg, v_deg, ((#p00, #p01), (#p10, #p11)), form, u_closed, v_closed, self_intersect, u_mults, v_mults, u_knots, v_knots, ...)
    const sArgs = splitStepArgs(surfEnt.args);
    const uDeg = Math.max(1, Number(sArgs[1] ?? 1));
    const vDeg = Math.max(1, Number(sArgs[2] ?? 1));
    const gridRowsRaw = splitStepArgs(stripOuterParens(sArgs[3] ?? ""));
    const ctrlGrid: Vec3[][] = [];
    for (const rowStr of gridRowsRaw) {
      const refs = parseRefList(rowStr);
      if (refs.length > 0) {
        ctrlGrid.push(refs.map((r) => resolver.getPoint(r)));
      }
    }

    if (ctrlGrid.length >= 2 && ctrlGrid[0]!.length >= 2) {
      const nU = ctrlGrid.length;
      const nV = ctrlGrid[0]!.length;
      const uMults = parseNumberList(sArgs[8]);
      const vMults = parseNumberList(sArgs[9]);
      const uKnotsRaw = parseNumberList(sArgs[10]);
      const vKnotsRaw = parseNumberList(sArgs[11]);
      const uKnots = expandKnots(uKnotsRaw, uMults, nU, uDeg);
      const vKnots = expandKnots(vKnotsRaw, vMults, nV, vDeg);
      const pU = Math.min(uDeg, nU - 1);
      const pV = Math.min(vDeg, nV - 1);
      const uMin = uKnots[pU]!;
      const uMax = uKnots[nU]!;
      const vMin = vKnots[pV]!;
      const vMax = vKnots[nV]!;

      const evalSurface = (s: number, t: number): Vec3 => {
        const u = uMin + s * (uMax - uMin);
        const v = vMin + t * (vMax - vMin);
        const colPts: Vec3[] = [];
        for (let i = 0; i < nU; i++) {
          colPts.push(deBoorCurve(ctrlGrid[i]!, pV, vKnots, v));
        }
        return deBoorCurve(colPts, pU, uKnots, u);
      };

      const steps = Math.max(6, Math.floor(resolver.segments / 2));
      const eps = 1e-4;
      return buildUvGridPatch(
        faceId,
        surfaceId,
        surfType,
        sameSense,
        steps,
        steps,
        (s, t) => {
          const pos = evalSurface(s, t);
          const pu = evalSurface(Math.min(1, s + eps), t);
          const pv = evalSurface(s, Math.min(1, t + eps));
          const du = sub3(pu, pos);
          const dv = sub3(pv, pos);
          const norm = scale3(norm3(cross3(du, dv)), normalSign);
          return { pos, norm };
        },
        [outerLoop, ...innerLoops].filter((l) => l.length > 0),
      );
    }
  }

  // Fallback for unknown surface types: fan triangulate outerLoop
  if (outerLoop.length >= 3) {
    const e1 = sub3(outerLoop[1]!, outerLoop[0]!);
    const e2 = sub3(outerLoop[2]!, outerLoop[0]!);
    const zAxis = norm3(cross3(e1, e2));
    const xAxis = norm3(e1);
    const yAxis = norm3(cross3(zAxis, xAxis));
    const fallbackFrame: Axis2Placement3D = { origin: outerLoop[0]!, zAxis, xAxis, yAxis };
    const mesh = triangulatePlanarFaceWithHoles(outerLoop, innerLoops, fallbackFrame, normalSign);
    return {
      faceId,
      surfaceId,
      surfaceType: surfType,
      sameSense,
      vertices: mesh.vertices,
      indices: mesh.indices,
      normals: mesh.normals,
      boundaryLoopPoints: [outerLoop, ...innerLoops].filter((l) => l.length > 0),
    };
  }

  return {
    faceId,
    surfaceId,
    surfaceType: surfType,
    sameSense,
    vertices: new Float32Array(0),
    indices: new Uint32Array(0),
    normals: new Float32Array(0),
    boundaryLoopPoints: [],
  };
}

function buildUvGridPatch(
  faceId: string,
  surfaceId: string,
  surfaceType: string,
  sameSense: boolean,
  uSteps: number,
  vSteps: number,
  evalPoint: (s: number, t: number) => { pos: Vec3; norm: Vec3 },
  boundaryLoopPoints: Vec3[][],
): StepFacePatch {
  const numVerts = (uSteps + 1) * (vSteps + 1);
  const vertices = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);
  const indices: number[] = [];

  let ptr = 0;
  for (let iv = 0; iv <= vSteps; iv++) {
    const t = iv / vSteps;
    for (let iu = 0; iu <= uSteps; iu++) {
      const s = iu / uSteps;
      const { pos, norm } = evalPoint(s, t);
      vertices[ptr] = pos[0];
      vertices[ptr + 1] = pos[1];
      vertices[ptr + 2] = pos[2];
      normals[ptr] = norm[0];
      normals[ptr + 1] = norm[1];
      normals[ptr + 2] = norm[2];
      ptr += 3;
    }
  }

  const stride = uSteps + 1;
  for (let iv = 0; iv < vSteps; iv++) {
    for (let iu = 0; iu < uSteps; iu++) {
      const i00 = iv * stride + iu;
      const i10 = i00 + 1;
      const i01 = (iv + 1) * stride + iu;
      const i11 = i01 + 1;
      if (sameSense) {
        indices.push(i00, i10, i11, i00, i11, i01);
      } else {
        indices.push(i00, i11, i10, i00, i01, i11);
      }
    }
  }

  return {
    faceId,
    surfaceId,
    surfaceType,
    sameSense,
    vertices,
    indices: new Uint32Array(indices),
    normals,
    boundaryLoopPoints,
  };
}

// ── Top-Level B-Rep Solid Tessellation ───────────────────────────────────────

function combineFacePatches(
  name: string,
  solidId: string,
  faces: StepFacePatch[],
  isClosedShell: boolean,
): StepSolidMesh {
  let totalVerts = 0;
  let totalIndices = 0;
  const surfaceTypeSet = new Set<string>();

  for (const f of faces) {
    totalVerts += f.vertices.length / 3;
    totalIndices += f.indices.length;
    surfaceTypeSet.add(f.surfaceType);
  }

  const vertices = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const f of faces) {
    vertices.set(f.vertices, vOffset * 3);
    normals.set(f.normals, vOffset * 3);
    for (let k = 0; k < f.vertices.length; k += 3) {
      const x = f.vertices[k]!;
      const y = f.vertices[k + 1]!;
      const z = f.vertices[k + 2]!;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    for (let k = 0; k < f.indices.length; k++) {
      indices[iOffset + k] = f.indices[k]! + vOffset;
    }
    vOffset += f.vertices.length / 3;
    iOffset += f.indices.length;
  }

  if (!Number.isFinite(min[0])) {
    min[0] = 0;
    min[1] = 0;
    min[2] = 0;
    max[0] = 0;
    max[1] = 0;
    max[2] = 0;
  }

  return {
    name,
    solidId,
    vertices,
    positions: vertices,
    indices,
    normals,
    triangleCount: Math.floor(indices.length / 3),
    vertexCount: totalVerts,
    faceCount: faces.length,
    faces,
    surfaceTypes: [...surfaceTypeSet],
    boundingBox: { min, max },
    isWatertight: isClosedShell && faces.length > 0 && indices.length >= 3,
    solids: [],
  };
}

/**
 * Tessellates an ISO 10303-21 STEP B-Rep model into triangulated 3D surface meshes by traversing
 * `MANIFOLD_SOLID_BREP` -> `CLOSED_SHELL` / `OPEN_SHELL` -> `ADVANCED_FACE` -> `FACE_OUTER_BOUND` / `FACE_BOUND`
 * -> `EDGE_LOOP` / `POLY_LOOP` -> `ORIENTED_EDGE` -> `EDGE_CURVE` -> `VERTEX_POINT` -> `CARTESIAN_POINT`
 * and evaluating analytic (`PLANE`, `CYLINDRICAL_SURFACE`, `SPHERICAL_SURFACE`, `CONICAL_SURFACE`,
 * `TOROIDAL_SURFACE`) and spline (`B_SPLINE_SURFACE_WITH_KNOTS`) surface patches.
 */
export function tessellateStepSolid(stepText: string, options?: StepTessellationOptions): StepSolidMesh {
  const segments = Math.max(8, options?.segments ?? 16);
  const resolver = new StepBrepResolver(stepText, segments);

  const tessellateFaceEntity = (faceId: string): StepFacePatch | null => {
    const faceEnt = resolver.entities.get(faceId);
    if (!faceEnt || (faceEnt.type !== "ADVANCED_FACE" && faceEnt.type !== "FACE_SURFACE")) {
      return null;
    }
    // ADVANCED_FACE(name, (bound1, bound2, ...), face_geometry, same_sense)
    const fArgs = splitStepArgs(faceEnt.args);
    const rawFaceName = parseStepString(fArgs[0]);
    const boundRefs = parseRefList(fArgs[1]);
    const surfaceId = fArgs[2] ?? "";
    const sameSense = parseStepBool(fArgs[3], true);

    let surfName = "";
    const surfEnt = resolver.entities.get(surfaceId);
    if (surfEnt) {
      const sArgs = splitStepArgs(surfEnt.args);
      surfName = parseStepString(sArgs[0]);
    }
    const faceName = rawFaceName || surfName || `face_${faceId.replace("#", "")}`;

    let outerLoop: Vec3[] = [];
    const innerLoops: Vec3[][] = [];
    for (const bId of boundRefs) {
      const resolved = resolver.resolveFaceBound(bId);
      if (!resolved || resolved.points.length === 0) continue;
      if (resolved.isOuter || outerLoop.length === 0) {
        if (outerLoop.length > 0 && resolved.isOuter) {
          innerLoops.push(outerLoop);
        }
        outerLoop = resolved.points;
      } else {
        innerLoops.push(resolved.points);
      }
    }

    const patch = tessellateSurfacePatch(resolver, faceId, surfaceId, sameSense, outerLoop, innerLoops);
    patch.faceName = faceName;
    let patchArea = 0;
    for (let i = 0; i + 2 < patch.indices.length; i += 3) {
      const i0 = patch.indices[i]! * 3;
      const i1 = patch.indices[i + 1]! * 3;
      const i2 = patch.indices[i + 2]! * 3;
      const v0: Vec3 = [patch.vertices[i0]!, patch.vertices[i0 + 1]!, patch.vertices[i0 + 2]!];
      const v1: Vec3 = [patch.vertices[i1]!, patch.vertices[i1 + 1]!, patch.vertices[i1 + 2]!];
      const v2: Vec3 = [patch.vertices[i2]!, patch.vertices[i2 + 1]!, patch.vertices[i2 + 2]!];
      const nVec = cross3(sub3(v1, v0), sub3(v2, v0));
      patchArea += 0.5 * Math.hypot(nVec[0], nVec[1], nVec[2]);
    }
    patch.area = patchArea;
    return patch;
  };

  const tessellateShellRefs = (shellRefs: string[]): { faces: StepFacePatch[]; isClosed: boolean } => {
    const faces: StepFacePatch[] = [];
    let isClosed = true;
    for (const shellId of shellRefs) {
      const shellEnt = resolver.entities.get(shellId);
      if (!shellEnt) continue;
      if (shellEnt.type === "OPEN_SHELL") isClosed = false;
      const sArgs = splitStepArgs(shellEnt.args);
      const faceRefs = parseRefList(sArgs[1]);
      for (const fId of faceRefs) {
        const patch = tessellateFaceEntity(fId);
        if (patch && patch.indices.length > 0) {
          faces.push(patch);
        }
      }
    }
    return { faces, isClosed };
  };

  const solidMeshes: StepSolidMesh[] = [];

  for (const [id, ent] of resolver.entities) {
    if (ent.type === "MANIFOLD_SOLID_BREP" || ent.type === "BREP_WITH_VOIDS" || ent.type === "FACETED_BREP") {
      const args = splitStepArgs(ent.args);
      const name = parseStepString(args[0]) || `Solid_${id}`;
      const outerShellId = args[1] ?? "";
      const voidShellIds = ent.type === "BREP_WITH_VOIDS" ? parseRefList(args[2]) : [];
      const { faces, isClosed } = tessellateShellRefs([outerShellId, ...voidShellIds]);
      if (faces.length > 0) {
        solidMeshes.push(combineFacePatches(name, id, faces, isClosed));
      }
    } else if (ent.type === "SHELL_BASED_SURFACE_MODEL") {
      const args = splitStepArgs(ent.args);
      const name = parseStepString(args[0]) || `SurfaceModel_${id}`;
      const shellRefs = parseRefList(args[1]);
      const { faces, isClosed } = tessellateShellRefs(shellRefs);
      if (faces.length > 0) {
        solidMeshes.push(combineFacePatches(name, id, faces, isClosed));
      }
    }
  }

  // Fallback: if no MANIFOLD_SOLID_BREP resolved faces (e.g., standalone CLOSED_SHELL or ADVANCED_FACE entities)
  if (solidMeshes.length === 0) {
    const allFaces: StepFacePatch[] = [];
    for (const [id, ent] of resolver.entities) {
      if (ent.type === "ADVANCED_FACE" || ent.type === "FACE_SURFACE") {
        const patch = tessellateFaceEntity(id);
        if (patch && patch.indices.length > 0) {
          allFaces.push(patch);
        }
      }
    }
    if (allFaces.length > 0) {
      solidMeshes.push(combineFacePatches("StepSolid", "#0", allFaces, true));
    }
  }

  if (solidMeshes.length === 0) {
    return combineFacePatches("EmptySolid", "#0", [], false);
  }

  if (solidMeshes.length === 1) {
    const single = solidMeshes[0]!;
    single.solids = [single];
    return single;
  }

  // Combine all solid meshes into an aggregate result while preserving individual `solids`
  const allFaces = solidMeshes.flatMap((s) => s.faces);
  const combined = combineFacePatches(
    solidMeshes.map((s) => s.name).join("+"),
    solidMeshes[0]!.solidId,
    allFaces,
    solidMeshes.every((s) => s.isWatertight),
  );
  combined.solids = solidMeshes;
  return combined;
}

/**
 * Computes exact closed-mesh polyhedral volume $V = \frac{1}{6}\sum_k \vec{v}_{k,0}\cdot(\vec{v}_{k,1}\times\vec{v}_{k,2})$,
 * center of mass $\vec{r}_{\text{com}}$, and $3\times 3$ covariance / inertia tensor $\mathbf{I}$
 * from a tessellated `StepSolidMesh` or STEP Part 21 string via the Divergence Theorem (Mirtich 1996).
 */
export function computeMeshMassProperties(
  meshOrStep: StepSolidMesh | string,
  densityOrOptions?:
    | number
    | {
        density?: number | undefined;
        lengthScale?: number | undefined;
        segments?: number | undefined;
      },
): StepMeshMassProperties {
  const isNumberOpt = typeof densityOrOptions === "number";
  const density = isNumberOpt ? densityOrOptions : (densityOrOptions?.density ?? 2700.0);
  const autoScale =
    typeof meshOrStep === "string" && /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(meshOrStep) ? 1e-3 : 1.0;
  const lengthScale = isNumberOpt ? autoScale : (densityOrOptions?.lengthScale ?? autoScale);
  const mesh =
    typeof meshOrStep === "string"
      ? tessellateStepSolid(meshOrStep, {
          segments: !isNumberOpt ? densityOrOptions?.segments : undefined,
        })
      : meshOrStep;

  const verts = mesh.vertices;
  const indices = mesh.indices;
  const triCount = Math.floor(indices.length / 3);

  const cleanZero = (x: number): number => (Math.abs(x) < 1e-12 ? 0 : x);

  if (triCount === 0 || verts.length < 9) {
    return {
      volume: 0,
      surfaceArea: 0,
      mass: 0,
      density,
      centerOfMass: [0, 0, 0],
      covarianceMatrix: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      inertiaTensor: { I_11: 0, I_22: 0, I_33: 0, I_21: 0, I_31: 0, I_32: 0 },
      inertiaMatrix: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      crossSectionArea: { yz: 0, xz: 0, xy: 0 },
    };
  }

  // Pass 1: Extract scaled triangles, compute surface area, directional projected areas, and area-weighted centroid
  const tris: { v0: Vec3; v1: Vec3; v2: Vec3; area: number }[] = [];
  let surfaceArea = 0;
  let projAbsX = 0;
  let projAbsY = 0;
  let projAbsZ = 0;
  let projSignedX = 0;
  let projSignedY = 0;
  let projSignedZ = 0;
  let surfCx = 0;
  let surfCy = 0;
  let surfCz = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3]! * 3;
    const i1 = indices[t * 3 + 1]! * 3;
    const i2 = indices[t * 3 + 2]! * 3;
    const v0: Vec3 = [verts[i0]! * lengthScale, verts[i0 + 1]! * lengthScale, verts[i0 + 2]! * lengthScale];
    const v1: Vec3 = [verts[i1]! * lengthScale, verts[i1 + 1]! * lengthScale, verts[i1 + 2]! * lengthScale];
    const v2: Vec3 = [verts[i2]! * lengthScale, verts[i2 + 1]! * lengthScale, verts[i2 + 2]! * lengthScale];

    const e1 = sub3(v1, v0);
    const e2 = sub3(v2, v0);
    const cross = cross3(e1, e2);
    const area2 = Math.hypot(cross[0], cross[1], cross[2]);
    const area = 0.5 * area2;
    if (area <= 1e-16) continue;

    tris.push({ v0, v1, v2, area });
    surfaceArea += area;
    projAbsX += 0.5 * Math.abs(cross[0]);
    projAbsY += 0.5 * Math.abs(cross[1]);
    projAbsZ += 0.5 * Math.abs(cross[2]);
    projSignedX += 0.5 * cross[0];
    projSignedY += 0.5 * cross[1];
    projSignedZ += 0.5 * cross[2];

    surfCx += area * ((v0[0] + v1[0] + v2[0]) / 3);
    surfCy += area * ((v0[1] + v1[1] + v2[1]) / 3);
    surfCz += area * ((v0[2] + v1[2] + v2[2]) / 3);
  }

  const surfCentroid: Vec3 =
    surfaceArea > 1e-16 ? [surfCx / surfaceArea, surfCy / surfaceArea, surfCz / surfaceArea] : [0, 0, 0];

  // Pass 2: Divergence Theorem Volume V = (1/6) * sum_k v_{k,0} . (v_{k,1} x v_{k,2})
  // Also compute relative signed volumes around surfCentroid to detect inconsistent face orientations
  let signedVolOrigin = 0;
  let _signedVolRel = 0;
  let absVolRel = 0;
  let comOriginX = 0;
  let comOriginY = 0;
  let comOriginZ = 0;
  let comRelX = 0;
  let comRelY = 0;
  let comRelZ = 0;

  const rawTetVols: number[] = [];
  const relAbsTetVols: number[] = [];

  for (const { v0, v1, v2 } of tris) {
    // Exact divergence theorem tetrahedron with apex at origin (0, 0, 0)
    const dv = dot3(v0, cross3(v1, v2)) / 6.0;
    rawTetVols.push(dv);
    signedVolOrigin += dv;
    comOriginX += dv * 0.25 * (v0[0] + v1[0] + v2[0]);
    comOriginY += dv * 0.25 * (v0[1] + v1[1] + v2[1]);
    comOriginZ += dv * 0.25 * (v0[2] + v1[2] + v2[2]);

    // Tetrahedron relative to surface centroid
    const u0 = sub3(v0, surfCentroid);
    const u1 = sub3(v1, surfCentroid);
    const u2 = sub3(v2, surfCentroid);
    const dvRel = dot3(u0, cross3(u1, u2)) / 6.0;
    const dvAbs = Math.abs(dvRel);
    relAbsTetVols.push(dvAbs);
    _signedVolRel += dvRel;
    absVolRel += dvAbs;
    comRelX += dvAbs * (surfCentroid[0] + 0.25 * (u0[0] + u1[0] + u2[0]));
    comRelY += dvAbs * (surfCentroid[1] + 0.25 * (u0[1] + u1[1] + u2[1]));
    comRelZ += dvAbs * (surfCentroid[2] + 0.25 * (u0[2] + u1[2] + u2[2]));
  }

  // Use exact signed divergence theorem whenever face orientations are consistent;
  // fall back to outward orientation around surfCentroid only if opposing faces canceled out.
  const isConsistentOrientation = Math.abs(signedVolOrigin) >= 0.2 * absVolRel && Math.abs(signedVolOrigin) > 1e-12;
  let volume: number;
  let centerOfMass: Vec3;
  let useRelativeOutward = false;
  let volSign = 1;

  if (isConsistentOrientation) {
    volSign = signedVolOrigin >= 0 ? 1 : -1;
    volume = Math.abs(signedVolOrigin);
    centerOfMass = [
      cleanZero(comOriginX / signedVolOrigin),
      cleanZero(comOriginY / signedVolOrigin),
      cleanZero(comOriginZ / signedVolOrigin),
    ];
  } else if (absVolRel > 1e-12) {
    useRelativeOutward = true;
    volume = absVolRel;
    centerOfMass = [cleanZero(comRelX / absVolRel), cleanZero(comRelY / absVolRel), cleanZero(comRelZ / absVolRel)];
  } else {
    // Open planar sheet fallback
    const bMin = scale3(mesh.boundingBox.min, lengthScale);
    const bMax = scale3(mesh.boundingBox.max, lengthScale);
    const thickness = Math.max(
      1e-3,
      Math.min(Math.max(1e-3, bMax[0] - bMin[0]), Math.max(1e-3, bMax[1] - bMin[1]), Math.max(1e-3, bMax[2] - bMin[2])),
    );
    volume = surfaceArea * thickness;
    centerOfMass = [cleanZero(surfCentroid[0]), cleanZero(surfCentroid[1]), cleanZero(surfCentroid[2])];
  }

  // Pass 3: Canonical 3x3 Second-Moment Covariance Matrix C about Center of Mass
  const C: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let idx = 0; idx < tris.length; idx++) {
    const { v0, v1, v2 } = tris[idx]!;
    const a = sub3(v0, centerOfMass);
    const b = sub3(v1, centerOfMass);
    const c = sub3(v2, centerOfMass);
    const wk = useRelativeOutward ? Math.abs(dot3(a, cross3(b, c)) / 6.0) : volSign * (dot3(a, cross3(b, c)) / 6.0);
    const factor = wk / 20.0;
    const s: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        C[i]![j]! += factor * (a[i]! * a[j]! + b[i]! * b[j]! + c[i]! * c[j]! + s[i]! * s[j]!);
      }
    }
  }

  const mass = volume * density;
  const I_11 = cleanZero(density * (C[1][1] + C[2][2]));
  const I_22 = cleanZero(density * (C[0][0] + C[2][2]));
  const I_33 = cleanZero(density * (C[0][0] + C[1][1]));
  const I_21 = cleanZero(-density * C[0][1]);
  const I_31 = cleanZero(-density * C[0][2]);
  const I_32 = cleanZero(-density * C[1][2]);

  const covarianceMatrix: [Vec3, Vec3, Vec3] = [
    [cleanZero(C[0][0]), cleanZero(C[0][1]), cleanZero(C[0][2])],
    [cleanZero(C[1][0]), cleanZero(C[1][1]), cleanZero(C[1][2])],
    [cleanZero(C[2][0]), cleanZero(C[2][1]), cleanZero(C[2][2])],
  ];

  const inertiaMatrix: [Vec3, Vec3, Vec3] = [
    [I_11, I_21, I_31],
    [I_21, I_22, I_32],
    [I_31, I_32, I_33],
  ];

  const crossSectionArea = {
    yz: Math.max(0.5 * projAbsX, Math.abs(projSignedX)),
    xz: Math.max(0.5 * projAbsY, Math.abs(projSignedY)),
    xy: Math.max(0.5 * projAbsZ, Math.abs(projSignedZ)),
  };

  return {
    volume,
    surfaceArea,
    mass,
    density,
    centerOfMass,
    covarianceMatrix,
    inertiaTensor: {
      I_11,
      I_22,
      I_33,
      I_21,
      I_31,
      I_32,
    },
    inertiaMatrix,
    crossSectionArea,
  };
}
