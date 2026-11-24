// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Computational Geometry & Inverse Kinematics Kernels.
 *
 * Provides:
 *   1. 2D Bowyer-Watson Delaunay Triangulation
 *   2. Rational B-Spline / NURBS Curve Evaluation (Cox-de Boor)
 *   3. FABRIK (Forward And Backward Reaching Inverse Kinematics) for articulated chains (`urdf`/`opensim`)
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface Point3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Triangle2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/**
 * 2D Bowyer-Watson Delaunay Triangulation.
 * Returns vertex index triples referencing `points`.
 */
export function delaunayTriangulate2D(points: readonly Point2D[]): Triangle2D[] {
  const n = points.length;
  if (n < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const deltaMax = Math.max(dx, dy) * 20;
  const midX = 0.5 * (minX + maxX);
  const midY = 0.5 * (minY + maxY);

  // Append super-triangle vertices
  const pts: Point2D[] = [
    ...points,
    { x: midX - deltaMax, y: midY - deltaMax },
    { x: midX, y: midY + deltaMax },
    { x: midX + deltaMax, y: midY - deltaMax },
  ];

  const inCircumcircle = (p: Point2D, t: Triangle2D): boolean => {
    const pa = pts[t.a]!;
    const pb = pts[t.b]!;
    const pc = pts[t.c]!;
    const ax = pa.x - p.x;
    const ay = pa.y - p.y;
    const bx = pb.x - p.x;
    const by = pb.y - p.y;
    const cx = pc.x - p.x;
    const cy = pc.y - p.y;

    const orient = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    const det =
      (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay);
    return orient > 0 ? det > 1e-12 : det < -1e-12;
  };

  let triangles: Triangle2D[] = [{ a: n, b: n + 1, c: n + 2 }];

  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const bad: Triangle2D[] = [];
    const good: Triangle2D[] = [];
    for (const t of triangles) {
      if (inCircumcircle(p, t)) bad.push(t);
      else good.push(t);
    }

    // Collect boundary edges of polygonal hole (edges appearing only once among bad triangles)
    const edgeCount = new Map<string, { u: number; v: number; count: number }>();
    const addEdge = (u: number, v: number): void => {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      const existing = edgeCount.get(key);
      if (existing) existing.count++;
      else edgeCount.set(key, { u, v, count: 1 });
    };
    for (const t of bad) {
      addEdge(t.a, t.b);
      addEdge(t.b, t.c);
      addEdge(t.c, t.a);
    }

    for (const e of edgeCount.values()) {
      if (e.count === 1) {
        good.push({ a: e.u, b: e.v, c: i });
      }
    }
    triangles = good;
  }

  return triangles.filter((t) => t.a < n && t.b < n && t.c < n);
}

/**
 * Evaluates a 3D Rational B-Spline (NURBS) curve at parameter `u` via Cox-de Boor recursion.
 */
export function evaluateNurbsCurve(
  controlPoints: readonly Point3D[],
  weights: readonly number[],
  knots: readonly number[],
  degree: number,
  u: number,
): Point3D {
  const n = controlPoints.length;
  const basis = (i: number, p: number, t: number): number => {
    if (p === 0) {
      const lastKnot = knots[knots.length - 1]!;
      if (t === lastKnot && i === n - 1) return 1.0;
      return t >= knots[i]! && t < knots[i + 1]! ? 1.0 : 0.0;
    }
    const d1 = knots[i + p]! - knots[i]!;
    const d2 = knots[i + p + 1]! - knots[i + 1]!;
    const term1 = d1 > 1e-14 ? ((t - knots[i]!) / d1) * basis(i, p - 1, t) : 0;
    const term2 = d2 > 1e-14 ? ((knots[i + p + 1]! - t) / d2) * basis(i + 1, p - 1, t) : 0;
    return term1 + term2;
  };

  let wx = 0;
  let wy = 0;
  let wz = 0;
  let wSum = 0;
  for (let i = 0; i < n; i++) {
    const N = basis(i, degree, u);
    if (N === 0) continue;
    const w = (weights[i] ?? 1.0) * N;
    const cp = controlPoints[i]!;
    wx += w * cp.x;
    wy += w * cp.y;
    wz += w * cp.z;
    wSum += w;
  }
  const inv = wSum > 1e-14 ? 1.0 / wSum : 1.0;
  return { x: wx * inv, y: wy * inv, z: wz * inv };
}

