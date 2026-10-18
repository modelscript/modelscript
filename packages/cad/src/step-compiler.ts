// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — STEP BREP Builder & Serializer.
 *
 * Walks a {@link Solid} tree and emits valid ISO-10303-21 (STEP AP214)
 * with ADVANCED_BREP_SHAPE_REPRESENTATION entities.
 *
 * Phase 1 supports box primitives as exact BREP.  Cylinders, spheres,
 * and tori are approximated as bounding boxes (their BREP encoding will
 * be implemented when OCCT is integrated in Phase 4).
 *
 * Boolean operations (union, subtract, intersect) are currently
 * decomposed into their constituent leaf solids — each leaf becomes a
 * separate MANIFOLD_SOLID_BREP.  Phase 4 will add exact BREP booleans.
 */

import { ManifoldWorker } from "./manifold-worker.js";
import type { Assembly, Mat4, Solid, Vec3 } from "./types.js";
import { SolidKind } from "./types.js";

// ── Entity allocator ─────────────────────────────────────────────────────

/** Mutable accumulator holding the next STEP entity ID (`#N`) and emitted DATA lines. */
interface StepContext {
  /** Next available 1-based STEP entity ID. */
  nextId: number;
  /** Emitted ISO-10303-21 entity assignment records (`#id=ENTITY(...);`). */
  entities: string[];
}

/** Creates an empty {@link StepContext} starting at entity ID `#10`. */
function createContext(): StepContext {
  return { nextId: 10, entities: [] };
}

/** Allocates and returns the next sequential STEP entity ID in `ctx`. */
function allocId(ctx: StepContext): number {
  return ctx.nextId++;
}

/** Formats a numeric STEP entity ID `n` as a `#n` reference string. */
function ref(n: number): string {
  return `#${n}`;
}

/** Appends a `#eid=body;` record to `ctx.entities` and returns `#eid`. */
function emit(ctx: StepContext, eid: number, body: string): string {
  ctx.entities.push(`${ref(eid)}=${body};`);
  return ref(eid);
}

// ── Number formatting ────────────────────────────────────────────────────

/** Formats a floating-point coordinate or measure for ISO-10303-21 output. */
function fmt(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e6) return n.toFixed(1);
  return n.toPrecision(15).replace(/\.?0+$/, "") || "0.";
}

// ── Low-level STEP entity builders ───────────────────────────────────────

/** Emits a `CARTESIAN_POINT` entity for 3D point `p` and returns its `#id` reference. */
function cartesianPoint(ctx: StepContext, p: Vec3): string {
  const eid = allocId(ctx);
  return emit(ctx, eid, `CARTESIAN_POINT('',(${p.map(fmt).join(",")}))`);
}

/** Emits a `DIRECTION` entity for 3D direction vector `d` and returns its `#id` reference. */
function direction(ctx: StepContext, d: Vec3): string {
  const eid = allocId(ctx);
  return emit(ctx, eid, `DIRECTION('',(${d.map(fmt).join(",")}))`);
}

/** Emits an `AXIS2_PLACEMENT_3D` coordinate frame at `origin` with Z `axis` and X `refDir`. */
function axis2Placement3d(ctx: StepContext, origin: Vec3, axis: Vec3, refDir: Vec3): string {
  const o = cartesianPoint(ctx, origin);
  const a = direction(ctx, axis);
  const r = direction(ctx, refDir);
  const eid = allocId(ctx);
  return emit(ctx, eid, `AXIS2_PLACEMENT_3D('',${o},${a},${r})`);
}

/** Emits a `CIRCLE` curve entity centered at `center` with `radius` and frame `(axis, refDir)`. */
function circle(ctx: StepContext, center: Vec3, radius: number, axis: Vec3, refDir: Vec3): string {
  const place = axis2Placement3d(ctx, center, axis, refDir);
  const cid = allocId(ctx);
  return emit(ctx, cid, `CIRCLE('',${place},${fmt(radius)})`);
}

/** Emits a `CYLINDRICAL_SURFACE` entity at `origin` with `radius` and axis frame `(axis, refDir)`. */
function cylindricalSurface(ctx: StepContext, origin: Vec3, radius: number, axis: Vec3, refDir: Vec3): string {
  const place = axis2Placement3d(ctx, origin, axis, refDir);
  const sid = allocId(ctx);
  return emit(ctx, sid, `CYLINDRICAL_SURFACE('',${place},${fmt(radius)})`);
}

/** Emits a `CONICAL_SURFACE` entity at `origin` with base `radius`, `semiAngle` (radians), and axis frame `(axis, refDir)`. */
function conicalSurface(
  ctx: StepContext,
  origin: Vec3,
  radius: number,
  semiAngle: number,
  axis: Vec3,
  refDir: Vec3,
): string {
  const place = axis2Placement3d(ctx, origin, axis, refDir);
  const sid = allocId(ctx);
  return emit(ctx, sid, `CONICAL_SURFACE('',${place},${fmt(radius)},${fmt(semiAngle)})`);
}

/** Emits a `SPHERICAL_SURFACE` entity centered at `center` with `radius` and frame `(axis, refDir)`. */
function sphericalSurface(ctx: StepContext, center: Vec3, radius: number, axis: Vec3, refDir: Vec3): string {
  const place = axis2Placement3d(ctx, center, axis, refDir);
  const sid = allocId(ctx);
  return emit(ctx, sid, `SPHERICAL_SURFACE('',${place},${fmt(radius)})`);
}

