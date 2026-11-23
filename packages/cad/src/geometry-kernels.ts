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
