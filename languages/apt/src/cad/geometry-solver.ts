// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Analytic 2D/3D Geometry & CLDATA Toolpath Solver for `@modelscript/apt`.
 *
 * Evaluates APT canonical geometry (`POINT`, `LINE`, `CIRCLE`, `PLANE`, `PATERN`)
 * and continuous-path / point-to-point motion statements (`FROM`, `GOTO`, `GODLTA`,
 * `GO`, `GOLFT`, `GORGT`, `GOFWD`, `GOBACK`, `GOUP`, `GODOWN`) with exact cutter
 * radius offsets (`TO`, `ON`, `PAST`, `TANTO`).
 */

import type {
  AptGeometryDef,
  AptMotionStmt,
  AptPostProcessorStmt,
  AptProgram,
  AptSurfaceRelation,
  ClDataBoundingBox,
  ClDataProgram,
  ClDataRecord,
  ClDataSolverError,
  Line2D,
  PaternResolved,
  ResolvedGeometry,
} from "../types.js";

const EPS = 1e-9;

function parseNum(tok: string | undefined): number | null {
  if (tok === undefined) return null;
  const n = Number(tok);
  return Number.isFinite(n) ? n : null;
}

/**
 * Constructs a canonical 2D line from two points `(x1, y1)` -> `(x2, y2)`.
 */
export function makeLine2D(label: string, x1: number, y1: number, x2: number, y2: number): Line2D | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  const ux = dx / len;
  const uy = dy / len;
  // Left unit normal: (-uy, ux), so a*x + b*y + c = 0
  const a = -uy;
  const b = ux;
  const c = -(a * x1 + b * y1);
  return { kind: "LINE", label, x1, y1, x2, y2, ux, uy, a, b, c };
}

/**
 * Signed perpendicular distance from point `(px, py)` to line `L` along its left normal `(a, b)`.
 */
export function signedDistancePointLine(line: Line2D, px: number, py: number): number {
  return line.a * px + line.b * py + line.c;
}

/**
 * Offsets a canonical line `L` by signed distance `offset` along its left normal `(a, b)`.
 */
export function offsetLine2D(line: Line2D, offset: number): Line2D {
  const x1 = line.x1 + line.a * offset;
  const y1 = line.y1 + line.b * offset;
  const x2 = line.x2 + line.a * offset;
  const y2 = line.y2 + line.b * offset;
  return {
    kind: "LINE",
    label: line.label,
    x1,
    y1,
    x2,
    y2,
    ux: line.ux,
    uy: line.uy,
    a: line.a,
    b: line.b,
    c: line.c - offset,
  };
}

/**
 * Exact 2D line-line intersection. Returns `null` if lines are parallel.
 */
export function intersectLines2D(l1: Line2D, l2: Line2D): { x: number; y: number } | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < EPS) return null;
  const x = (l1.b * l2.c - l2.b * l1.c) / det;
  const y = (l1.c * l2.a - l2.c * l1.a) / det;
  return { x, y };
}

/**
 * Exact 2D line-circle intersections. Returns 0, 1, or 2 points ordered along `line`'s direction `(ux, uy)`.
 */
export function intersectLineCircle2D(
  line: Line2D,
  cx: number,
  cy: number,
  radius: number,
): Array<{ x: number; y: number }> {
  // Signed distance from circle center to line
  const d = signedDistancePointLine(line, cx, cy);
  if (Math.abs(d) > radius + 1e-7) return [];
  // Foot of perpendicular from circle center onto line
  const fx = cx - d * line.a;
  const fy = cy - d * line.b;
  const hSq = Math.max(0, radius * radius - d * d);
  const h = Math.sqrt(hSq);
  if (h < 1e-7) {
    return [{ x: fx, y: fy }];
  }
  return [
    { x: fx - h * line.ux, y: fy - h * line.uy },
    { x: fx + h * line.ux, y: fy + h * line.uy },
  ];
}

function selectByModifier(pts: Array<{ x: number; y: number }>, modifier: string): { x: number; y: number } | null {
  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0]!;
  const m = modifier.toUpperCase();
  const sorted = [...pts];
  if (m === "XLARGE") sorted.sort((p, q) => q.x - p.x);
  else if (m === "XSMALL") sorted.sort((p, q) => p.x - q.x);
  else if (m === "YLARGE") sorted.sort((p, q) => q.y - p.y);
  else if (m === "YSMALL") sorted.sort((p, q) => p.y - q.y);
  return sorted[0]!;
}

/**
 * Resolves a single `AptGeometryDef` using previously resolved geometries.
 */