/** Emits a `TOROIDAL_SURFACE` entity centered at `center` with `major` and `minor` radii. */
function toroidalSurface(
  ctx: StepContext,
  center: Vec3,
  major: number,
  minor: number,
  axis: Vec3,
  refDir: Vec3,
): string {
  const place = axis2Placement3d(ctx, center, axis, refDir);
  const sid = allocId(ctx);
  return emit(ctx, sid, `TOROIDAL_SURFACE('',${place},${fmt(major)},${fmt(minor)})`);
}

// ── Box BREP ─────────────────────────────────────────────────────────────

/** Applies a 4x4 column-major affine matrix `m` to 3D point `p`. */
function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
}

/** Extracts the radial scale factor from the X column of `m`. */
function matrixScale(m?: Mat4): number {
  if (!m) return 1.0;
  const s = Math.hypot(m[0] as number, m[1] as number, m[2] as number);
  return s > 1e-12 ? s : 1.0;
}

/** Applies the linear 3x3 upper-left block of `m` to direction `d` and normalizes the result. */
function transformDir(m: Mat4, d: Vec3): Vec3 {
  const x = (m[0] as number) * d[0] + (m[4] as number) * d[1] + (m[8] as number) * d[2];
  const y = (m[1] as number) * d[0] + (m[5] as number) * d[1] + (m[9] as number) * d[2];
  const z = (m[2] as number) * d[0] + (m[6] as number) * d[1] + (m[10] as number) * d[2];
  const len = Math.sqrt(x * x + y * y + z * z);
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 1];
}

/**
 * Emits an exact 8-vertex, 12-edge, 6-planar-face `MANIFOLD_SOLID_BREP` for an axis-aligned box
 * centered at `(cx, cy, cz)` with half-extents `(hw, hh, hd)` transformed by `worldMatrix`.
 */