export interface FabrikResult {
  readonly joints: Point3D[];
  readonly reached: boolean;
  readonly residualDistance: number;
  readonly iterations: number;
}

/**
 * FABRIK (Forward And Backward Reaching Inverse Kinematics) for 3D serial manipulator chains.
 */
export function solveFabrikIk(
  initialJoints: readonly Point3D[],
  target: Point3D,
  opts?: { tolerance?: number | undefined; maxIterations?: number | undefined },
): FabrikResult {
  const n = initialJoints.length;
  const tol = opts?.tolerance ?? 1e-4;
  const maxIter = opts?.maxIterations ?? 50;
  const joints = initialJoints.map((j) => ({ x: j.x, y: j.y, z: j.z }));
  if (n <= 1) {
    return { joints, reached: true, residualDistance: 0, iterations: 0 };
  }

  const dist = (a: Point3D, b: Point3D): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const lengths = new Float64Array(n - 1);
  let totalLen = 0;
  for (let i = 0; i < n - 1; i++) {
    lengths[i] = dist(joints[i]!, joints[i + 1]!);
    totalLen += lengths[i]!;
  }

  const root = { ...joints[0]! };
  const distToTarget = dist(root, target);

  // Target unreachable: stretch straight toward target
  if (distToTarget >= totalLen) {
    const invD = distToTarget > 1e-12 ? 1.0 / distToTarget : 0;
    const dirX = (target.x - root.x) * invD;
    const dirY = (target.y - root.y) * invD;
    const dirZ = (target.z - root.z) * invD;
    for (let i = 0; i < n - 1; i++) {
      joints[i + 1] = {
        x: joints[i]!.x + dirX * lengths[i]!,
        y: joints[i]!.y + dirY * lengths[i]!,
        z: joints[i]!.z + dirZ * lengths[i]!,
      };
    }
    return { joints, reached: false, residualDistance: dist(joints[n - 1]!, target), iterations: 1 };
  }

  let iter = 0;
  for (; iter < maxIter; iter++) {
    if (dist(joints[n - 1]!, target) <= tol) break;

    // Forward reaching (from end-effector back to root)
    joints[n - 1] = { x: target.x, y: target.y, z: target.z };
    for (let i = n - 2; i >= 0; i--) {
      const r = Math.max(1e-12, dist(joints[i]!, joints[i + 1]!));
      const lam = lengths[i]! / r;
      joints[i] = {
        x: (1 - lam) * joints[i + 1]!.x + lam * joints[i]!.x,
        y: (1 - lam) * joints[i + 1]!.y + lam * joints[i]!.y,
        z: (1 - lam) * joints[i + 1]!.z + lam * joints[i]!.z,
      };
    }

    // Backward reaching (from root forward to end-effector)
    joints[0] = { x: root.x, y: root.y, z: root.z };
    for (let i = 0; i < n - 1; i++) {
      const r = Math.max(1e-12, dist(joints[i]!, joints[i + 1]!));
      const lam = lengths[i]! / r;
      joints[i + 1] = {
        x: (1 - lam) * joints[i]!.x + lam * joints[i + 1]!.x,
        y: (1 - lam) * joints[i]!.y + lam * joints[i + 1]!.y,
        z: (1 - lam) * joints[i]!.z + lam * joints[i + 1]!.z,
      };
    }
  }

  const residual = dist(joints[n - 1]!, target);
  return { joints, reached: residual <= tol, residualDistance: residual, iterations: iter };
}