function resolveGeometryDef(
  def: AptGeometryDef,
  geoms: Map<string, ResolvedGeometry>,
  errors: ClDataSolverError[],
): ResolvedGeometry | null {
  const args = def.args;
  const upper = args.map((a) => a.toUpperCase());

  if (def.geometryKind === "POINT") {
    // POINT/x, y[, z]
    const n0 = parseNum(args[0]);
    const n1 = parseNum(args[1]);
    if (n0 !== null && n1 !== null) {
      const z = parseNum(args[2]) ?? 0;
      return { kind: "POINT", label: def.label, x: n0, y: n1, z };
    }

    // POINT/INTOF, L1, L2
    if (upper[0] === "INTOF" && args.length >= 3) {
      const g1 = geoms.get(upper[1]!);
      const g2 = geoms.get(upper[2]!);
      if (g1?.kind === "LINE" && g2?.kind === "LINE") {
        const pt = intersectLines2D(g1, g2);
        if (!pt) {
          errors.push({
            code: "APT5001",
            message: `Lines '${g1.label}' and '${g2.label}' are parallel and do not intersect.`,
            line: def.line,
          });
          return null;
        }
        return { kind: "POINT", label: def.label, x: pt.x, y: pt.y, z: 0 };
      }
    }

    // POINT/CENTER, C1
    if (upper[0] === "CENTER" && args.length >= 2) {
      const g1 = geoms.get(upper[1]!);
      if (g1?.kind === "CIRCLE") {
        return { kind: "POINT", label: def.label, x: g1.cx, y: g1.cy, z: g1.cz };
      }
    }

    // POINT/XLARGE|XSMALL|YLARGE|YSMALL, INTOF, L1, C1
    if (
      args.length >= 4 &&
      (upper[0] === "XLARGE" || upper[0] === "XSMALL" || upper[0] === "YLARGE" || upper[0] === "YSMALL") &&
      upper[1] === "INTOF"
    ) {
      const g1 = geoms.get(upper[2]!);
      const g2 = geoms.get(upper[3]!);
      const line = g1?.kind === "LINE" ? g1 : g2?.kind === "LINE" ? g2 : null;
      const circle = g1?.kind === "CIRCLE" ? g1 : g2?.kind === "CIRCLE" ? g2 : null;
      if (line && circle) {
        const pts = intersectLineCircle2D(line, circle.cx, circle.cy, circle.radius);
        const chosen = selectByModifier(pts, upper[0]!);
        if (!chosen) {
          errors.push({
            code: "APT5005",
            message: `No intersection between '${line.label}' and '${circle.label}'.`,
            line: def.line,
          });
          return null;
        }
        return { kind: "POINT", label: def.label, x: chosen.x, y: chosen.y, z: circle.cz };
      }
    }

    errors.push({ code: "APT5004", message: `Cannot resolve POINT '${def.label}'.`, line: def.line });
    return null;
  }

  if (def.geometryKind === "LINE") {
    // LINE/x1, y1, x2, y2
    if (
      args.length >= 4 &&
      parseNum(args[0]) !== null &&
      parseNum(args[1]) !== null &&
      parseNum(args[2]) !== null &&
      parseNum(args[3]) !== null
    ) {
      const l = makeLine2D(def.label, Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
      if (!l) {
        errors.push({ code: "APT5004", message: `Degenerate zero-length LINE '${def.label}'.`, line: def.line });
        return null;
      }
      return l;
    }

    // LINE/P1, P2
    if (args.length === 2) {
      const p1 = geoms.get(upper[0]!);
      const p2 = geoms.get(upper[1]!);
      if (p1?.kind === "POINT" && p2?.kind === "POINT") {
        const l = makeLine2D(def.label, p1.x, p1.y, p2.x, p2.y);
        if (!l) {
          errors.push({ code: "APT5004", message: `Degenerate zero-length LINE '${def.label}'.`, line: def.line });
          return null;
        }
        return l;
      }
    }

    // LINE/P1, ATANGL, deg
    if (args.length >= 3 && upper[1] === "ATANGL") {
      const p1 = geoms.get(upper[0]!);
      const deg = parseNum(args[2]);
      if (p1?.kind === "POINT" && deg !== null) {
        const rad = (deg * Math.PI) / 180;
        return makeLine2D(def.label, p1.x, p1.y, p1.x + Math.cos(rad), p1.y + Math.sin(rad));
      }
    }

    // LINE/PARLEL, L1, XLARGE|XSMALL|YLARGE|YSMALL, dist
    if (args.length >= 4 && upper[0] === "PARLEL") {
      const l1 = geoms.get(upper[1]!);
      const mod = upper[2]!;
      const dist = parseNum(args[3]);
      if (l1?.kind === "LINE" && dist !== null) {
        let sign = 1;
        if (mod === "XLARGE") sign = l1.a >= 0 ? 1 : -1;
        else if (mod === "XSMALL") sign = l1.a <= 0 ? 1 : -1;
        else if (mod === "YLARGE") sign = l1.b >= 0 ? 1 : -1;
        else if (mod === "YSMALL") sign = l1.b <= 0 ? 1 : -1;
        const shifted = offsetLine2D(l1, sign * dist);
        return { ...shifted, label: def.label };
      }
    }

    // LINE/P1, PERPTO, L1
    if (args.length >= 3 && upper[1] === "PERPTO") {
      const p1 = geoms.get(upper[0]!);
      const l1 = geoms.get(upper[2]!);
      if (p1?.kind === "POINT" && l1?.kind === "LINE") {
        return makeLine2D(def.label, p1.x, p1.y, p1.x + l1.a, p1.y + l1.b);
      }
    }

    errors.push({ code: "APT5004", message: `Cannot resolve LINE '${def.label}'.`, line: def.line });
    return null;
  }

  if (def.geometryKind === "CIRCLE") {
    // CIRCLE/x, y, r  or  CIRCLE/x, y, z, r
    const n0 = parseNum(args[0]);
    const n1 = parseNum(args[1]);
    const n2 = parseNum(args[2]);
    if (n0 !== null && n1 !== null && n2 !== null) {
      const n3 = parseNum(args[3]);
      const cz = n3 !== null ? n2 : 0;
      const radius = n3 !== null ? n3 : n2;
      if (radius <= 0) {
        errors.push({ code: "APT5004", message: `Circle '${def.label}' radius must be positive.`, line: def.line });
        return null;
      }
      return { kind: "CIRCLE", label: def.label, cx: n0, cy: n1, cz, radius };
    }

    // CIRCLE/CENTER, P1, RADIUS, r
    if (upper[0] === "CENTER" && upper[2] === "RADIUS" && args.length >= 4) {
      const p1 = geoms.get(upper[1]!);
      const r = parseNum(args[3]);
      if (p1?.kind === "POINT" && r !== null && r > 0) {
        return { kind: "CIRCLE", label: def.label, cx: p1.x, cy: p1.y, cz: p1.z, radius: r };
      }
    }

    // CIRCLE/CENTER, P1, TANTO, L1
    if (upper[0] === "CENTER" && upper[2] === "TANTO" && args.length >= 4) {
      const p1 = geoms.get(upper[1]!);
      const l1 = geoms.get(upper[3]!);
      if (p1?.kind === "POINT" && l1?.kind === "LINE") {
        const r = Math.abs(signedDistancePointLine(l1, p1.x, p1.y));
        if (r <= EPS) {
          errors.push({
            code: "APT5004",
            message: `Circle '${def.label}' center lies on tangent line '${l1.label}'.`,
            line: def.line,
          });
          return null;
        }
        return { kind: "CIRCLE", label: def.label, cx: p1.x, cy: p1.y, cz: p1.z, radius: r };
      }
    }

    // Fillet circle tangent to two lines:
    // CIRCLE/mod1, L1, mod2, L2, RADIUS, r
    if (args.length >= 6 && upper[4] === "RADIUS") {
      const mod1 = upper[0]!;
      const l1 = geoms.get(upper[1]!);
      const mod2 = upper[2]!;
      const l2 = geoms.get(upper[3]!);
      const r = parseNum(args[5]);
      if (l1?.kind === "LINE" && l2?.kind === "LINE" && r !== null && r > 0) {
        const signForLine = (l: Line2D, m: string): number => {
          if (m === "XLARGE") return l.a >= 0 ? 1 : -1;
          if (m === "XSMALL") return l.a <= 0 ? 1 : -1;
          if (m === "YLARGE") return l.b >= 0 ? 1 : -1;
          if (m === "YSMALL") return l.b <= 0 ? 1 : -1;
          return 1;
        };
        const ol1 = offsetLine2D(l1, signForLine(l1, mod1) * r);
        const ol2 = offsetLine2D(l2, signForLine(l2, mod2) * r);
        const center = intersectLines2D(ol1, ol2);
        if (!center) {
          errors.push({
            code: "APT5001",
            message: `Cannot construct fillet circle '${def.label}': lines are parallel.`,
            line: def.line,
          });
          return null;
        }
        return { kind: "CIRCLE", label: def.label, cx: center.x, cy: center.y, cz: 0, radius: r };
      }
    }

    errors.push({ code: "APT5004", message: `Cannot resolve CIRCLE '${def.label}'.`, line: def.line });
    return null;
  }

  if (def.geometryKind === "PLANE") {
    // PLANE/a, b, c, d
    if (args.length >= 4 && parseNum(args[0]) !== null) {
      const a = Number(args[0]);
      const b = Number(args[1]);
      const c = Number(args[2]);
      const d = Number(args[3]);
      const norm = Math.hypot(a, b, c);
      if (norm < EPS) {
        errors.push({ code: "APT5004", message: `Degenerate PLANE '${def.label}' with zero normal.`, line: def.line });
        return null;
      }
      return { kind: "PLANE", label: def.label, nx: a / norm, ny: b / norm, nz: c / norm, d: d / norm };
    }

    // PLANE/P1, P2, P3
    if (args.length >= 3) {
      const p1 = geoms.get(upper[0]!);
      const p2 = geoms.get(upper[1]!);
      const p3 = geoms.get(upper[2]!);
      if (p1?.kind === "POINT" && p2?.kind === "POINT" && p3?.kind === "POINT") {
        const vx = p2.x - p1.x;
        const vy = p2.y - p1.y;
        const vz = p2.z - p1.z;
        const wx = p3.x - p1.x;
        const wy = p3.y - p1.y;
        const wz = p3.z - p1.z;
        const nx = vy * wz - vz * wy;
        const ny = vz * wx - vx * wz;
        const nz = vx * wy - vy * wx;
        const norm = Math.hypot(nx, ny, nz);
        if (norm < EPS) {
          errors.push({ code: "APT5004", message: `Collinear points in PLANE '${def.label}'.`, line: def.line });
          return null;
        }
        const ux = nx / norm;
        const uy = ny / norm;
        const uz = nz / norm;
        const d = ux * p1.x + uy * p1.y + uz * p1.z;
        return { kind: "PLANE", label: def.label, nx: ux, ny: uy, nz: uz, d };
      }
    }

    errors.push({ code: "APT5004", message: `Cannot resolve PLANE '${def.label}'.`, line: def.line });
    return null;
  }

  if (def.geometryKind === "PATERN") {
    // PATERN/LINEAR, P1, P2, count
    if (upper[0] === "LINEAR" && args.length >= 4) {
      const p1 = geoms.get(upper[1]!);
      const p2 = geoms.get(upper[2]!);
      const count = Math.max(2, Math.round(parseNum(args[3]) ?? 2));
      if (p1?.kind === "POINT" && p2?.kind === "POINT") {
        const points: Array<{ x: number; y: number; z: number }> = [];
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          points.push({
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y),
            z: p1.z + t * (p2.z - p1.z),
          });
        }
        const resolved: PaternResolved = { kind: "PATERN", label: def.label, points };
        return resolved;
      }
    }

    // PATERN/ARC, C1, startDeg, endDeg, CLW|CCLW, count
    if (upper[0] === "ARC" && args.length >= 6) {
      const c1 = geoms.get(upper[1]!);
      const startDeg = parseNum(args[2]);
      const endDeg = parseNum(args[3]);
      const dir = upper[4]!;
      const count = Math.max(2, Math.round(parseNum(args[5]) ?? 2));
      if (c1?.kind === "CIRCLE" && startDeg !== null && endDeg !== null) {
        const sRad = (startDeg * Math.PI) / 180;
        let eRad = (endDeg * Math.PI) / 180;
        if (dir === "CCLW" && eRad <= sRad) eRad += 2 * Math.PI;
        if (dir === "CLW" && eRad >= sRad) eRad -= 2 * Math.PI;
        const points: Array<{ x: number; y: number; z: number }> = [];
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const ang = sRad + t * (eRad - sRad);
          points.push({
            x: c1.cx + c1.radius * Math.cos(ang),
            y: c1.cy + c1.radius * Math.sin(ang),
            z: c1.cz,
          });
        }
        return { kind: "PATERN", label: def.label, points };
      }
    }

    errors.push({ code: "APT5004", message: `Cannot resolve PATERN '${def.label}'.`, line: def.line });
    return null;
  }

  return null;
}