function buildBoxBrep(
  ctx: StepContext,
  name: string,
  cx: number,
  cy: number,
  cz: number,
  hw: number,
  hh: number,
  hd: number,
  worldMatrix?: Mat4,
): string {
  const localCorners: Vec3[] = [
    [cx - hw, cy - hh, cz - hd],
    [cx + hw, cy - hh, cz - hd],
    [cx + hw, cy - hh, cz + hd],
    [cx - hw, cy - hh, cz + hd],
    [cx - hw, cy + hh, cz - hd],
    [cx + hw, cy + hh, cz - hd],
    [cx + hw, cy + hh, cz + hd],
    [cx - hw, cy + hh, cz + hd],
  ];

  const corners = worldMatrix ? localCorners.map((c) => transformPoint(worldMatrix, c)) : localCorners;

  // Vertex points
  const vp: string[] = corners.map((c, i) => {
    const cp = cartesianPoint(ctx, c);
    const vid = allocId(ctx);
    return emit(ctx, vid, `VERTEX_POINT('v${i}',${cp})`);
  });

  // Edge curve helper
  function edgeCurve(v0: number, v1: number): string {
    const p0 = corners[v0] as Vec3,
      p1 = corners[v1] as Vec3;
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const d: Vec3 = len > 0 ? [dx / len, dy / len, dz / len] : [1, 0, 0];
    const dir = direction(ctx, d);
    const vecId = allocId(ctx);
    const vec = emit(ctx, vecId, `VECTOR('',${dir},${fmt(len)})`);
    const lineOrigin = cartesianPoint(ctx, p0);
    const lineId = allocId(ctx);
    const line = emit(ctx, lineId, `LINE('',${lineOrigin},${vec})`);
    const ecid = allocId(ctx);
    return emit(ctx, ecid, `EDGE_CURVE('',${vp[v0]},${vp[v1]},${line},.T.)`);
  }

  // 12 edges
  const e01 = edgeCurve(0, 1),
    e12 = edgeCurve(1, 2),
    e23 = edgeCurve(2, 3),
    e30 = edgeCurve(3, 0);
  const e45 = edgeCurve(4, 5),
    e56 = edgeCurve(5, 6),
    e67 = edgeCurve(6, 7),
    e74 = edgeCurve(7, 4);
  const e04 = edgeCurve(0, 4),
    e15 = edgeCurve(1, 5),
    e26 = edgeCurve(2, 6),
    e37 = edgeCurve(3, 7);

  function orientedEdge(ec: string, forward: boolean): string {
    const oeid = allocId(ctx);
    return emit(ctx, oeid, `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  function buildFace(oes: string[], planeOrigin: Vec3, planeNormal: Vec3, planeRefDir: Vec3): string {
    const effOrigin = worldMatrix ? transformPoint(worldMatrix, planeOrigin) : planeOrigin;
    const effNormal = worldMatrix ? transformDir(worldMatrix, planeNormal) : planeNormal;
    const effRefDir = worldMatrix ? transformDir(worldMatrix, planeRefDir) : planeRefDir;

    const loopId = allocId(ctx);
    const loop = emit(ctx, loopId, `EDGE_LOOP('',(${oes.join(",")}))`);
    const boundId = allocId(ctx);
    const bound = emit(ctx, boundId, `FACE_OUTER_BOUND('',${loop},.T.)`);
    const placeRef = axis2Placement3d(ctx, effOrigin, effNormal, effRefDir);
    const planeId = allocId(ctx);
    const plane = emit(ctx, planeId, `PLANE('',${placeRef})`);
    const faceId = allocId(ctx);
    return emit(ctx, faceId, `ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  }

  // 6 faces
  const faces = [
    buildFace(
      [orientedEdge(e01, true), orientedEdge(e12, true), orientedEdge(e23, true), orientedEdge(e30, true)],
      [cx, cy - hh, cz],
      [0, -1, 0],
      [1, 0, 0],
    ),
    buildFace(
      [orientedEdge(e67, false), orientedEdge(e56, false), orientedEdge(e45, false), orientedEdge(e74, false)],
      [cx, cy + hh, cz],
      [0, 1, 0],
      [1, 0, 0],
    ),
    buildFace(
      [orientedEdge(e26, true), orientedEdge(e67, true), orientedEdge(e37, false), orientedEdge(e23, false)],
      [cx, cy, cz + hd],
      [0, 0, 1],
      [1, 0, 0],
    ),
    buildFace(
      [orientedEdge(e04, true), orientedEdge(e45, true), orientedEdge(e15, false), orientedEdge(e01, false)],
      [cx, cy, cz - hd],
      [0, 0, -1],
      [-1, 0, 0],
    ),
    buildFace(
      [orientedEdge(e15, true), orientedEdge(e56, true), orientedEdge(e26, false), orientedEdge(e12, false)],
      [cx + hw, cy, cz],
      [1, 0, 0],
      [0, 0, 1],
    ),
    buildFace(
      [orientedEdge(e37, true), orientedEdge(e74, true), orientedEdge(e04, false), orientedEdge(e30, false)],
      [cx - hw, cy, cz],
      [-1, 0, 0],
      [0, 0, -1],
    ),
  ];

  const shellId = allocId(ctx);
  const shell = emit(ctx, shellId, `CLOSED_SHELL('',(${faces.join(",")}))`);
  const brepId = allocId(ctx);
  return emit(ctx, brepId, `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Cylinder Analytical BREP ─────────────────────────────────────────────

/**
 * Emits an analytical `MANIFOLD_SOLID_BREP` for a cylinder of `radius` and `height`
 * composed of two planar circular end-cap faces and two semi-cylindrical lateral faces.
 */
function buildCylinderBrep(
  ctx: StepContext,
  name: string,
  radiusBottom: number,
  radiusTop: number,
  height: number,
  worldMatrix?: Mat4,
): string {
  const hh = height / 2;
  const rBot = Math.max(1e-6, radiusBottom);
  const rTop = Math.max(1e-6, radiusTop);
  const s = matrixScale(worldMatrix);
  const effRBot = rBot * s;
  const effRTop = rTop * s;

  // Local key vertices: 2 on bottom rim, 2 on top rim
  const localV: Vec3[] = [
    [-rBot, 0, -hh], // 0: bottom -x
    [rBot, 0, -hh], // 1: bottom +x
    [-rTop, 0, hh], // 2: top -x
    [rTop, 0, hh], // 3: top +x
  ];

  const corners = worldMatrix ? localV.map((c) => transformPoint(worldMatrix, c)) : localV;

  const vp: string[] = corners.map((c, i) => {
    const cp = cartesianPoint(ctx, c);
    const vid = allocId(ctx);
    return emit(ctx, vid, `VERTEX_POINT('cv${i}',${cp})`);
  });

  const effBottomCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, -hh]) : [0, 0, -hh];
  const effTopCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, hh]) : [0, 0, hh];
  const effZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effXAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];
  const effOppZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, -1]) : [0, 0, -1];

  // Circles for bottom and top
  const botCircle = circle(ctx, effBottomCenter, effRBot, effZAxis, effXAxis);
  const topCircle = circle(ctx, effTopCenter, effRTop, effZAxis, effXAxis);

  // Bottom circular arc edges
  const ec_b0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${botCircle},.T.)`);
  const ec_b1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${botCircle},.T.)`);

  // Top circular arc edges
  const ec_t0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[3]},${topCircle},.T.)`);
  const ec_t1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[2]},${topCircle},.T.)`);

  // Seam line edges: from bottom to top
  function lineEdge(v0: number, v1: number): string {
    const p0 = corners[v0] as Vec3,
      p1 = corners[v1] as Vec3;
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const d: Vec3 = [dx / len, dy / len, dz / len];
    const dir = direction(ctx, d);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
    const lineOrigin = cartesianPoint(ctx, p0);
    const line = emit(ctx, allocId(ctx), `LINE('',${lineOrigin},${vec})`);
    return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[v0]},${vp[v1]},${line},.T.)`);
  }

  const ec_s0 = lineEdge(0, 2); // seam at -x
  const ec_s1 = lineEdge(1, 3); // seam at +x

  function orientedEdge(ec: string, forward: boolean): string {
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  // 1. Bottom Face (Planar circle, normal [0, 0, -1])
  const botPlane = emit(
    ctx,
    allocId(ctx),
    `PLANE('',${axis2Placement3d(ctx, effBottomCenter, effOppZAxis, effXAxis)})`,
  );
  const botLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[orientedEdge(ec_b1, false), orientedEdge(ec_b0, false)].join(",")}))`,
  );
  const botBound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${botLoop},.T.)`);
  const botFace = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${botBound}),${botPlane},.T.)`);

  // 2. Top Face (Planar circle, normal [0, 0, 1])
  const topPlane = emit(ctx, allocId(ctx), `PLANE('',${axis2Placement3d(ctx, effTopCenter, effZAxis, effXAxis)})`);
  const topLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[orientedEdge(ec_t0, true), orientedEdge(ec_t1, true)].join(",")}))`,
  );
  const topBound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${topLoop},.T.)`);
  const topFace = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${topBound}),${topPlane},.T.)`);

  // 3. Lateral Cylindrical or Conical Surface
  const effHeight =
    Math.hypot(
      effTopCenter[0] - effBottomCenter[0],
      effTopCenter[1] - effBottomCenter[1],
      effTopCenter[2] - effBottomCenter[2],
    ) || Math.max(1e-6, Math.abs(height) * s);
  const cylSurf =
    Math.abs(effRBot - effRTop) > 1e-9
      ? conicalSurface(ctx, effBottomCenter, effRBot, Math.atan2(effRTop - effRBot, effHeight), effZAxis, effXAxis)
      : cylindricalSurface(ctx, effBottomCenter, effRBot, effZAxis, effXAxis);

  // Lateral Face 1 (semi-cylinder 1, y >= 0)
  const latLoop1 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[
      orientedEdge(ec_b0, true),
      orientedEdge(ec_s1, true),
      orientedEdge(ec_t0, false),
      orientedEdge(ec_s0, false),
    ].join(",")}))`,
  );
  const latBound1 = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${latLoop1},.T.)`);
  const latFace1 = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${latBound1}),${cylSurf},.T.)`);

  // Lateral Face 2 (semi-cylinder 2, y <= 0)
  const latLoop2 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[
      orientedEdge(ec_b1, true),
      orientedEdge(ec_s0, true),
      orientedEdge(ec_t1, false),
      orientedEdge(ec_s1, false),
    ].join(",")}))`,
  );
  const latBound2 = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${latLoop2},.T.)`);
  const latFace2 = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${latBound2}),${cylSurf},.T.)`);

  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${[botFace, topFace, latFace1, latFace2].join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Sphere Analytical BREP ───────────────────────────────────────────────

/**
 * Emits an analytical `MANIFOLD_SOLID_BREP` for a sphere of `radius` composed of
 * north/south pole vertices, two meridian semicircle edges, and two hemispherical faces.
 */
function buildSphereBrep(ctx: StepContext, name: string, radius: number, worldMatrix?: Mat4): string {
  const effRadius = radius * matrixScale(worldMatrix);
  const localV: Vec3[] = [
    [0, 0, -radius], // south pole
    [0, 0, radius], // north pole
  ];

  const corners = worldMatrix ? localV.map((c) => transformPoint(worldMatrix, c)) : localV;
  const vp: string[] = corners.map((c, i) => {
    const cp = cartesianPoint(ctx, c);
    return emit(ctx, allocId(ctx), `VERTEX_POINT('sv${i}',${cp})`);
  });

  const effCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, 0]) : [0, 0, 0];
  const effZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effXAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];
  const effYAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 1, 0]) : [0, 1, 0];

  // Meridian circle in XZ plane
  const meridianCircle = circle(ctx, effCenter, effRadius, effYAxis, effXAxis);

  // Two semicircle meridian edges from south to north pole and back
  const ec_m0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${meridianCircle},.T.)`);
  const ec_m1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${meridianCircle},.T.)`);

  function orientedEdge(ec: string, forward: boolean): string {
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  const sphSurf = sphericalSurface(ctx, effCenter, effRadius, effZAxis, effXAxis);

  // Hemisphere 1 (y >= 0)
  const loop1 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[orientedEdge(ec_m0, true), orientedEdge(ec_m1, true)].join(",")}))`,
  );
  const bound1 = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${loop1},.T.)`);
  const face1 = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bound1}),${sphSurf},.T.)`);

  // Hemisphere 2 (y <= 0)
  const loop2 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[orientedEdge(ec_m1, false), orientedEdge(ec_m0, false)].join(",")}))`,
  );
  const bound2 = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${loop2},.T.)`);
  const face2 = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bound2}),${sphSurf},.T.)`);

  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${[face1, face2].join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Torus Analytical BREP ────────────────────────────────────────────────

/**
 * Emits an analytical ISO-10303-21 `MANIFOLD_SOLID_BREP` for a torus with `major` and `minor` radii,
 * partitioned into two hemispherical `ADVANCED_FACE` patches over a shared `TOROIDAL_SURFACE`.
 */
function buildTorusBrep(ctx: StepContext, name: string, major: number, minor: number, worldMatrix?: Mat4): string {
  const s = matrixScale(worldMatrix);
  const effMajor = major * s;
  const effMinor = minor * s;

  // 1. Transform local origin and orthonormal frame axes into world space
  const effCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, 0]) : [0, 0, 0];
  const effZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effXAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];
  const effYAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 1, 0]) : [0, 1, 0];

  // Centers of the +X and -X minor cross-section circles
  const p_pos: Vec3 = worldMatrix ? transformPoint(worldMatrix, [major, 0, 0]) : [major, 0, 0];
  const p_neg: Vec3 = worldMatrix ? transformPoint(worldMatrix, [-major, 0, 0]) : [-major, 0, 0];

  // 4 seam vertices at top/bottom of the +X and -X cross-sections
  const localV: Vec3[] = [
    [major, 0, minor],
    [major, 0, -minor],
    [-major, 0, minor],
    [-major, 0, -minor],
  ];

  const corners = worldMatrix ? localV.map((c) => transformPoint(worldMatrix, c)) : localV;
  const vp: string[] = corners.map((c, i) => {
    const cp = cartesianPoint(ctx, c);
    return emit(ctx, allocId(ctx), `VERTEX_POINT('tv${i}',${cp})`);
  });

  // 2. Emit minor cross-section circles and half-circle edge curves at +X and -X
  const circlePos = circle(ctx, p_pos, effMinor, effYAxis, effZAxis);
  const ec_pos0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${circlePos},.T.)`);
  const ec_pos1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${circlePos},.T.)`);

  const circleNeg = circle(ctx, p_neg, effMinor, effYAxis, effZAxis);
  const ec_neg0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[3]},${circleNeg},.T.)`);
  const ec_neg1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[2]},${circleNeg},.T.)`);

  // 3. Emit top (+minor Z) and bottom (-minor Z) major longitudinal circles and half-circle edges
  const p_topCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, minor]) : [0, 0, minor];
  const p_botCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, -minor]) : [0, 0, -minor];
  const topCircle = circle(ctx, p_topCenter, effMajor, effZAxis, effXAxis);
  const botCircle = circle(ctx, p_botCenter, effMajor, effZAxis, effXAxis);

  const ec_top0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[2]},${topCircle},.T.)`);
  const ec_top1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[0]},${topCircle},.T.)`);
  const ec_bot0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[3]},${botCircle},.T.)`);
  const ec_bot1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[1]},${botCircle},.T.)`);

  function orientedEdge(ec: string, forward: boolean): string {
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  // 4. Bind the two 4-edge toroidal patches into a closed manifold shell
  const torSurf = toroidalSurface(ctx, effCenter, effMajor, effMinor, effZAxis, effXAxis);

  const loop1 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[
      orientedEdge(ec_top0, true),
      orientedEdge(ec_neg0, true),
      orientedEdge(ec_bot0, false),
      orientedEdge(ec_pos0, false),
    ].join(",")}))`,
  );
  const bound1 = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${loop1},.T.)`);
  const face1 = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bound1}),${torSurf},.T.)`);

  const loop2 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[
      orientedEdge(ec_top1, true),
      orientedEdge(ec_pos1, true),
      orientedEdge(ec_bot1, false),
      orientedEdge(ec_neg1, false),
    ].join(",")}))`,
  );
  const bound2 = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${loop2},.T.)`);
  const face2 = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bound2}),${torSurf},.T.)`);

  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${[face1, face2].join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Solid tree → BREP refs ───────────────────────────────────────────────

/** 4x4 column-major identity transformation matrix. */
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Multiplies two 4x4 column-major homogeneous transformation matrices (`a * b`). */
function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      r[col * 4 + row] =
        (a[0 * 4 + row] as number) * (b[col * 4 + 0] as number) +
        (a[1 * 4 + row] as number) * (b[col * 4 + 1] as number) +
        (a[2 * 4 + row] as number) * (b[col * 4 + 2] as number) +
        (a[3 * 4 + row] as number) * (b[col * 4 + 3] as number);
    }
  }
  return r as unknown as Mat4;
}