/** Angular joint constraint for constrained FABRIK chains (cone limit + optional planar hinge axis). */
export interface JointAngleLimit {
  /** Maximum deflection angle in radians from the parent bone direction (0..PI). */
  readonly maxConeAngleRad: number;
  /** Optional unit hinge axis restricting motion to the plane orthogonal to this axis. */
  readonly hingeAxis?: Point3D | undefined;
}

export interface ConstrainedIkOptions {
  tolerance?: number | undefined;
  maxIterations?: number | undefined;
  /** Per-joint angular limits (indexed by joint index 0..n-2; joint i constrains bone i->i+1). */
  jointLimits?: readonly (JointAngleLimit | undefined)[] | undefined;
  /** Optional initial root reference direction (defaults to initial bone 0->1 direction). */
  rootDirection?: Point3D | undefined;
}

function normalize3(x: number, y: number, z: number): Point3D {
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) return { x: 1, y: 0, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

function constrainDirectionToCone(dir: Point3D, refDir: Point3D, limit: JointAngleLimit): Point3D {
  let dx = dir.x;
  let dy = dir.y;
  let dz = dir.z;

  // Optional planar hinge projection
  if (limit.hingeAxis) {
    const h = normalize3(limit.hingeAxis.x, limit.hingeAxis.y, limit.hingeAxis.z);
    const dotH = dx * h.x + dy * h.y + dz * h.z;
    dx -= dotH * h.x;
    dy -= dotH * h.y;
    dz -= dotH * h.z;
    const pLen = Math.hypot(dx, dy, dz);
    if (pLen > 1e-9) {
      dx /= pLen;
      dy /= pLen;
      dz /= pLen;
    } else {
      dx = refDir.x;
      dy = refDir.y;
      dz = refDir.z;
    }
  }

  const maxAngle = Math.max(0.01, Math.min(Math.PI, limit.maxConeAngleRad));
  const dot = Math.max(-1, Math.min(1, dx * refDir.x + dy * refDir.y + dz * refDir.z));
  const angle = Math.acos(dot);
  if (angle <= maxAngle) {
    return { x: dx, y: dy, z: dz };
  }

  // Project onto the tangent perpendicular to refDir and clamp to maxAngle cone boundary
  let tx = dx - dot * refDir.x;
  let ty = dy - dot * refDir.y;
  let tz = dz - dot * refDir.z;
  let tLen = Math.hypot(tx, ty, tz);
  if (tLen < 1e-9) {
    // Antiparallel fallback: pick arbitrary orthogonal axis
    const ax = Math.abs(refDir.x) < 0.9 ? 1 : 0;
    const ay = Math.abs(refDir.x) < 0.9 ? 0 : 1;
    tx = refDir.y * 0 - refDir.z * ay;
    ty = refDir.z * ax - refDir.x * 0;
    tz = refDir.x * ay - refDir.y * ax;
    tLen = Math.hypot(tx, ty, tz) || 1;
  }
  tx /= tLen;
  ty /= tLen;
  tz /= tLen;

  const c = Math.cos(maxAngle);
  const s = Math.sin(maxAngle);
  return normalize3(refDir.x * c + tx * s, refDir.y * c + ty * s, refDir.z * c + tz * s);
}

/**
 * Constrained FABRIK inverse kinematics solver supporting per-joint cone and hinge limits
 * for articulated robot arms and tentacle chains.
 */
export function solveConstrainedChainIk(
  initialJoints: readonly Point3D[],
  target: Point3D,
  opts?: ConstrainedIkOptions,
): FabrikResult {
  const n = initialJoints.length;
  const tol = opts?.tolerance ?? 1e-4;
  const maxIter = opts?.maxIterations ?? 40;
  const joints = initialJoints.map((j) => ({ x: j.x, y: j.y, z: j.z }));
  if (n <= 1) {
    return { joints, reached: true, residualDistance: 0, iterations: 0 };
  }

  const dist = (a: Point3D, b: Point3D): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const lengths = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    lengths[i] = Math.max(1e-9, dist(joints[i]!, joints[i + 1]!));
  }

  const root = { ...joints[0]! };
  const initialRootDir = opts?.rootDirection
    ? normalize3(opts.rootDirection.x, opts.rootDirection.y, opts.rootDirection.z)
    : normalize3(joints[1]!.x - joints[0]!.x, joints[1]!.y - joints[0]!.y, joints[1]!.z - joints[0]!.z);
  const limits = opts?.jointLimits;

  let iter = 0;
  for (; iter < maxIter; iter++) {
    if (dist(joints[n - 1]!, target) <= tol) break;

    // Forward pass: end-effector -> root
    joints[n - 1] = { x: target.x, y: target.y, z: target.z };
    for (let i = n - 2; i >= 0; i--) {
      const r = Math.max(1e-12, dist(joints[i]!, joints[i + 1]!));
      const lam = lengths[i]! / r;
      joints[i] = {
        x: (1 - lam) * joints[i + 1]!.x + lam * joints[i]!.x,
        y: (1 - lam) * joints[i + 1]!.y + lam * joints[i]!.y,
        z: (1 - lam) * joints[i + 1]!.z + lam * joints[i]!.z,
      };
    }

    // Backward pass: root -> end-effector with angular cone/hinge clamping
    joints[0] = { x: root.x, y: root.y, z: root.z };
    let prevDir = initialRootDir;
    for (let i = 0; i < n - 1; i++) {
      const rawDir = normalize3(
        joints[i + 1]!.x - joints[i]!.x,
        joints[i + 1]!.y - joints[i]!.y,
        joints[i + 1]!.z - joints[i]!.z,
      );
      const limit = limits?.[i];
      const clampedDir = limit ? constrainDirectionToCone(rawDir, prevDir, limit) : rawDir;
      const len = lengths[i]!;
      joints[i + 1] = {
        x: joints[i]!.x + clampedDir.x * len,
        y: joints[i]!.y + clampedDir.y * len,
        z: joints[i]!.z + clampedDir.z * len,
      };
      prevDir = clampedDir;
    }
  }

  const residual = dist(joints[n - 1]!, target);
  return { joints, reached: residual <= tol, residualDistance: residual, iterations: iter };
}