const SURFACE_MODIFIERS = new Set<string>(["TO", "ON", "PAST", "TANTO"]);

function parseSurfaceRefArgs(
  args: string[],
  startIdx: number,
): { modifier: AptSurfaceRelation; name: string; nextIdx: number } | null {
  if (startIdx >= args.length) return null;
  const tok = args[startIdx]!.toUpperCase();
  if (SURFACE_MODIFIERS.has(tok) && startIdx + 1 < args.length) {
    return {
      modifier: tok as AptSurfaceRelation,
      name: args[startIdx + 1]!.toUpperCase(),
      nextIdx: startIdx + 2,
    };
  }
  return {
    modifier: "TO",
    name: tok,
    nextIdx: startIdx + 1,
  };
}

function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

function updateBBox(bb: ClDataBoundingBox, x: number, y: number, z: number): void {
  if (x < bb.minX) bb.minX = x;
  if (y < bb.minY) bb.minY = y;
  if (z < bb.minZ) bb.minZ = z;
  if (x > bb.maxX) bb.maxX = x;
  if (y > bb.maxY) bb.maxY = y;
  if (z > bb.maxZ) bb.maxZ = z;
}

export interface SolveClDataOptions {
  /** Rapid traverse feed rate in program units/min (default: 150 for INCHES, 3810 for MM). */
  rapidRate?: number | undefined;
}