/**
 * Recursively walk the Solid tree and emit BREP entities for each leaf.
 * Returns an array of MANIFOLD_SOLID_BREP references.
 */
function flattenSolid(ctx: StepContext, solid: Solid, parentMatrix: Mat4): string[] {
  switch (solid.kind) {
    case SolidKind.Box: {
      const brepRef = buildBoxBrep(
        ctx,
        solid.name,
        0,
        0,
        0,
        solid.width / 2,
        solid.height / 2,
        solid.depth / 2,
        parentMatrix,
      );
      return [brepRef];
    }

    case SolidKind.Cylinder: {
      const rBot = solid.radiusBottom ?? solid.radius;
      const rTop = solid.radiusTop ?? solid.radius;
      const brepRef = buildCylinderBrep(ctx, solid.name, rBot, rTop, solid.height, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Sphere: {
      const brepRef = buildSphereBrep(ctx, solid.name, solid.radius, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Torus: {
      const brepRef = buildTorusBrep(ctx, solid.name, solid.major, solid.minor, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Extrusion: {
      // Emit exact prism B-Rep when polygon has >= 3 vertices; otherwise approximate via bounding box
      if (solid.polygon.length >= 3) {
        const brepRef = buildExtrusionBrep(
          ctx,
          solid.name,
          solid.polygon,
          solid.height,
          solid.twist,
          solid.scale,
          parentMatrix,
        );
        return [brepRef];
      }
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [x, y] of solid.polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = solid.height / 2;
      const hw = Math.max(1e-3, (maxX - minX) / 2);
      const hh = Math.max(1e-3, (maxY - minY) / 2);
      const hd = Math.max(1e-3, solid.height / 2);
      const brepRef = buildBoxBrep(ctx, solid.name, cx, cy, cz, hw, hh, hd, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Polyhedron: {
      if (solid.points.length === 0) return [];
      // Emit faceted planar B-Rep when explicit face loops are provided; fallback to AABB box otherwise
      if (solid.faces && solid.faces.length > 0) {
        const brepRef = buildPolyhedronBrep(ctx, solid.name, solid.points, solid.faces, parentMatrix);
        if (brepRef) return [brepRef];
      }
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const [x, y, z] of solid.points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const hw = Math.max(1e-3, (maxX - minX) / 2);
      const hh = Math.max(1e-3, (maxY - minY) / 2);
      const hd = Math.max(1e-3, (maxZ - minZ) / 2);
      const brepRef = buildBoxBrep(ctx, solid.name, cx, cy, cz, hw, hh, hd, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Transform: {
      // Accumulate local transform into parentMatrix and recurse into child solid
      const combined = mat4Multiply(parentMatrix, solid.matrix);
      return flattenSolid(ctx, solid.child, combined);
    }

    case SolidKind.Union:
    case SolidKind.Subtract:
    case SolidKind.Intersect: {
      const left = flattenSolid(ctx, solid.left, parentMatrix);
      const right = flattenSolid(ctx, solid.right, parentMatrix);
      const opName =
        solid.kind === SolidKind.Union ? "UNION" : solid.kind === SolidKind.Subtract ? "DIFFERENCE" : "INTERSECTION";
      if (left[0] && right[0]) {
        emit(ctx, allocId(ctx), `BOOLEAN_RESULT('${solid.name}',.${opName}.,${left[0]},${right[0]})`);
      }
      const brepRef = buildEvaluatedSolidBrep(ctx, solid, parentMatrix);
      if (brepRef) return [brepRef];
      return [...left, ...right];
    }

    case SolidKind.TaggedPatch: {
      return flattenSolid(ctx, solid.child, parentMatrix);
    }

    case SolidKind.Fillet:
    case SolidKind.Chamfer: {
      const brepRef = buildEvaluatedSolidBrep(ctx, solid, parentMatrix);
      if (brepRef) return [brepRef];
      return flattenSolid(ctx, solid.child, parentMatrix);
    }
  }
}

/**
 * Evaluates a solid (boolean CSG or fillet/chamfer) via {@link ManifoldWorker.evaluateSolid},
 * deduplicates its vertices, and emits a faceted `MANIFOLD_SOLID_BREP`.
 */
function buildEvaluatedSolidBrep(ctx: StepContext, solid: Solid, worldMatrix?: Mat4): string | null {
  const mesh = ManifoldWorker.evaluateSolid(solid);
  if (mesh.vertices.length < 9 || mesh.indices.length < 3) return null;

  const points: Vec3[] = [];
  const vertMap = new Map<string, number>();
  const getVertexIndex = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x * 1e5)}_${Math.round(y * 1e5)}_${Math.round(z * 1e5)}`;
    const existing = vertMap.get(key);
    if (existing !== undefined) return existing;
    const idx = points.length;
    points.push([x, y, z]);
    vertMap.set(key, idx);
    return idx;
  };

  const faceLoops: [number, number, number][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i]! * 3;
    const i1 = mesh.indices[i + 1]! * 3;
    const i2 = mesh.indices[i + 2]! * 3;
    const v0 = getVertexIndex(mesh.vertices[i0]!, mesh.vertices[i0 + 1]!, mesh.vertices[i0 + 2]!);
    const v1 = getVertexIndex(mesh.vertices[i1]!, mesh.vertices[i1 + 1]!, mesh.vertices[i1 + 2]!);
    const v2 = getVertexIndex(mesh.vertices[i2]!, mesh.vertices[i2 + 1]!, mesh.vertices[i2 + 2]!);
    if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
      faceLoops.push([v0, v1, v2]);
    }
  }

  if (points.length < 4 || faceLoops.length < 4) return null;
  return buildPolyhedronBrep(ctx, solid.name, points, faceLoops, worldMatrix);
}

/**
 * Emits a faceted planar `MANIFOLD_SOLID_BREP` from an indexed vertex array (`points`)
 * and polygonal `faceLoops`, deduplicating shared undirected `EDGE_CURVE` entities.
 */
function buildPolyhedronBrep(
  ctx: StepContext,
  name: string,
  points: readonly Vec3[],
  faceLoops: readonly (readonly number[])[],
  worldMatrix?: Mat4,
): string | null {
  // 1. Transform vertices to world coordinates and emit VERTEX_POINT entities
  const verts = worldMatrix ? points.map((v) => transformPoint(worldMatrix, v)) : [...points];
  const vp: string[] = verts.map((c, i) => {
    const cp = cartesianPoint(ctx, c);
    return emit(ctx, allocId(ctx), `VERTEX_POINT('v${i}',${cp})`);
  });

  // 2. Deduplicate undirected edges (min(v0, v1), max(v0, v1)) and orient per half-edge traversal direction
  const edgeCache = new Map<string, { ec: string; forward: boolean }>();
  function getOrientedEdge(v0: number, v1: number): string {
    const lo = Math.min(v0, v1);
    const hi = Math.max(v0, v1);
    const key = `${lo}_${hi}`;
    let cached = edgeCache.get(key);
    if (!cached) {
      const p0 = verts[lo] as Vec3;
      const p1 = verts[hi] as Vec3;
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const dz = p1[2] - p0[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const d: Vec3 = len > 0 ? [dx / len, dy / len, dz / len] : [1, 0, 0];
      const dir = direction(ctx, d);
      const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
      const lineOrigin = cartesianPoint(ctx, p0);
      const line = emit(ctx, allocId(ctx), `LINE('',${lineOrigin},${vec})`);
      const ec = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[lo]},${vp[hi]},${line},.T.)`);
      cached = { ec, forward: true };
      edgeCache.set(key, cached);
    }
    const isForward = v0 === lo;
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${cached.ec},${isForward ? ".T." : ".F."})`);
  }

  // 3. Emit an ADVANCED_FACE backed by a PLANE for each valid polygonal loop
  const stepFaces: string[] = [];
  for (const loop of faceLoops) {
    if (!loop || loop.length < 3) continue;
    const valid = loop.every((idx) => idx >= 0 && idx < verts.length);
    if (!valid) continue;
    const oes: string[] = [];
    for (let i = 0; i < loop.length; i++) {
      const v0 = loop[i]!;
      const v1 = loop[(i + 1) % loop.length]!;
      if (v0 === v1) continue;
      oes.push(getOrientedEdge(v0, v1));
    }
    if (oes.length < 3) continue;

    // Compute outward face normal (u x v) and reference tangent direction from the first 3 vertices
    const p0 = verts[loop[0]!]!;
    const p1 = verts[loop[1]!]!;
    const p2 = verts[loop[2]!]!;
    const ux = p1[0] - p0[0],
      uy = p1[1] - p0[1],
      uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0],
      vy = p2[1] - p0[1],
      vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const normal: Vec3 = nLen > 1e-12 ? [nx / nLen, ny / nLen, nz / nLen] : [0, 0, 1];
    const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const refDir: Vec3 = uLen > 1e-12 ? [ux / uLen, uy / uLen, uz / uLen] : [1, 0, 0];

    const edgeLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${oes.join(",")}))`);
    const bound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${edgeLoop},.T.)`);
    const placeRef = axis2Placement3d(ctx, p0, normal, refDir);
    const plane = emit(ctx, allocId(ctx), `PLANE('',${placeRef})`);
    stepFaces.push(emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bound}),${plane},.T.)`));
  }

  if (stepFaces.length === 0) return null;
  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${stepFaces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

/**
 * Emits a faceted `MANIFOLD_SOLID_BREP` for a linear 2D polygon extrusion of `height` along Z,
 * with optional top-cap `twist` (degrees) and uniform `scaleFactor`.
 */
function buildExtrusionBrep(
  ctx: StepContext,
  name: string,
  polygon: readonly [number, number][],
  height: number,
  twist?: number,
  scaleFactor?: number,
  worldMatrix?: Mat4,
): string {
  const N = polygon.length;
  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    signedArea += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1];
  }
  const pts2d: [number, number][] = [];
  if (signedArea < 0) {
    for (let i = N - 1; i >= 0; i--) pts2d.push([polygon[i]![0], polygon[i]![1]]);
  } else {
    for (let i = 0; i < N; i++) pts2d.push([polygon[i]![0], polygon[i]![1]]);
  }

  const rad = twist ? (twist * Math.PI) / 180.0 : 0;
  const cosT = Math.cos(rad);
  const sinT = Math.sin(rad);
  const scl = scaleFactor !== undefined ? scaleFactor : 1.0;

  const localVerts: Vec3[] = [];
  // 0 .. N-1: bottom vertices
  for (let i = 0; i < N; i++) {
    localVerts.push([pts2d[i]![0], pts2d[i]![1], 0]);
  }
  // N .. 2N-1: top vertices
  for (let i = 0; i < N; i++) {
    const [x, y] = pts2d[i]!;
    const tx = (x * cosT - y * sinT) * scl;
    const ty = (x * sinT + y * cosT) * scl;
    localVerts.push([tx, ty, height]);
  }

  const verts = worldMatrix ? localVerts.map((v) => transformPoint(worldMatrix, v)) : localVerts;
  const vp: string[] = verts.map((c, i) => {
    const cp = cartesianPoint(ctx, c);
    return emit(ctx, allocId(ctx), `VERTEX_POINT('v${i}',${cp})`);
  });

  function edgeCurve(v0: number, v1: number): string {
    const p0 = verts[v0] as Vec3;
    const p1 = verts[v1] as Vec3;
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const d: Vec3 = len > 0 ? [dx / len, dy / len, dz / len] : [1, 0, 0];
    const dir = direction(ctx, d);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
    const lineOrigin = cartesianPoint(ctx, p0);
    const line = emit(ctx, allocId(ctx), `LINE('',${lineOrigin},${vec})`);
    return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[v0]},${vp[v1]},${line},.T.)`);
  }

  function orientedEdge(ec: string, forward: boolean): string {
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  function buildFace(oes: string[], planeOrigin: Vec3, planeNormal: Vec3, planeRefDir: Vec3): string {
    const effOrigin = worldMatrix ? transformPoint(worldMatrix, planeOrigin) : planeOrigin;
    const effNormal = worldMatrix ? transformDir(worldMatrix, planeNormal) : planeNormal;
    const effRefDir = worldMatrix ? transformDir(worldMatrix, planeRefDir) : planeRefDir;
    const loop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${oes.join(",")}))`);
    const bound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${loop},.T.)`);
    const placeRef = axis2Placement3d(ctx, effOrigin, effNormal, effRefDir);
    const plane = emit(ctx, allocId(ctx), `PLANE('',${placeRef})`);
    return emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  }

  const botEdges: string[] = [];
  const topEdges: string[] = [];
  const vertEdges: string[] = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    botEdges.push(edgeCurve(i, j));
    topEdges.push(edgeCurve(N + i, N + j));
    vertEdges.push(edgeCurve(i, N + i));
  }

  const faces: string[] = [];
  // Bottom cap face (normal [0, 0, -1])
  const botOes: string[] = [];
  for (let i = N - 1; i >= 0; i--) {
    botOes.push(orientedEdge(botEdges[i]!, false));
  }
  faces.push(buildFace(botOes, localVerts[0]!, [0, 0, -1], [1, 0, 0]));

  // Top cap face (normal [0, 0, 1])
  const topOes: string[] = [];
  for (let i = 0; i < N; i++) {
    topOes.push(orientedEdge(topEdges[i]!, true));
  }
  faces.push(buildFace(topOes, localVerts[N]!, [0, 0, 1], [1, 0, 0]));

  // Side quad faces
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const dx = pts2d[j]![0] - pts2d[i]![0];
    const dy = pts2d[j]![1] - pts2d[i]![1];
    const len = Math.hypot(dx, dy) || 1.0;
    const sideNormal: Vec3 = [dy / len, -dx / len, 0];
    const sideRefDir: Vec3 = [dx / len, dy / len, 0];
    faces.push(
      buildFace(
        [
          orientedEdge(botEdges[i]!, true),
          orientedEdge(vertEdges[j]!, true),
          orientedEdge(topEdges[i]!, false),
          orientedEdge(vertEdges[i]!, false),
        ],
        localVerts[i]!,
        sideNormal,
        sideRefDir,
      ),
    );
  }

  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${faces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Product definition boilerplate ───────────────────────────────────────

/** Emits STEP AP214 `PRODUCT_DEFINITION` and `ADVANCED_BREP_SHAPE_REPRESENTATION` entities linking `brepRefs`. */
function emitProductDefinition(
  ctx: StepContext,
  productName: string,
  brepRefs: string[],
  geomCtx: string,
  appCtx: string,
): void {
  const placementId = allocId(ctx);
  const placement = emit(
    ctx,
    placementId,
    `AXIS2_PLACEMENT_3D('placement',${cartesianPoint(ctx, [0, 0, 0])},${direction(ctx, [0, 0, 1])},${direction(ctx, [1, 0, 0])})`,
  );
  const shapeRepId = allocId(ctx);
  const shapeRep = emit(ctx, shapeRepId, `ADVANCED_BREP_SHAPE_REPRESENTATION('',(${brepRefs.join(",")}),${geomCtx})`);
  const shapeRep2Id = allocId(ctx);
  const shapeRep2 = emit(ctx, shapeRep2Id, `SHAPE_REPRESENTATION('',(${placement}),${geomCtx})`);
  emit(ctx, allocId(ctx), `SHAPE_REPRESENTATION_RELATIONSHIP('SRR','None',${shapeRep2},${shapeRep})`);

  const prodCtxId = allocId(ctx);
  const prodCtx = emit(ctx, prodCtxId, `PRODUCT_CONTEXT('part definition',${appCtx},'mechanical')`);
  const prodId = allocId(ctx);
  const prod = emit(ctx, prodId, `PRODUCT('${productName}','${productName}',$,(${prodCtx}))`);
  const pdfId = allocId(ctx);
  const pdf = emit(ctx, pdfId, `PRODUCT_DEFINITION_FORMATION('',$,${prod})`);
  const pdcId = allocId(ctx);
  const pdc = emit(ctx, pdcId, `PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pdId = allocId(ctx);
  const pd = emit(ctx, pdId, `PRODUCT_DEFINITION('${productName}','${productName}',${pdf},${pdc})`);
  const pdsId = allocId(ctx);
  const pds = emit(ctx, pdsId, `PRODUCT_DEFINITION_SHAPE('',$,${pd})`);
  emit(ctx, allocId(ctx), `SHAPE_DEFINITION_REPRESENTATION(${pds},${shapeRep2})`);
  emit(ctx, allocId(ctx), `PRODUCT_RELATED_PRODUCT_CATEGORY('${productName}','${productName}',(${prod}))`);
}

