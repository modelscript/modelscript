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

import type { Assembly, Mat4, Solid, Vec3 } from "./types.js";
import { SolidKind } from "./types.js";

// ── Entity allocator ─────────────────────────────────────────────────────

interface StepContext {
  nextId: number;
  entities: string[];
}

function createContext(): StepContext {
  return { nextId: 10, entities: [] };
}

function allocId(ctx: StepContext): number {
  return ctx.nextId++;
}

function ref(n: number): string {
  return `#${n}`;
}

function emit(ctx: StepContext, eid: number, body: string): string {
  ctx.entities.push(`${ref(eid)}=${body};`);
  return ref(eid);
}

// ── Number formatting ────────────────────────────────────────────────────

function fmt(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e6) return n.toFixed(1);
  return n.toPrecision(15).replace(/\.?0+$/, "") || "0.";
}

// ── Low-level STEP entity builders ───────────────────────────────────────

function cartesianPoint(ctx: StepContext, p: Vec3): string {
  const eid = allocId(ctx);
  return emit(ctx, eid, `CARTESIAN_POINT('',(${p.map(fmt).join(",")}))`);
}

function direction(ctx: StepContext, d: Vec3): string {
  const eid = allocId(ctx);
  return emit(ctx, eid, `DIRECTION('',(${d.map(fmt).join(",")}))`);
}

function axis2Placement3d(ctx: StepContext, origin: Vec3, axis: Vec3, refDir: Vec3): string {
  const o = cartesianPoint(ctx, origin);
  const a = direction(ctx, axis);
  const r = direction(ctx, refDir);
  const eid = allocId(ctx);
  return emit(ctx, eid, `AXIS2_PLACEMENT_3D('',${o},${a},${r})`);
}

function circle(ctx: StepContext, center: Vec3, radius: number, axis: Vec3, refDir: Vec3): string {
  const place = axis2Placement3d(ctx, center, axis, refDir);
  const cid = allocId(ctx);
  return emit(ctx, cid, `CIRCLE('',${place},${fmt(radius)})`);
}

function cylindricalSurface(ctx: StepContext, origin: Vec3, radius: number, axis: Vec3, refDir: Vec3): string {
  const place = axis2Placement3d(ctx, origin, axis, refDir);
  const sid = allocId(ctx);
  return emit(ctx, sid, `CYLINDRICAL_SURFACE('',${place},${fmt(radius)})`);
}

function sphericalSurface(ctx: StepContext, center: Vec3, radius: number, axis: Vec3, refDir: Vec3): string {
  const place = axis2Placement3d(ctx, center, axis, refDir);
  const sid = allocId(ctx);
  return emit(ctx, sid, `SPHERICAL_SURFACE('',${place},${fmt(radius)})`);
}

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

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
}

function transformDir(m: Mat4, d: Vec3): Vec3 {
  const x = (m[0] as number) * d[0] + (m[4] as number) * d[1] + (m[8] as number) * d[2];
  const y = (m[1] as number) * d[0] + (m[5] as number) * d[1] + (m[9] as number) * d[2];
  const z = (m[2] as number) * d[0] + (m[6] as number) * d[1] + (m[10] as number) * d[2];
  const len = Math.sqrt(x * x + y * y + z * z);
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 1];
}

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

function buildCylinderBrep(ctx: StepContext, name: string, radius: number, height: number, worldMatrix?: Mat4): string {
  const hh = height / 2;

  // Local key vertices: 2 on bottom rim, 2 on top rim
  const localV: Vec3[] = [
    [-radius, 0, -hh], // 0: bottom -x
    [radius, 0, -hh], // 1: bottom +x
    [-radius, 0, hh], // 2: top -x
    [radius, 0, hh], // 3: top +x
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
  const botCircle = circle(ctx, effBottomCenter, radius, effZAxis, effXAxis);
  const topCircle = circle(ctx, effTopCenter, radius, effZAxis, effXAxis);

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

  // 3. Lateral Cylindrical Surface
  const cylSurf = cylindricalSurface(ctx, effBottomCenter, radius, effZAxis, effXAxis);

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

function buildSphereBrep(ctx: StepContext, name: string, radius: number, worldMatrix?: Mat4): string {
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
  const meridianCircle = circle(ctx, effCenter, radius, effYAxis, effXAxis);

  // Two semicircle meridian edges from south to north pole and back
  const ec_m0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${meridianCircle},.T.)`);
  const ec_m1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${meridianCircle},.T.)`);

  function orientedEdge(ec: string, forward: boolean): string {
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  const sphSurf = sphericalSurface(ctx, effCenter, radius, effZAxis, effXAxis);

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

function buildTorusBrep(ctx: StepContext, name: string, major: number, minor: number, worldMatrix?: Mat4): string {
  const effCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, 0]) : [0, 0, 0];
  const effZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effXAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];
  const effYAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 1, 0]) : [0, 1, 0];

  const p_pos: Vec3 = worldMatrix ? transformPoint(worldMatrix, [major, 0, 0]) : [major, 0, 0];
  const p_neg: Vec3 = worldMatrix ? transformPoint(worldMatrix, [-major, 0, 0]) : [-major, 0, 0];

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

  const circlePos = circle(ctx, p_pos, minor, effYAxis, effZAxis);
  const ec_pos0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${circlePos},.T.)`);
  const ec_pos1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${circlePos},.T.)`);

  const circleNeg = circle(ctx, p_neg, minor, effYAxis, effZAxis);
  const ec_neg0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[3]},${circleNeg},.T.)`);
  const ec_neg1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[2]},${circleNeg},.T.)`);

  const p_topCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, minor]) : [0, 0, minor];
  const p_botCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, -minor]) : [0, 0, -minor];
  const topCircle = circle(ctx, p_topCenter, major, effZAxis, effXAxis);
  const botCircle = circle(ctx, p_botCenter, major, effZAxis, effXAxis);

  const ec_top0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[2]},${topCircle},.T.)`);
  const ec_top1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[0]},${topCircle},.T.)`);
  const ec_bot0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[3]},${botCircle},.T.)`);
  const ec_bot1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[1]},${botCircle},.T.)`);

  function orientedEdge(ec: string, forward: boolean): string {
    return emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  const torSurf = toroidalSurface(ctx, effCenter, major, minor, effZAxis, effXAxis);

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

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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
      const brepRef = buildCylinderBrep(ctx, solid.name, solid.radius, solid.height, parentMatrix);
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

    case SolidKind.Transform: {
      const combined = mat4Multiply(parentMatrix, solid.matrix);
      return flattenSolid(ctx, solid.child, combined);
    }

    case SolidKind.Union:
    case SolidKind.Subtract:
    case SolidKind.Intersect: {
      // Phase 1: decompose booleans into separate bodies
      const left = flattenSolid(ctx, solid.left, parentMatrix);
      const right = flattenSolid(ctx, solid.right, parentMatrix);
      return [...left, ...right];
    }

    case SolidKind.TaggedPatch:
    case SolidKind.Fillet:
    case SolidKind.Chamfer: {
      return flattenSolid(ctx, solid.child, parentMatrix);
    }
  }
}

// ── Product definition boilerplate ───────────────────────────────────────

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