/**
 * Evaluates a parsed `AptProgram` into exact CLDATA toolpath records, cutting lengths,
 * cycle times, and bounding box.
 */
export function solveAptToClData(program: AptProgram, options?: SolveClDataOptions): ClDataProgram {
  const geometries = new Map<string, ResolvedGeometry>();
  const records: ClDataRecord[] = [];
  const errors: ClDataSolverError[] = [];

  let cutterDiameter = 0.0;
  let cutterRadius = 0.0;
  let spindleRpm = 0.0;
  let spindleDirection: "CLW" | "CCLW" | "OFF" = "OFF";
  let feedRate = program.units === "MM" ? 250.0 : 10.0;
  const rapidRate = options?.rapidRate ?? (program.units === "MM" ? 3810.0 : 150.0);
  let nextIsRapid = false;

  let hasPosition = false;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  let hx = 1;
  let hy = 0;

  let totalCuttingLength = 0;
  let totalRapidLength = 0;
  let cuttingTimeMin = 0;
  let rapidTimeMin = 0;

  const boundingBox: ClDataBoundingBox = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };

  function emitLinearMove(nx: number, ny: number, nz: number, line: number, comment: string): void {
    const dx = nx - tx;
    const dy = ny - ty;
    const dz = nz - tz;
    const dist = Math.hypot(dx, dy, dz);
    const kind = nextIsRapid ? "RAPID" : "LINEAR";
    nextIsRapid = false;

    records.push({
      kind,
      line,
      x0: tx,
      y0: ty,
      z0: tz,
      x: nx,
      y: ny,
      z: nz,
      length: dist,
      feedRate: kind === "RAPID" ? rapidRate : feedRate,
      comment,
    });

    if (kind === "RAPID") {
      totalRapidLength += dist;
      rapidTimeMin += rapidRate > 0 ? dist / rapidRate : 0;
    } else {
      totalCuttingLength += dist;
      cuttingTimeMin += feedRate > 0 ? dist / feedRate : 0;
    }

    const planarLen = Math.hypot(dx, dy);
    if (planarLen > EPS) {
      hx = dx / planarLen;
      hy = dy / planarLen;
    }
    tx = nx;
    ty = ny;
    tz = nz;
    updateBBox(boundingBox, tx, ty, tz);
  }

  function handlePostProcessor(stmt: AptPostProcessorStmt): void {
    switch (stmt.keyword) {
      case "CUTTER": {
        const d = parseNum(stmt.args[0]);
        if (d !== null && d > 0) {
          cutterDiameter = d;
          cutterRadius = d / 2;
          records.push({ kind: "CUTTER", line: stmt.line, value: d, comment: stmt.raw });
        }
        break;
      }
      case "SPINDL": {
        const firstUpper = (stmt.args[0] ?? "").toUpperCase();
        if (firstUpper === "OFF") {
          spindleDirection = "OFF";
          records.push({ kind: "SPINDL", line: stmt.line, value: 0, mode: "OFF", comment: stmt.raw });
        } else {
          const rpm = parseNum(stmt.args[0]);
          const dir = (stmt.args[1] ?? "CLW").toUpperCase();
          if (rpm !== null && rpm > 0) {
            spindleRpm = rpm;
            spindleDirection = dir === "CCLW" ? "CCLW" : "CLW";
            records.push({ kind: "SPINDL", line: stmt.line, value: rpm, mode: spindleDirection, comment: stmt.raw });
          }
        }
        break;
      }
      case "FEDRAT": {
        const f = parseNum(stmt.args[0]);
        if (f !== null && f > 0) {
          feedRate = f;
          records.push({ kind: "FEDRAT", line: stmt.line, value: f, comment: stmt.raw });
        }
        break;
      }
      case "COOLNT": {
        const mode = (stmt.args[0] ?? "ON").toUpperCase();
        records.push({ kind: "COOLNT", line: stmt.line, mode, comment: stmt.raw });
        break;
      }
      case "RAPID": {
        nextIsRapid = true;
        break;
      }
      case "FINI": {
        records.push({ kind: "FINI", line: stmt.line, comment: stmt.raw });
        break;
      }
      default:
        break;
    }
  }

  function handleMotion(stmt: AptMotionStmt): void {
    const kw = stmt.keyword;
    const args = stmt.args;

    if (kw === "FROM") {
      let x = 0;
      let y = 0;
      let z = 0;
      const g = geometries.get(args[0]!.toUpperCase());
      if (g?.kind === "POINT") {
        x = g.x;
        y = g.y;
        z = g.z;
      } else {
        x = parseNum(args[0]) ?? 0;
        y = parseNum(args[1]) ?? 0;
        z = parseNum(args[2]) ?? 0;
      }
      tx = x;
      ty = y;
      tz = z;
      hasPosition = true;
      updateBBox(boundingBox, tx, ty, tz);
      records.push({ kind: "FROM", line: stmt.line, x, y, z, comment: stmt.raw });
      return;
    }

    if (!hasPosition) {
      hasPosition = true;
      updateBBox(boundingBox, tx, ty, tz);
    }

    if (kw === "GOTO") {
      const g = geometries.get(args[0]!.toUpperCase());
      if (g?.kind === "POINT") {
        emitLinearMove(g.x, g.y, g.z, stmt.line, stmt.raw);
      } else if (g?.kind === "PATERN") {
        for (const pt of g.points) {
          emitLinearMove(pt.x, pt.y, pt.z, stmt.line, stmt.raw);
        }
      } else {
        const nx = parseNum(args[0]);
        const ny = parseNum(args[1]);
        const nz = parseNum(args[2]) ?? tz;
        if (nx !== null && ny !== null) {
          emitLinearMove(nx, ny, nz, stmt.line, stmt.raw);
        }
      }
      return;
    }

    if (kw === "GODLTA") {
      const dx = parseNum(args[0]) ?? 0;
      const dy = parseNum(args[1]) ?? 0;
      const dz = parseNum(args[2]) ?? 0;
      emitLinearMove(tx + dx, ty + dy, tz + dz, stmt.line, stmt.raw);
      return;
    }

    if (kw === "GO") {
      // GO/mod1, ds[, mod2, psOrCs[, mod3, cs]]
      const r1 = parseSurfaceRefArgs(args, 0);
      if (!r1) return;
      const r2 = parseSurfaceRefArgs(args, r1.nextIdx);
      const r3 = r2 ? parseSurfaceRefArgs(args, r2.nextIdx) : null;

      const ds = geometries.get(r1.name);
      if (!ds) return;

      let checkRef = r2;
      let targetZ = tz;
      if (r2) {
        const g2 = geometries.get(r2.name);
        if (g2?.kind === "PLANE") {
          if (Math.abs(g2.nz) > EPS) {
            targetZ = g2.d / g2.nz;
          }
          checkRef = r3;
        }
      }

      if (ds.kind === "LINE") {
        const dTool = signedDistancePointLine(ds, tx, ty);
        const sideSign = dTool >= 0 ? 1 : -1;
        const dsOffset =
          r1.modifier === "ON" ? 0 : r1.modifier === "TO" ? sideSign * cutterRadius : -sideSign * cutterRadius;
        const offsetDs = offsetLine2D(ds, dsOffset);

        if (checkRef) {
          const cs = geometries.get(checkRef.name);
          if (cs?.kind === "LINE") {
            const dToolCs = signedDistancePointLine(cs, tx, ty);
            const csSide = dToolCs >= 0 ? 1 : -1;
            const csOffset =
              checkRef.modifier === "ON"
                ? 0
                : checkRef.modifier === "TO"
                  ? csSide * cutterRadius
                  : -csSide * cutterRadius;
            const offsetCs = offsetLine2D(cs, csOffset);
            const inter = intersectLines2D(offsetDs, offsetCs);
            if (inter) {
              emitLinearMove(inter.x, inter.y, targetZ, stmt.line, stmt.raw);
              return;
            }
          }
        }

        // Single-surface startup: project current tool center onto offset drive line
        const dOff = signedDistancePointLine(offsetDs, tx, ty);
        const nx = tx - dOff * offsetDs.a;
        const ny = ty - dOff * offsetDs.b;
        emitLinearMove(nx, ny, targetZ, stmt.line, stmt.raw);
      } else if (ds.kind === "CIRCLE") {
        const vx = tx - ds.cx;
        const vy = ty - ds.cy;
        const dist = Math.hypot(vx, vy);
        if (dist > EPS) {
          const rEff =
            r1.modifier === "ON"
              ? ds.radius
              : dist >= ds.radius
                ? r1.modifier === "TO"
                  ? ds.radius + cutterRadius
                  : Math.max(EPS, ds.radius - cutterRadius)
                : r1.modifier === "TO"
                  ? Math.max(EPS, ds.radius - cutterRadius)
                  : ds.radius + cutterRadius;
          emitLinearMove(ds.cx + (vx / dist) * rEff, ds.cy + (vy / dist) * rEff, targetZ, stmt.line, stmt.raw);
        }
      }
      return;
    }

    // Continuous-path motion: GOLFT, GORGT, GOFWD, GOBACK, GOUP, GODOWN
    if (kw === "GOLFT" || kw === "GORGT" || kw === "GOFWD" || kw === "GOBACK" || kw === "GOUP" || kw === "GODOWN") {
      if (args.length < 2) return;
      const dsName = args[0]!.toUpperCase();
      const checkRef = parseSurfaceRefArgs(args, 1);
      if (!checkRef) return;

      const ds = geometries.get(dsName);
      const cs = geometries.get(checkRef.name);
      if (!ds || !cs) return;

      if (ds.kind === "LINE") {
        // Choose travel unit vector u along ds consistent with motion keyword
        const crossPos = hx * ds.uy - hy * ds.ux;
        const dotPos = hx * ds.ux + hy * ds.uy;
        let dirSign = 1;
        if (kw === "GOLFT") dirSign = crossPos >= 0 ? 1 : -1;
        else if (kw === "GORGT") dirSign = crossPos <= 0 ? 1 : -1;
        else if (kw === "GOFWD") dirSign = dotPos >= 0 ? 1 : -1;
        else if (kw === "GOBACK") dirSign = dotPos <= 0 ? 1 : -1;

        const ux = ds.ux * dirSign;
        const uy = ds.uy * dirSign;

        // Maintain current cutter offset side relative to drive line ds
        const dCurr = signedDistancePointLine(ds, tx, ty);
        const dsOffset = Math.abs(dCurr) < 1e-6 ? 0 : Math.sign(dCurr) * cutterRadius;
        const offsetDs = offsetLine2D(ds, dsOffset);

        if (cs.kind === "LINE") {
          // Determine check line offset based on travel direction u and modifier (TO / ON / PAST)
          const uDotN = ux * cs.a + uy * cs.b;
          let csOffset = 0;
          if (checkRef.modifier === "TO") {
            // Stop on approach side (opposite to travel direction)
            csOffset = uDotN >= 0 ? -cutterRadius : cutterRadius;
          } else if (checkRef.modifier === "PAST") {
            // Cross check line and stop on far side (along travel direction)
            csOffset = uDotN >= 0 ? cutterRadius : -cutterRadius;
          }
          const offsetCs = offsetLine2D(cs, csOffset);
          const inter = intersectLines2D(offsetDs, offsetCs);
          if (!inter) {
            errors.push({
              code: "APT5001",
              message: `Drive line '${ds.label}' and check line '${cs.label}' are parallel.`,
              line: stmt.line,
            });
            return;
          }
          emitLinearMove(inter.x, inter.y, tz, stmt.line, stmt.raw);
          return;
        }

        if (cs.kind === "CIRCLE") {
          if (checkRef.modifier === "TANTO") {
            // Exact tangency transition point: project circle center onto offset drive line
            const dCenter = signedDistancePointLine(offsetDs, cs.cx, cs.cy);
            const nx = cs.cx - dCenter * offsetDs.a;
            const ny = cs.cy - dCenter * offsetDs.b;
            emitLinearMove(nx, ny, tz, stmt.line, stmt.raw);
            return;
          }

          const rTarget = checkRef.modifier === "ON" ? cs.radius : cs.radius + cutterRadius;
          const pts = intersectLineCircle2D(offsetDs, cs.cx, cs.cy, rTarget);
          if (pts.length === 0) {
            errors.push({
              code: "APT5005",
              message: `No intersection between drive line '${ds.label}' and check circle '${cs.label}'.`,
              line: stmt.line,
            });
            return;
          }
          // Order along travel vector (ux, uy) from current tool position
          const ordered = pts.map((p) => ({ p, t: (p.x - tx) * ux + (p.y - ty) * uy })).sort((a, b) => a.t - b.t);
          const forward = ordered.filter((o) => o.t > -EPS);
          const pick =
            checkRef.modifier === "PAST"
              ? (forward[forward.length - 1] ?? ordered[ordered.length - 1])!
              : (forward[0] ?? ordered[0])!;
          emitLinearMove(pick.p.x, pick.p.y, tz, stmt.line, stmt.raw);
          return;
        }
      }

      if (ds.kind === "CIRCLE") {
        // Drive along circle ds with current effective radius R_eff = |T - O|
        const rx = tx - ds.cx;
        const ry = ty - ds.cy;
        const rEff = Math.hypot(rx, ry);
        if (rEff < EPS) return;

        // Check if cutter is inside concave fillet and too large
        if (rEff < ds.radius && ds.radius - cutterRadius <= EPS) {
          errors.push({
            code: "APT5006",
            message: `Cutter radius (${cutterRadius}) exceeds concave fillet '${ds.label}' radius (${ds.radius}).`,
            line: stmt.line,
          });
          return;
        }

        // Determine arc sense (CCW vs CW) from cross product (T - O) x heading
        const radialCrossHeading = rx * hy - ry * hx;
        let isCcw = radialCrossHeading >= 0;
        if (kw === "GOBACK") isCcw = !isCcw;

        const startAngle = Math.atan2(ry, rx);

        if (cs.kind === "LINE") {
          let endPt: { x: number; y: number } | null = null;

          if (checkRef.modifier === "TANTO") {
            // Exact tangency onto check line cs: radial vector from circle center perpendicular to cs
            // pointing away from center toward the side of cs that the circle is tangent to.
            const dCenterToCs = signedDistancePointLine(cs, ds.cx, ds.cy);
            // Unit normal from circle center toward cs is -sign(dCenterToCs) * (cs.a, cs.b)
            const outSign = dCenterToCs >= 0 ? -1 : 1;
            const nx = outSign * cs.a;
            const ny = outSign * cs.b;
            endPt = {
              x: ds.cx + nx * rEff,
              y: ds.cy + ny * rEff,
            };
          } else {
            const dCenterToCs = signedDistancePointLine(cs, ds.cx, ds.cy);
            const side = dCenterToCs >= 0 ? 1 : -1;
            const csOffset =
              checkRef.modifier === "ON" ? 0 : checkRef.modifier === "TO" ? side * cutterRadius : -side * cutterRadius;
            const offsetCs = offsetLine2D(cs, csOffset);
            const pts = intersectLineCircle2D(offsetCs, ds.cx, ds.cy, rEff);
            if (pts.length > 0) {
              // Choose first point along arc travel direction
              let best: { x: number; y: number } | null = null;
              let bestSweep = Infinity;
              for (const p of pts) {
                const ang = Math.atan2(p.y - ds.cy, p.x - ds.cx);
                const sweep = isCcw ? normalizeAngle(ang - startAngle) : normalizeAngle(startAngle - ang);
                if (sweep > 1e-6 && sweep < bestSweep) {
                  bestSweep = sweep;
                  best = p;
                }
              }
              endPt = best ?? pts[0]!;
            }
          }

          if (!endPt) {
            errors.push({
              code: "APT5005",
              message: `No intersection between drive circle '${ds.label}' and check line '${cs.label}'.`,
              line: stmt.line,
            });
            return;
          }

          const endAngle = Math.atan2(endPt.y - ds.cy, endPt.x - ds.cx);
          const sweepMag = isCcw ? normalizeAngle(endAngle - startAngle) : normalizeAngle(startAngle - endAngle);
          const signedSweep = isCcw ? sweepMag : -sweepMag;
          const arcLength = rEff * sweepMag;

          records.push({
            kind: isCcw ? "ARC_CCW" : "ARC_CW",
            line: stmt.line,
            x0: tx,
            y0: ty,
            z0: tz,
            x: endPt.x,
            y: endPt.y,
            z: tz,
            cx: ds.cx,
            cy: ds.cy,
            radius: rEff,
            startAngle,
            endAngle,
            sweepAngle: signedSweep,
            length: arcLength,
            feedRate,
            comment: stmt.raw,
          });

          totalCuttingLength += arcLength;
          cuttingTimeMin += feedRate > 0 ? arcLength / feedRate : 0;

          // Update tangent heading at end of arc
          if (isCcw) {
            hx = -Math.sin(endAngle);
            hy = Math.cos(endAngle);
          } else {
            hx = Math.sin(endAngle);
            hy = -Math.cos(endAngle);
          }

          // Sample intermediate arc points for accurate bounding box
          const steps = Math.max(4, Math.ceil(sweepMag / (Math.PI / 8)));
          for (let i = 0; i <= steps; i++) {
            const a = startAngle + (signedSweep * i) / steps;
            updateBBox(boundingBox, ds.cx + rEff * Math.cos(a), ds.cy + rEff * Math.sin(a), tz);
          }

          tx = endPt.x;
          ty = endPt.y;
        }
      }
    }
  }

  for (const stmt of program.statements) {
    if (stmt.stmtKind === "geometry") {
      const resolved = resolveGeometryDef(stmt, geometries, errors);
      if (resolved) {
        geometries.set(stmt.label, resolved);
      }
    } else if (stmt.stmtKind === "postprocessor") {
      handlePostProcessor(stmt);
    } else {
      handleMotion(stmt);
    }
  }

  if (!Number.isFinite(boundingBox.minX)) {
    boundingBox.minX = 0;
    boundingBox.minY = 0;
    boundingBox.minZ = 0;
    boundingBox.maxX = 0;
    boundingBox.maxY = 0;
    boundingBox.maxZ = 0;
  }

  const totalPathLength = totalCuttingLength + totalRapidLength;
  const totalCycleTimeMin = cuttingTimeMin + rapidTimeMin;

  return {
    partno: program.partno,
    units: program.units,
    cutterDiameter,
    cutterRadius,
    spindleRpm,
    spindleDirection,
    feedRate,
    rapidRate,
    geometries,
    records,
    totalCuttingLength,
    totalRapidLength,
    totalPathLength,
    cuttingTimeMin,
    rapidTimeMin,
    totalCycleTimeMin,
    totalCycleTimeSec: totalCycleTimeMin * 60,
    boundingBox,
    errors,
  };
}