// ── Global context entities ──────────────────────────────────────────────

/** Emits SI unit (mm, rad, sr), uncertainty, and AP214 application context entities. */
function emitGlobalContext(ctx: StepContext): { geomCtx: string; appCtx: string } {
  const luId = allocId(ctx);
  emit(ctx, luId, `(\nLENGTH_UNIT()\nNAMED_UNIT(*)\nSI_UNIT(.MILLI.,.METRE.)\n)`);
  const auId = allocId(ctx);
  emit(ctx, auId, `(\nNAMED_UNIT(*)\nPLANE_ANGLE_UNIT()\nSI_UNIT($,.RADIAN.)\n)`);
  const sauId = allocId(ctx);
  emit(ctx, sauId, `(\nNAMED_UNIT(*)\nSI_UNIT($,.STERADIAN.)\nSOLID_ANGLE_UNIT()\n)`);

  const umId = allocId(ctx);
  emit(
    ctx,
    umId,
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),${ref(luId)},\n'DISTANCE_ACCURACY_VALUE',\n'Maximum model space distance between geometric entities at asserted connectivities')`,
  );

  const gcId = allocId(ctx);
  const geomCtx = emit(
    ctx,
    gcId,
    `(\nGEOMETRIC_REPRESENTATION_CONTEXT(3)\nGLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${ref(umId)}))\nGLOBAL_UNIT_ASSIGNED_CONTEXT((${ref(luId)},${ref(auId)},${ref(sauId)}))\nREPRESENTATION_CONTEXT('','3D')\n)`,
  );

  const acId = allocId(ctx);
  const appCtx = emit(ctx, acId, `APPLICATION_CONTEXT('Core Data for Automotive Mechanical Design Process')`);
  emit(
    ctx,
    allocId(ctx),
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2009,${appCtx})`,
  );

  return { geomCtx, appCtx };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Compile a single {@link Solid} to an ISO-10303-21 STEP string.
 */