export interface BranchedIkBranch {
  readonly id: string;
  /** Local chain starting at its socket joint on the root body. */
  readonly initialJoints: readonly Point3D[];
  readonly target: Point3D;
  readonly jointLimits?: readonly (JointAngleLimit | undefined)[] | undefined;
  readonly rootDirection?: Point3D | undefined;
  /** When false, this branch is detached and solved independently from its current root socket. */
  readonly attached?: boolean | undefined;
}

export interface BranchedIkResult {
  readonly root: Point3D;
  readonly branches: ReadonlyMap<string, FabrikResult>;
  readonly allReached: boolean;
}

/**
 * Solves multi-arm branched tree inverse kinematics (e.g., 8 robotic tentacles attached to a shared mantle)
 * with optional root compliance and per-branch detachment support.
 */
export function solveBranchedTreeIk(
  root: Point3D,
  branches: readonly BranchedIkBranch[],
  opts?: { tolerance?: number | undefined; maxIterations?: number | undefined },
): BranchedIkResult {
  const results = new Map<string, FabrikResult>();
  let allReached = true;

  for (const branch of branches) {
    const startJoints =
      branch.attached === false || branch.initialJoints.length === 0
        ? branch.initialJoints
        : branch.initialJoints.map((j, idx) =>
            idx === 0
              ? {
                  x: root.x + (j.x - branch.initialJoints[0]!.x),
                  y: root.y + (j.y - branch.initialJoints[0]!.y),
                  z: root.z + (j.z - branch.initialJoints[0]!.z),
                }
              : j,
          );
    const res = solveConstrainedChainIk(startJoints, branch.target, {
      tolerance: opts?.tolerance,
      maxIterations: opts?.maxIterations,
      jointLimits: branch.jointLimits,
      rootDirection: branch.rootDirection,
    });
    results.set(branch.id, res);
    if (!res.reached) allReached = false;
  }

  return {
    root: { x: root.x, y: root.y, z: root.z },
    branches: results,
    allReached,
  };
}