export function compileToStep(solid: Solid, productName?: string): string {
  const ctx = createContext();
  const { geomCtx, appCtx } = emitGlobalContext(ctx);
  const brepRefs = flattenSolid(ctx, solid, IDENTITY);
  emitProductDefinition(ctx, productName ?? solid.name, brepRefs, geomCtx, appCtx);
  return wrapStep(ctx, productName ?? solid.name);
}

/**
 * Compile an {@link Assembly} to an ISO-10303-21 STEP string.
 */
export function compileAssemblyToStep(asm: Assembly): string {
  const ctx = createContext();
  const { geomCtx, appCtx } = emitGlobalContext(ctx);

  for (let i = 0; i < asm.parts.length; i++) {
    const p = asm.parts[i];
    if (!p) continue;
    const refs = flattenSolid(ctx, p.solid, IDENTITY);
    const uniqueName = `${asm.name}_${p.solid.name}_${i}`;
    emitProductDefinition(ctx, uniqueName, refs, geomCtx, appCtx);
  }

  return wrapStep(ctx, asm.name);
}

/** Wraps emitted STEP entity records in an ISO-10303-21 `HEADER` and `DATA` envelope. */
function wrapStep(ctx: StepContext, name: string): string {
  const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(
/* description */ ('${name} - Generated by ModelScript Procedural CAD'),
/* implementation_level */ '2;1');

FILE_NAME(
/* name */ '${name}.stp',
/* time_stamp */ '${new Date().toISOString()}',
/* author */ ('ModelScript'),
/* organization */ ('ModelScript'),
/* preprocessor_version */ 'ModelScript Procedural CAD v1',
/* originating_system */ 'ModelScript IDE',
/* authorisation */ '');

FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;

DATA;`;

  return [header, ...ctx.entities, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
