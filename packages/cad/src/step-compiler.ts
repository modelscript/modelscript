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

import { computeSolidAABB, transformAABB } from "./clearance.js";
import { ManifoldWorker } from "./manifold-worker.js";
import { serializeStepProvenanceMeta, type StepProvenanceMeta } from "./step-provenance.js";
import { IDENTITY } from "./transforms.js";
import type { Assembly, Mat4, Solid, Vec3 } from "./types.js";
import { SolidKind } from "./types.js";

// ── Public PMI & STEP Options ────────────────────────────────────────────

/** 3D surface or datum anchor extracted from `SolidKind.TaggedPatch` nodes during STEP compilation. */
export interface StepFeatureAnchor {
  readonly name: string;
  readonly portType: string;
  readonly anchor: Vec3;
  readonly normal?: Vec3 | undefined;
}

/** AP242 datum specification synthesized during STEP compilation. */
export interface StepPmiDatumSpec {
  readonly label: string;
  readonly featureName: string;
  readonly anchor?: Vec3 | undefined;
  readonly normal?: Vec3 | undefined;
}

/** AP242 geometric tolerance entity name supported by `step-linter.ts` schema validation. */
export type StepToleranceEntityType =
  | "POSITION_TOLERANCE"
  | "PERPENDICULARITY_TOLERANCE"
  | "PARALLELISM_TOLERANCE"
  | "CONCENTRICITY_TOLERANCE"
  | "FLATNESS_TOLERANCE"
  | "CYLINDRICITY_TOLERANCE"
  | "CIRCULARITY_TOLERANCE"
  | "TOTAL_RUNOUT_TOLERANCE"
  | "CIRCULAR_RUNOUT_TOLERANCE"
  | "RUNOUT_TOLERANCE"
  | "SURFACE_PROFILE_TOLERANCE"
  | "LINE_PROFILE_TOLERANCE"
  | "GEOMETRIC_TOLERANCE";

/** AP242 GD&T characteristic specification bound to a symbolic feature name and/or 3D anchor. */
export interface StepPmiToleranceSpec {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly characteristic: StepToleranceEntityType;
  readonly zoneValue: number;
  readonly materialCondition?: "RFS" | "MMC" | "LMC" | undefined;
  readonly datumRefs?: readonly string[] | undefined;
  readonly featureName?: string | undefined;
  readonly anchor?: Vec3 | undefined;
}

/** Optional AP242 PMI payload compiled alongside geometry. */
export interface StepPmiSpec {
  readonly datums?: readonly StepPmiDatumSpec[] | undefined;
  readonly tolerances?: readonly StepPmiToleranceSpec[] | undefined;
}

/** Compilation options controlling STEP schema, units, part naming, and embedded PMI. */
export interface StepCompileOptions {
  readonly schema?: "AP214" | "AP242" | undefined;
  readonly lengthUnit?: "mm" | "m" | undefined;
  readonly uncertainty?: number | undefined;
  readonly preservePartNames?: boolean | undefined;
  readonly pmi?: StepPmiSpec | undefined;
  /** Deterministic ISO timestamp override (useful for golden/snapshot diffs). */
  readonly timeStamp?: string | undefined;
  /** Optional ModelScript provenance metadata embedded inside STEP HEADER;. */
  readonly provenance?: StepProvenanceMeta | undefined;
}

// ── Entity allocator ─────────────────────────────────────────────────────

/** Mutable accumulator holding the next STEP entity ID (`#N`), emitted DATA lines, and discovered feature anchors. */
interface StepContext {
  /** Next available 1-based STEP entity ID. */
  nextId: number;
  /** Emitted ISO-10303-21 entity assignment records (`#id=ENTITY(...);`). */
  entities: string[];
  /** Deduplicated world-space anchors collected from `TaggedPatch` solids. */
  featureAnchors: Map<string, StepFeatureAnchor>;
}

/** Creates an empty {@link StepContext} starting at entity ID `#10`. */
function createContext(): StepContext {
  return { nextId: 10, entities: [], featureAnchors: new Map() };
}

/** Allocates and returns the next sequential STEP entity ID in `ctx`. */
function allocId(ctx: StepContext): number {
  return ctx.nextId++;
}

/** Formats a numeric STEP entity ID `n` as a `#n` reference string. */
function ref(n: number): string {
  return `#${n}`;
}

/** Escapes single quotes for ISO-10303-21 string literals. */
function escStepStr(value: string): string {
  return value.replace(/'/g, "''");
}

/** Appends a `#eid=body;` record to `ctx.entities` and returns `#eid`. */
function emit(ctx: StepContext, eid: number, body: string): string {
  ctx.entities.push(`${ref(eid)}=${body};`);
  return ref(eid);
}

// ── Number formatting ────────────────────────────────────────────────────

/** Formats a floating-point coordinate or measure for strict ISO-10303-21 Part 21 syntax. */
function fmt(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-12) return "0.0";
  if (Number.isInteger(n) && Math.abs(n) < 1e9) return n.toFixed(1);
  const raw = Number(n.toPrecision(12));
  if (Math.abs(raw) < 1e-12) return "0.0";
  let s = raw.toString().replace("e", "E");
  if (s.includes("E")) {
    const [mant, exp] = s.split("E");
    const fixedMant = (mant!.includes(".") ? mant! : `${mant}.`).replace(/(\.\d*?[1-9])0+$/, "$1");
    return `${fixedMant}E${exp}`;
  }
  if (!s.includes(".")) s += ".0";
  return s;
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
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${escStepStr(name)}',${shell})`);
}

/**
 * Emits an exact analytical ISO-10303-21 `MANIFOLD_SOLID_BREP` for a coaxial annular hollow cylinder
 * (`rInner < rOuter`, `height`), with `FACE_OUTER_BOUND` + inner `FACE_BOUND` planar annular end caps
 * and inward-oriented `.F.` inner bore cylindrical walls. Supports blind coaxial bores terminating at `zFloorLocal`.
 */
function buildHollowCylinderBrep(
  ctx: StepContext,
  name: string,
  rOuter: number,
  rInner: number,
  height: number,
  worldMatrix?: Mat4,
  zFloorLocal?: number,
): string {
  const hh = height / 2;
  const rOut = Math.max(1e-5, rOuter);
  const rIn = Math.max(1e-6, Math.min(rInner, rOut - 1e-6));
  const isThrough = zFloorLocal === undefined || zFloorLocal <= -hh + 1e-4;
  const zBoreBot = isThrough ? -hh : Math.min(hh - 1e-4, Math.max(-hh + 1e-4, zFloorLocal));
  const s = matrixScale(worldMatrix);
  const effROut = rOut * s;
  const effRIn = rIn * s;

  const localV: Vec3[] = [
    [-rOut, 0, -hh], // 0: outer bottom -x
    [rOut, 0, -hh], // 1: outer bottom +x
    [-rOut, 0, hh], // 2: outer top -x
    [rOut, 0, hh], // 3: outer top +x
    [-rIn, 0, zBoreBot], // 4: inner bottom -x
    [rIn, 0, zBoreBot], // 5: inner bottom +x
    [-rIn, 0, hh], // 6: inner top -x
    [rIn, 0, hh], // 7: inner top +x
  ];
  const corners = worldMatrix ? localV.map((c) => transformPoint(worldMatrix, c)) : localV;
  const vp = corners.map((c, i) => emit(ctx, allocId(ctx), `VERTEX_POINT('hcv${i}',${cartesianPoint(ctx, c)})`));

  const effBottomCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, -hh]) : [0, 0, -hh];
  const effBoreFloorCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, zBoreBot]) : [0, 0, zBoreBot];
  const effTopCenter: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, hh]) : [0, 0, hh];
  const effZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effXAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];
  const effOppZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, -1]) : [0, 0, -1];

  const botOuterCircle = circle(ctx, effBottomCenter, effROut, effZAxis, effXAxis);
  const topOuterCircle = circle(ctx, effTopCenter, effROut, effZAxis, effXAxis);
  const botInnerCircle = circle(ctx, effBoreFloorCenter, effRIn, effZAxis, effXAxis);
  const topInnerCircle = circle(ctx, effTopCenter, effRIn, effZAxis, effXAxis);

  const ec_ob0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${botOuterCircle},.T.)`);
  const ec_ob1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${botOuterCircle},.T.)`);
  const ec_ot0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[3]},${topOuterCircle},.T.)`);
  const ec_ot1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[2]},${topOuterCircle},.T.)`);

  const ec_ib0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[4]},${vp[5]},${botInnerCircle},.T.)`);
  const ec_ib1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[5]},${vp[4]},${botInnerCircle},.T.)`);
  const ec_it0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[6]},${vp[7]},${topInnerCircle},.T.)`);
  const ec_it1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[7]},${vp[6]},${topInnerCircle},.T.)`);

  function lineEdge(v0: number, v1: number): string {
    const p0 = corners[v0] as Vec3;
    const p1 = corners[v1] as Vec3;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const dir = direction(ctx, [dx / len, dy / len, dz / len]);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
    const line = emit(ctx, allocId(ctx), `LINE('',${cartesianPoint(ctx, p0)},${vec})`);
    return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[v0]},${vp[v1]},${line},.T.)`);
  }

  const ec_os0 = lineEdge(0, 2);
  const ec_os1 = lineEdge(1, 3);
  const ec_is0 = lineEdge(4, 6);
  const ec_is1 = lineEdge(5, 7);

  const oe = (ec: string, forward: boolean) =>
    emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);

  // Bottom cap: annular for through-hole, solid circular disk for blind top bore
  const botPlane = emit(
    ctx,
    allocId(ctx),
    `PLANE('',${axis2Placement3d(ctx, effBottomCenter, effOppZAxis, effXAxis)})`,
  );
  const botOuterLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ob1, false), oe(ec_ob0, false)].join(",")}))`);
  const botOuterBound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${botOuterLoop},.T.)`);
  const botBounds: string[] = [botOuterBound];
  if (isThrough) {
    const botInnerLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ib0, true), oe(ec_ib1, true)].join(",")}))`);
    botBounds.push(emit(ctx, allocId(ctx), `FACE_BOUND('',${botInnerLoop},.T.)`));
  }
  const botFace = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${botBounds.join(",")}),${botPlane},.T.)`);

  // Top annular cap (normal +zAxis): outer CCW around +Z, inner hole CW around +Z
  const topPlane = emit(ctx, allocId(ctx), `PLANE('',${axis2Placement3d(ctx, effTopCenter, effZAxis, effXAxis)})`);
  const topOuterLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ot0, true), oe(ec_ot1, true)].join(",")}))`);
  const topInnerLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_it1, false), oe(ec_it0, false)].join(",")}))`);
  const topOuterBound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${topOuterLoop},.T.)`);
  const topInnerBound = emit(ctx, allocId(ctx), `FACE_BOUND('',${topInnerLoop},.T.)`);
  const topFace = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${topOuterBound},${topInnerBound}),${topPlane},.T.)`);

  // Outer cylindrical shell (.T.)
  const outerCylSurf = cylindricalSurface(ctx, effBottomCenter, effROut, effZAxis, effXAxis);
  const outLoop1 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_ob0, true), oe(ec_os1, true), oe(ec_ot0, false), oe(ec_os0, false)].join(",")}))`,
  );
  const outFace1 = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${outLoop1},.T.)`)}),${outerCylSurf},.T.)`,
  );
  const outLoop2 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_ob1, true), oe(ec_os0, true), oe(ec_ot1, false), oe(ec_os1, false)].join(",")}))`,
  );
  const outFace2 = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${outLoop2},.T.)`)}),${outerCylSurf},.T.)`,
  );

  // Inner cylindrical bore walls (.F. — reverses outward normal radially inward into bore)
  const innerCylSurf = cylindricalSurface(ctx, effBoreFloorCenter, effRIn, effZAxis, effXAxis);
  const inLoop1 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_it0, true), oe(ec_is1, false), oe(ec_ib0, false), oe(ec_is0, true)].join(",")}))`,
  );
  const inFace1 = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${inLoop1},.T.)`)}),${innerCylSurf},.F.)`,
  );
  const inLoop2 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_it1, true), oe(ec_is0, false), oe(ec_ib1, false), oe(ec_is1, true)].join(",")}))`,
  );
  const inFace2 = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${inLoop2},.T.)`)}),${innerCylSurf},.F.)`,
  );

  const faces: string[] = [botFace, topFace, outFace1, outFace2, inFace1, inFace2];
  if (!isThrough) {
    const floorPlane = emit(
      ctx,
      allocId(ctx),
      `PLANE('',${axis2Placement3d(ctx, effBoreFloorCenter, effZAxis, effXAxis)})`,
    );
    const floorLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ib0, true), oe(ec_ib1, true)].join(",")}))`);
    const floorBound = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${floorLoop},.T.)`);
    faces.push(emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${floorBound}),${floorPlane},.T.)`));
  }

  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${faces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${escStepStr(name)}',${shell})`);
}

/** Unwraps nested Transform/TaggedPatch nodes around a leaf solid, collecting feature anchors and net matrix. */
function unwrapLeafWithTags(ctx: StepContext, solid: Solid, parentMatrix: Mat4): { leaf: Solid; worldMatrix: Mat4 } {
  let curr: Solid = solid;
  let mat: Mat4 = parentMatrix;
  while (curr.kind === SolidKind.Transform || curr.kind === SolidKind.TaggedPatch) {
    if (curr.kind === SolidKind.Transform) {
      mat = mat4Multiply(mat, curr.matrix);
      curr = curr.child;
    } else {
      recordTaggedPatchAnchor(ctx, curr, mat);
      curr = curr.child;
    }
  }
  return { leaf: curr, worldMatrix: mat };
}

/**
 * Recognizes `Subtract(Cylinder_outer, Cylinder_inner)` when both cylinders are right-circular
 * and coaxial, emitting an exact analytical hollow or blind-bore cylinder B-Rep.
 */
function tryBuildHollowCylinderBrep(
  ctx: StepContext,
  solid: Extract<Solid, { left: Solid; right: Solid }>,
  parentMatrix: Mat4,
  brepName: string,
): string | null {
  const outer = unwrapLeafWithTags(ctx, solid.left, parentMatrix);
  const inner = unwrapLeafWithTags(ctx, solid.right, parentMatrix);
  if (outer.leaf.kind !== SolidKind.Cylinder || inner.leaf.kind !== SolidKind.Cylinder) return null;

  const rOutBot = outer.leaf.radiusBottom ?? outer.leaf.radius;
  const rOutTop = outer.leaf.radiusTop ?? outer.leaf.radius;
  const rInBot = inner.leaf.radiusBottom ?? inner.leaf.radius;
  const rInTop = inner.leaf.radiusTop ?? inner.leaf.radius;
  if (Math.abs(rOutBot - rOutTop) > 1e-6 || Math.abs(rInBot - rInTop) > 1e-6) return null;

  const sOut = matrixScale(outer.worldMatrix);
  const sIn = matrixScale(inner.worldMatrix);
  const rOut = rOutBot * sOut;
  const rIn = rInBot * sIn;
  if (!(rIn > 1e-6 && rOut > rIn + 1e-6)) return null;

  const cOut = transformPoint(outer.worldMatrix, [0, 0, 0]);
  const cIn = transformPoint(inner.worldMatrix, [0, 0, 0]);
  const zOut = transformDir(outer.worldMatrix, [0, 0, 1]);
  const zIn = transformDir(inner.worldMatrix, [0, 0, 1]);
  const crossMag = Math.hypot(
    zOut[1] * zIn[2] - zOut[2] * zIn[1],
    zOut[2] * zIn[0] - zOut[0] * zIn[2],
    zOut[0] * zIn[1] - zOut[1] * zIn[0],
  );
  if (crossMag > 1e-4) return null;

  const dx = cIn[0] - cOut[0];
  const dy = cIn[1] - cOut[1];
  const dz = cIn[2] - cOut[2];
  const axialOffset = dx * zOut[0] + dy * zOut[1] + dz * zOut[2];
  const radialOffset = Math.hypot(dx - axialOffset * zOut[0], dy - axialOffset * zOut[1], dz - axialOffset * zOut[2]);
  if (radialOffset > 1e-4) return null;

  const zTopOut = transformPoint(outer.worldMatrix, [0, 0, outer.leaf.height / 2]);
  const zBotOut = transformPoint(outer.worldMatrix, [0, 0, -outer.leaf.height / 2]);
  const hOutWorld = Math.hypot(zTopOut[0] - zBotOut[0], zTopOut[1] - zBotOut[1], zTopOut[2] - zBotOut[2]);

  const zTopIn = transformPoint(inner.worldMatrix, [0, 0, inner.leaf.height / 2]);
  const zBotIn = transformPoint(inner.worldMatrix, [0, 0, -inner.leaf.height / 2]);
  const hInWorld = Math.hypot(zTopIn[0] - zBotIn[0], zTopIn[1] - zBotIn[1], zTopIn[2] - zBotIn[2]);

  if (hOutWorld <= 1e-6) return null;
  const hhOut = outer.leaf.height / 2;
  const minInLocal = (axialOffset - hInWorld / 2) / sOut;
  const maxInLocal = (axialOffset + hInWorld / 2) / sOut;
  const clearsTop = maxInLocal >= hhOut - 1e-4;
  const clearsBot = minInLocal <= -hhOut + 1e-4;

  if (clearsTop && clearsBot) {
    return buildHollowCylinderBrep(ctx, brepName, rOutBot, rIn / sOut, outer.leaf.height, outer.worldMatrix);
  }
  if (clearsTop && minInLocal > -hhOut + 1e-4 && minInLocal < hhOut - 1e-4) {
    return buildHollowCylinderBrep(
      ctx,
      brepName,
      rOutBot,
      rIn / sOut,
      outer.leaf.height,
      outer.worldMatrix,
      minInLocal,
    );
  }
  if (clearsBot && maxInLocal > -hhOut + 1e-4 && maxInLocal < hhOut - 1e-4) {
    // Flip local Z by rotating 180 deg around local X so the bottom bore opens along +Z'
    const flipX180: Mat4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
    return buildHollowCylinderBrep(
      ctx,
      brepName,
      rOutBot,
      rIn / sOut,
      outer.leaf.height,
      mat4Multiply(outer.worldMatrix, flipX180),
      -maxInLocal,
    );
  }
  return null;
}

/**
 * Emits an analytical `MANIFOLD_SOLID_BREP` for an axis-aligned rectangular plate (`width x height x depth`)
 * with an analytical cylindrical Z through-hole at `(hx, hy)` of radius `holeRadius`, preserving `PLANE` caps
 * with `FACE_BOUND` circular inner loops and `.F.` internal `CYLINDRICAL_SURFACE` bore walls.
 */
function buildBoxWithHoleBrep(
  ctx: StepContext,
  name: string,
  width: number,
  height: number,
  depth: number,
  hx: number,
  hy: number,
  holeRadius: number,
  worldMatrix?: Mat4,
  zFloorLocal?: number,
): string {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const isThrough = zFloorLocal === undefined || zFloorLocal <= -hd + 1e-4;
  const zBoreBot = isThrough ? -hd : Math.min(hd - 1e-4, Math.max(-hd + 1e-4, zFloorLocal));
  const s = matrixScale(worldMatrix);
  const effR = holeRadius * s;

  const localV: Vec3[] = [
    [-hw, -hh, -hd], // 0
    [hw, -hh, -hd], // 1
    [hw, hh, -hd], // 2
    [-hw, hh, -hd], // 3
    [-hw, -hh, hd], // 4
    [hw, -hh, hd], // 5
    [hw, hh, hd], // 6
    [-hw, hh, hd], // 7
    [hx - holeRadius, hy, zBoreBot], // 8: bore bot -x
    [hx + holeRadius, hy, zBoreBot], // 9: bore bot +x
    [hx - holeRadius, hy, hd], // 10: bore top -x
    [hx + holeRadius, hy, hd], // 11: bore top +x
  ];
  const pts = worldMatrix ? localV.map((v) => transformPoint(worldMatrix, v)) : localV;
  const vp = pts.map((p, i) => emit(ctx, allocId(ctx), `VERTEX_POINT('bh${i}',${cartesianPoint(ctx, p)})`));

  const lineEdge = (a: number, b: number): string => {
    const p0 = pts[a]!;
    const p1 = pts[b]!;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const dir = direction(ctx, [dx / len, dy / len, dz / len]);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
    const ln = emit(ctx, allocId(ctx), `LINE('',${cartesianPoint(ctx, p0)},${vec})`);
    return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[a]},${vp[b]},${ln},.T.)`);
  };
  const oe = (ec: string, fwd: boolean) =>
    emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${fwd ? ".T." : ".F."})`);

  const effBotHole: Vec3 = worldMatrix ? transformPoint(worldMatrix, [hx, hy, zBoreBot]) : [hx, hy, zBoreBot];
  const effTopHole: Vec3 = worldMatrix ? transformPoint(worldMatrix, [hx, hy, hd]) : [hx, hy, hd];
  const effZ: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effX: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];
  const effY: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 1, 0]) : [0, 1, 0];
  const effOppZ: Vec3 = [-effZ[0], -effZ[1], -effZ[2]];
  const effOppX: Vec3 = [-effX[0], -effX[1], -effX[2]];
  const effOppY: Vec3 = [-effY[0], -effY[1], -effY[2]];

  const botCircle = circle(ctx, effBotHole, effR, effZ, effX);
  const topCircle = circle(ctx, effTopHole, effR, effZ, effX);
  const ec_ib0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[8]},${vp[9]},${botCircle},.T.)`);
  const ec_ib1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[9]},${vp[8]},${botCircle},.T.)`);
  const ec_it0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[10]},${vp[11]},${topCircle},.T.)`);
  const ec_it1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[11]},${vp[10]},${topCircle},.T.)`);
  const ec_is0 = lineEdge(8, 10);
  const ec_is1 = lineEdge(9, 11);

  const b01 = lineEdge(0, 1),
    b12 = lineEdge(1, 2),
    b23 = lineEdge(2, 3),
    b30 = lineEdge(3, 0);
  const t45 = lineEdge(4, 5),
    t56 = lineEdge(5, 6),
    t67 = lineEdge(6, 7),
    t74 = lineEdge(7, 4);
  const v04 = lineEdge(0, 4),
    v15 = lineEdge(1, 5),
    v26 = lineEdge(2, 6),
    v37 = lineEdge(3, 7);

  const planarFace = (originLocal: Vec3, normDir: Vec3, refDir: Vec3, edgeIds: string[]) => {
    const oWorld = worldMatrix ? transformPoint(worldMatrix, originLocal) : originLocal;
    const pl = emit(ctx, allocId(ctx), `PLANE('',${axis2Placement3d(ctx, oWorld, normDir, refDir)})`);
    const lp = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${edgeIds.join(",")}))`);
    const bnd = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${lp},.T.)`);
    return emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bnd}),${pl},.T.)`);
  };

  const botPlane = emit(
    ctx,
    allocId(ctx),
    `PLANE('',${axis2Placement3d(ctx, worldMatrix ? transformPoint(worldMatrix, [0, 0, -hd]) : [0, 0, -hd], effOppZ, effX)})`,
  );
  const botOuter = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(b01, false), oe(b30, false), oe(b23, false), oe(b12, false)].join(",")}))`,
  );
  const botBounds = [emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${botOuter},.T.)`)];
  if (isThrough) {
    const botInner = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ib0, true), oe(ec_ib1, true)].join(",")}))`);
    botBounds.push(emit(ctx, allocId(ctx), `FACE_BOUND('',${botInner},.T.)`));
  }
  const fBot = emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${botBounds.join(",")}),${botPlane},.T.)`);

  const topPlane = emit(
    ctx,
    allocId(ctx),
    `PLANE('',${axis2Placement3d(ctx, worldMatrix ? transformPoint(worldMatrix, [0, 0, hd]) : [0, 0, hd], effZ, effX)})`,
  );
  const topOuter = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(t45, true), oe(t56, true), oe(t67, true), oe(t74, true)].join(",")}))`,
  );
  const topInner = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_it1, false), oe(ec_it0, false)].join(",")}))`);
  const fTop = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${topOuter},.T.)`)},${emit(ctx, allocId(ctx), `FACE_BOUND('',${topInner},.T.)`)}),${topPlane},.T.)`,
  );

  const fFront = planarFace([0, -hh, 0], effOppY, effX, [oe(b01, true), oe(v15, true), oe(t45, false), oe(v04, false)]);
  const fBack = planarFace([0, hh, 0], effY, effOppX, [oe(b23, true), oe(v37, true), oe(t67, false), oe(v26, false)]);
  const fRight = planarFace([hw, 0, 0], effX, effY, [oe(b12, true), oe(v26, true), oe(t56, false), oe(v15, false)]);
  const fLeft = planarFace([-hw, 0, 0], effOppX, effOppY, [
    oe(b30, true),
    oe(v04, true),
    oe(t74, false),
    oe(v37, false),
  ]);

  const boreSurf = cylindricalSurface(ctx, effBotHole, effR, effZ, effX);
  const boreLoop1 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_it0, true), oe(ec_is1, false), oe(ec_ib0, false), oe(ec_is0, true)].join(",")}))`,
  );
  const boreLoop2 = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_it1, true), oe(ec_is0, false), oe(ec_ib1, false), oe(ec_is1, true)].join(",")}))`,
  );
  const fBore1 = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${boreLoop1},.T.)`)}),${boreSurf},.F.)`,
  );
  const fBore2 = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${boreLoop2},.T.)`)}),${boreSurf},.F.)`,
  );

  const shellFaces = [fBot, fTop, fFront, fBack, fRight, fLeft, fBore1, fBore2];
  if (!isThrough) {
    // Blind-hole flat bottom PLANE cap facing +Z inside pocket
    shellFaces.push(planarFace([hx, hy, zBoreBot], effZ, effX, [oe(ec_ib0, true), oe(ec_ib1, true)]));
  }
  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${shellFaces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${escStepStr(name)}',${shell})`);
}

/**
 * Recognizes `Subtract(Box, Cylinder)` when a right-circular cylinder aligns with the Box's Z axis
 * and forms either a through-hole or a top-entry blind hole inside the Box's XY footprint.
 */
function tryBuildBoxWithHoleBrep(
  ctx: StepContext,
  solid: Extract<Solid, { left: Solid; right: Solid }>,
  parentMatrix: Mat4,
  brepName: string,
): string | null {
  const outer = unwrapLeafWithTags(ctx, solid.left, parentMatrix);
  const inner = unwrapLeafWithTags(ctx, solid.right, parentMatrix);
  if (outer.leaf.kind !== SolidKind.Box || inner.leaf.kind !== SolidKind.Cylinder) return null;

  const rBot = inner.leaf.radiusBottom ?? inner.leaf.radius;
  const rTop = inner.leaf.radiusTop ?? inner.leaf.radius;
  if (Math.abs(rBot - rTop) > 1e-6) return null;

  const sOut = matrixScale(outer.worldMatrix);
  const sIn = matrixScale(inner.worldMatrix);
  const rLocal = (rBot * sIn) / sOut;
  if (!(rLocal > 1e-6)) return null;

  const cOut = transformPoint(outer.worldMatrix, [0, 0, 0]);
  const cIn = transformPoint(inner.worldMatrix, [0, 0, 0]);
  const uX = transformDir(outer.worldMatrix, [1, 0, 0]);
  const uY = transformDir(outer.worldMatrix, [0, 1, 0]);
  const uZ = transformDir(outer.worldMatrix, [0, 0, 1]);
  const zIn = transformDir(inner.worldMatrix, [0, 0, 1]);

  const zCross = Math.hypot(
    uZ[1] * zIn[2] - uZ[2] * zIn[1],
    uZ[2] * zIn[0] - uZ[0] * zIn[2],
    uZ[0] * zIn[1] - uZ[1] * zIn[0],
  );
  if (zCross > 1e-4) return null;

  const d = [cIn[0] - cOut[0], cIn[1] - cOut[1], cIn[2] - cOut[2]];
  const hx = (d[0]! * uX[0] + d[1]! * uX[1] + d[2]! * uX[2]) / sOut;
  const hy = (d[0]! * uY[0] + d[1]! * uY[1] + d[2]! * uY[2]) / sOut;
  const hz = (d[0]! * uZ[0] + d[1]! * uZ[1] + d[2]! * uZ[2]) / sOut;

  const zTopIn = transformPoint(inner.worldMatrix, [0, 0, inner.leaf.height / 2]);
  const zBotIn = transformPoint(inner.worldMatrix, [0, 0, -inner.leaf.height / 2]);
  const hInLocal = Math.hypot(zTopIn[0] - zBotIn[0], zTopIn[1] - zBotIn[1], zTopIn[2] - zBotIn[2]) / sOut;

  if (Math.abs(hx) + rLocal >= outer.leaf.width / 2 - 1e-3) return null;
  if (Math.abs(hy) + rLocal >= outer.leaf.height / 2 - 1e-3) return null;

  const hd = outer.leaf.depth / 2;
  const cylBot = hz - hInLocal / 2;
  const cylTop = hz + hInLocal / 2;
  if (cylTop < hd - 1e-4) return null;
  if (cylBot >= hd - 1e-3) return null;

  const isThrough = cylBot <= -hd + 1e-4;
  return buildBoxWithHoleBrep(
    ctx,
    brepName,
    outer.leaf.width,
    outer.leaf.height,
    outer.leaf.depth,
    hx,
    hy,
    rLocal,
    outer.worldMatrix,
    isThrough ? undefined : cylBot,
  );
}

/**
 * Recognizes `Subtract(Box, Box)` when an aligned rectangular cutout clears the top & bottom Z faces
 * strictly within the outer box's XY bounds, emitting a 10-face analytical `PLANE` B-Rep with `FACE_BOUND`.
 */
function tryBuildBoxSlotBrep(
  ctx: StepContext,
  solid: Extract<Solid, { left: Solid; right: Solid }>,
  parentMatrix: Mat4,
  brepName: string,
): string | null {
  const outer = unwrapLeafWithTags(ctx, solid.left, parentMatrix);
  const inner = unwrapLeafWithTags(ctx, solid.right, parentMatrix);
  if (outer.leaf.kind !== SolidKind.Box || inner.leaf.kind !== SolidKind.Box) return null;

  const sOut = matrixScale(outer.worldMatrix);
  const sIn = matrixScale(inner.worldMatrix);
  const uX = transformDir(outer.worldMatrix, [1, 0, 0]);
  const uY = transformDir(outer.worldMatrix, [0, 1, 0]);
  const uZ = transformDir(outer.worldMatrix, [0, 0, 1]);
  const vX = transformDir(inner.worldMatrix, [1, 0, 0]);
  const vY = transformDir(inner.worldMatrix, [0, 1, 0]);
  const vZ = transformDir(inner.worldMatrix, [0, 0, 1]);

  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (Math.abs(dot(uX, vX) - 1) > 1e-4 || Math.abs(dot(uY, vY) - 1) > 1e-4 || Math.abs(dot(uZ, vZ) - 1) > 1e-4) {
    return null;
  }

  const cOut = transformPoint(outer.worldMatrix, [0, 0, 0]);
  const cIn = transformPoint(inner.worldMatrix, [0, 0, 0]);
  const d: Vec3 = [cIn[0] - cOut[0], cIn[1] - cOut[1], cIn[2] - cOut[2]];
  const cx = dot(d, uX) / sOut;
  const cy = dot(d, uY) / sOut;
  const cz = dot(d, uZ) / sOut;

  const ihw = (inner.leaf.width * sIn) / (2 * sOut);
  const ihh = (inner.leaf.height * sIn) / (2 * sOut);
  const ihd = (inner.leaf.depth * sIn) / (2 * sOut);
  const hw = outer.leaf.width / 2;
  const hh = outer.leaf.height / 2;
  const hd = outer.leaf.depth / 2;

  if (cz - ihd > -hd + 1e-4 || cz + ihd < hd - 1e-4) return null;
  if (cx - ihw <= -hw + 1e-3 || cx + ihw >= hw - 1e-3) return null;
  if (cy - ihh <= -hh + 1e-3 || cy + ihh >= hh - 1e-3) return null;

  const localV: Vec3[] = [
    [-hw, -hh, -hd],
    [hw, -hh, -hd],
    [hw, hh, -hd],
    [-hw, hh, -hd],
    [-hw, -hh, hd],
    [hw, -hh, hd],
    [hw, hh, hd],
    [-hw, hh, hd],
    [cx - ihw, cy - ihh, -hd],
    [cx + ihw, cy - ihh, -hd],
    [cx + ihw, cy + ihh, -hd],
    [cx - ihw, cy + ihh, -hd],
    [cx - ihw, cy - ihh, hd],
    [cx + ihw, cy - ihh, hd],
    [cx + ihw, cy + ihh, hd],
    [cx - ihw, cy + ihh, hd],
  ];
  const pts = localV.map((v) => transformPoint(outer.worldMatrix, v));
  const vp = pts.map((p, i) => emit(ctx, allocId(ctx), `VERTEX_POINT('bs${i}',${cartesianPoint(ctx, p)})`));
  const lineEdge = (a: number, b: number): string => {
    const p0 = pts[a]!;
    const p1 = pts[b]!;
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    const dir = direction(ctx, [dx / len, dy / len, dz / len]);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
    const ln = emit(ctx, allocId(ctx), `LINE('',${cartesianPoint(ctx, p0)},${vec})`);
    return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[a]},${vp[b]},${ln},.T.)`);
  };
  const oe = (ec: string, fwd: boolean) =>
    emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${fwd ? ".T." : ".F."})`);
  const planeFace = (originLocal: Vec3, n: Vec3, ref: Vec3, loopEdges: string[], innerLoopEdges?: string[]) => {
    const pl = emit(
      ctx,
      allocId(ctx),
      `PLANE('',${axis2Placement3d(ctx, transformPoint(outer.worldMatrix, originLocal), n, ref)})`,
    );
    const outerLp = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${loopEdges.join(",")}))`);
    const bounds = [emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${outerLp},.T.)`)];
    if (innerLoopEdges) {
      const innerLp = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${innerLoopEdges.join(",")}))`);
      bounds.push(emit(ctx, allocId(ctx), `FACE_BOUND('',${innerLp},.T.)`));
    }
    return emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bounds.join(",")}),${pl},.T.)`);
  };

  const oppX: Vec3 = [-uX[0], -uX[1], -uX[2]];
  const oppY: Vec3 = [-uY[0], -uY[1], -uY[2]];
  const oppZ: Vec3 = [-uZ[0], -uZ[1], -uZ[2]];

  const b01 = lineEdge(0, 1),
    b12 = lineEdge(1, 2),
    b23 = lineEdge(2, 3),
    b30 = lineEdge(3, 0);
  const t45 = lineEdge(4, 5),
    t56 = lineEdge(5, 6),
    t67 = lineEdge(6, 7),
    t74 = lineEdge(7, 4);
  const v04 = lineEdge(0, 4),
    v15 = lineEdge(1, 5),
    v26 = lineEdge(2, 6),
    v37 = lineEdge(3, 7);
  const ib01 = lineEdge(8, 9),
    ib12 = lineEdge(9, 10),
    ib23 = lineEdge(10, 11),
    ib30 = lineEdge(11, 8);
  const it01 = lineEdge(12, 13),
    it12 = lineEdge(13, 14),
    it23 = lineEdge(14, 15),
    it30 = lineEdge(15, 12);
  const iv0 = lineEdge(8, 12),
    iv1 = lineEdge(9, 13),
    iv2 = lineEdge(10, 14),
    iv3 = lineEdge(11, 15);

  const fBot = planeFace(
    [0, 0, -hd],
    oppZ,
    uX,
    [oe(b01, false), oe(b30, false), oe(b23, false), oe(b12, false)],
    [oe(ib01, true), oe(ib12, true), oe(ib23, true), oe(ib30, true)],
  );
  const fTop = planeFace(
    [0, 0, hd],
    uZ,
    uX,
    [oe(t45, true), oe(t56, true), oe(t67, true), oe(t74, true)],
    [oe(it01, false), oe(it30, false), oe(it23, false), oe(it12, false)],
  );
  const faces = [
    fBot,
    fTop,
    planeFace([0, -hh, 0], oppY, uX, [oe(b01, true), oe(v15, true), oe(t45, false), oe(v04, false)]),
    planeFace([0, hh, 0], uY, oppX, [oe(b23, true), oe(v37, true), oe(t67, false), oe(v26, false)]),
    planeFace([hw, 0, 0], uX, uY, [oe(b12, true), oe(v26, true), oe(t56, false), oe(v15, false)]),
    planeFace([-hw, 0, 0], oppX, oppY, [oe(b30, true), oe(v04, true), oe(t74, false), oe(v37, false)]),
    // Inner window walls with inward normals
    planeFace([cx, cy - ihh, 0], uY, oppX, [oe(ib01, false), oe(iv0, true), oe(it01, true), oe(iv1, false)]),
    planeFace([cx, cy + ihh, 0], oppY, uX, [oe(ib23, false), oe(iv2, true), oe(it23, true), oe(iv3, false)]),
    planeFace([cx + ihw, cy, 0], oppX, oppY, [oe(ib12, false), oe(iv1, true), oe(it12, true), oe(iv2, false)]),
    planeFace([cx - ihw, cy, 0], uX, uY, [oe(ib30, false), oe(iv3, true), oe(it30, true), oe(iv0, false)]),
  ];
  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${faces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${escStepStr(brepName)}',${shell})`);
}

/** Computes Cox-de Boor cubic B-spline basis values N_{0..n-1, 3}(u) on a clamped knot vector U. */
function evalCubicBsplineBasis(u: number, n: number, knots: number[]): number[] {
  const N = new Array<number>(n).fill(0);
  if (u <= knots[0]!) {
    N[0] = 1;
    return N;
  }
  if (u >= knots[knots.length - 1]!) {
    N[n - 1] = 1;
    return N;
  }
  const vals = new Array<number>(knots.length - 1).fill(0);
  for (let i = 0; i < knots.length - 1; i++) {
    if (u >= knots[i]! && u < knots[i + 1]!) vals[i] = 1;
  }
  for (let deg = 1; deg <= 3; deg++) {
    const next = new Array<number>(knots.length - 1 - deg).fill(0);
    for (let i = 0; i < next.length; i++) {
      const d1 = knots[i + deg]! - knots[i]!;
      const d2 = knots[i + deg + 1]! - knots[i + 1]!;
      const t1 = d1 > 1e-12 ? ((u - knots[i]!) / d1) * vals[i]! : 0;
      const t2 = d2 > 1e-12 ? ((knots[i + deg + 1]! - u) / d2) * vals[i + 1]! : 0;
      next[i] = t1 + t2;
    }
    for (let i = 0; i < next.length; i++) vals[i] = next[i]!;
  }
  for (let i = 0; i < n; i++) N[i] = vals[i]!;
  return N;
}

/**
 * Fits an exact clamped C² cubic `B_SPLINE_CURVE_WITH_KNOTS` interpolating `pts` (length 9)
 * between endpoint vertices `vpStart` and `vpEnd`, and emits an `EDGE_CURVE`.
 */
function emitInterpolatingBsplineEdge(ctx: StepContext, vpStart: string, vpEnd: string, pts: Vec3[]): string {
  const n = pts.length;
  const distinctKnots = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];
  const multiplicities = [4, 1, 1, 1, 1, 1, 4];
  const knots: number[] = [];
  for (let k = 0; k < distinctKnots.length; k++) {
    for (let m = 0; m < multiplicities[k]!; m++) knots.push(distinctKnots[k]!);
  }
  const A: number[][] = [];
  const rhs: Vec3[] = pts.map((p) => [p[0], p[1], p[2]]);
  for (let r = 0; r < n; r++) {
    A.push(evalCubicBsplineBasis(r / (n - 1), n, knots));
  }
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r]![col]!) > Math.abs(A[pivotRow]![col]!)) pivotRow = r;
    }
    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow]!, A[col]!];
      [rhs[col], rhs[pivotRow]] = [rhs[pivotRow]!, rhs[col]!];
    }
    const piv = A[col]![col]!;
    for (let c = col; c < n; c++) A[col]![c] = A[col]![c]! / piv;
    rhs[col] = [rhs[col]![0] / piv, rhs[col]![1] / piv, rhs[col]![2] / piv];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r]![col]!;
      if (Math.abs(factor) < 1e-15) continue;
      for (let c = col; c < n; c++) A[r]![c] = A[r]![c]! - factor * A[col]![c]!;
      rhs[r] = [
        rhs[r]![0] - factor * rhs[col]![0],
        rhs[r]![1] - factor * rhs[col]![1],
        rhs[r]![2] - factor * rhs[col]![2],
      ];
    }
  }
  rhs[0] = pts[0]!;
  rhs[n - 1] = pts[n - 1]!;
  const ctrlRefs = rhs.map((cp) => cartesianPoint(ctx, cp));
  const curve = emit(
    ctx,
    allocId(ctx),
    `B_SPLINE_CURVE_WITH_KNOTS('',3,(${ctrlRefs.join(",")}),.UNSPECIFIED.,.F.,.F.,(${multiplicities.join(",")}),(${distinctKnots.map(fmt).join(",")}),.UNSPECIFIED.)`,
  );
  return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vpStart},${vpEnd},${curve},.T.)`);
}

/**
 * Recognizes perpendicular curved-on-curved `Subtract(Cyl_main, Cyl_cross)` where a smaller transverse
 * cylinder passes completely through a vertical cylinder shaft, emitting exact CYLINDRICAL_SURFACEs
 * trimmed by `B_SPLINE_CURVE_WITH_KNOTS` saddle intersection curves.
 */
function tryBuildCrossCylinderBrep(
  ctx: StepContext,
  solid: Extract<Solid, { left: Solid; right: Solid }>,
  parentMatrix: Mat4,
  brepName: string,
): string | null {
  const main = unwrapLeafWithTags(ctx, solid.left, parentMatrix);
  const cross = unwrapLeafWithTags(ctx, solid.right, parentMatrix);
  if (main.leaf.kind !== SolidKind.Cylinder || cross.leaf.kind !== SolidKind.Cylinder) return null;

  const rMBot = main.leaf.radiusBottom ?? main.leaf.radius;
  const rMTop = main.leaf.radiusTop ?? main.leaf.radius;
  const rCBot = cross.leaf.radiusBottom ?? cross.leaf.radius;
  const rCTop = cross.leaf.radiusTop ?? cross.leaf.radius;
  if (Math.abs(rMBot - rMTop) > 1e-6 || Math.abs(rCBot - rCTop) > 1e-6) return null;

  const sM = matrixScale(main.worldMatrix);
  const sC = matrixScale(cross.worldMatrix);
  const R = rMBot * sM;
  const r = rCBot * sC;
  const H = main.leaf.height * sM;
  const L = cross.leaf.height * sC;
  if (!(r > 1e-5 && R > r + 1e-3 && H > 1e-4)) return null;

  const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const uZ = transformDir(main.worldMatrix, [0, 0, 1]);
  const uX = transformDir(cross.worldMatrix, [0, 0, 1]);
  if (Math.abs(dot(uZ, uX)) > 1e-4) return null;
  const rawY: [number, number, number] = [
    uZ[1] * uX[2] - uZ[2] * uX[1],
    uZ[2] * uX[0] - uZ[0] * uX[2],
    uZ[0] * uX[1] - uZ[1] * uX[0],
  ];
  const yLen = Math.hypot(rawY[0], rawY[1], rawY[2]);
  if (yLen < 1e-6) return null;
  const uY: Vec3 = [rawY[0] / yLen, rawY[1] / yLen, rawY[2] / yLen];

  const cM = transformPoint(main.worldMatrix, [0, 0, 0]);
  const cC = transformPoint(cross.worldMatrix, [0, 0, 0]);
  const d: Vec3 = [cC[0] - cM[0], cC[1] - cM[1], cC[2] - cM[2]];
  if (Math.abs(dot(d, uY)) > 1e-4) return null;
  const zOff = dot(d, uZ);
  if (Math.abs(zOff) + r > H / 2 - 1e-3) return null;
  const xOff = dot(d, uX);
  if (xOff - L / 2 > -R - 1e-4 || xOff + L / 2 < R + 1e-4) return null;

  const framePt = (lx: number, ly: number, lz: number): Vec3 => [
    cM[0] + lx * uX[0] + ly * uY[0] + lz * uZ[0],
    cM[1] + lx * uX[1] + ly * uY[1] + lz * uZ[1],
    cM[2] + lx * uX[2] + ly * uY[2] + lz * uZ[2],
  ];

  const hh = H / 2;
  const corners: Vec3[] = [
    framePt(0, -R, -hh),
    framePt(0, R, -hh),
    framePt(0, -R, hh),
    framePt(0, R, hh),
    framePt(R, 0, zOff + r),
    framePt(R, 0, zOff - r),
    framePt(-R, 0, zOff + r),
    framePt(-R, 0, zOff - r),
  ];
  const vp = corners.map((c, i) => emit(ctx, allocId(ctx), `VERTEX_POINT('xbv${i}',${cartesianPoint(ctx, c)})`));

  const botCenter = framePt(0, 0, -hh);
  const topCenter = framePt(0, 0, hh);
  const oppZ: Vec3 = [-uZ[0], -uZ[1], -uZ[2]];
  const oppY: Vec3 = [-uY[0], -uY[1], -uY[2]];

  const botCircle = circle(ctx, botCenter, R, uZ, oppY);
  const topCircle = circle(ctx, topCenter, R, uZ, oppY);

  const ec_ob0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[0]},${vp[1]},${botCircle},.T.)`);
  const ec_ob1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[1]},${vp[0]},${botCircle},.T.)`);
  const ec_ot0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[2]},${vp[3]},${topCircle},.T.)`);
  const ec_ot1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[3]},${vp[2]},${topCircle},.T.)`);

  const lineEdge = (v0: number, v1: number): string => {
    const p0 = corners[v0]!;
    const p1 = corners[v1]!;
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const dir = direction(ctx, [dx / len, dy / len, dz / len]);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dir},${fmt(len)})`);
    const line = emit(ctx, allocId(ctx), `LINE('',${cartesianPoint(ctx, p0)},${vec})`);
    return emit(ctx, allocId(ctx), `EDGE_CURVE('',${vp[v0]},${vp[v1]},${line},.T.)`);
  };

  const ec_os0 = lineEdge(0, 2);
  const ec_os1 = lineEdge(1, 3);
  const ec_bsTop = lineEdge(6, 4);
  const ec_bsBot = lineEdge(7, 5);

  const sampleArc = (signX: 1 | -1, t0: number, t1: number): Vec3[] => {
    const res: Vec3[] = [];
    for (let i = 0; i < 9; i++) {
      const t = t0 + (i / 8) * (t1 - t0);
      const y = r * Math.sin(t);
      const z = zOff + r * Math.cos(t);
      const x = signX * Math.sqrt(Math.max(0, R * R - y * y));
      res.push(framePt(x, y, z));
    }
    return res;
  };

  const ec_pos_yPos = emitInterpolatingBsplineEdge(ctx, vp[4]!, vp[5]!, sampleArc(1, 0, Math.PI));
  const ec_pos_yNeg = emitInterpolatingBsplineEdge(ctx, vp[5]!, vp[4]!, sampleArc(1, Math.PI, Math.PI * 2));
  const ec_neg_yPos = emitInterpolatingBsplineEdge(ctx, vp[6]!, vp[7]!, sampleArc(-1, 0, Math.PI));
  const ec_neg_yNeg = emitInterpolatingBsplineEdge(ctx, vp[7]!, vp[6]!, sampleArc(-1, Math.PI, Math.PI * 2));

  const oe = (ec: string, forward: boolean) =>
    emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);

  const botPlane = emit(ctx, allocId(ctx), `PLANE('',${axis2Placement3d(ctx, botCenter, oppZ, uX)})`);
  const botLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ob1, false), oe(ec_ob0, false)].join(",")}))`);
  const botFace = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${botLoop},.T.)`)}),${botPlane},.T.)`,
  );

  const topPlane = emit(ctx, allocId(ctx), `PLANE('',${axis2Placement3d(ctx, topCenter, uZ, uX)})`);
  const topLoop = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${[oe(ec_ot0, true), oe(ec_ot1, true)].join(",")}))`);
  const topFace = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${topLoop},.T.)`)}),${topPlane},.T.)`,
  );

  const outerCylSurf = cylindricalSurface(ctx, botCenter, R, uZ, oppY);
  const posXOuterLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_ob0, true), oe(ec_os1, true), oe(ec_ot0, false), oe(ec_os0, false)].join(",")}))`,
  );
  const posXHoleLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_pos_yPos, true), oe(ec_pos_yNeg, true)].join(",")}))`,
  );
  const posXFace = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${posXOuterLoop},.T.)`)},${emit(ctx, allocId(ctx), `FACE_BOUND('',${posXHoleLoop},.T.)`)}),${outerCylSurf},.T.)`,
  );

  const negXOuterLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_ob1, true), oe(ec_os0, true), oe(ec_ot1, false), oe(ec_os1, false)].join(",")}))`,
  );
  const negXHoleLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_neg_yNeg, false), oe(ec_neg_yPos, false)].join(",")}))`,
  );
  const negXFace = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${negXOuterLoop},.T.)`)},${emit(ctx, allocId(ctx), `FACE_BOUND('',${negXHoleLoop},.T.)`)}),${outerCylSurf},.T.)`,
  );

  const boreOrigin = framePt(-R, 0, zOff);
  const innerCylSurf = cylindricalSurface(ctx, boreOrigin, r, uX, uZ);
  const inTopLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_bsTop, false), oe(ec_neg_yPos, true), oe(ec_bsBot, true), oe(ec_pos_yPos, false)].join(",")}))`,
  );
  const inTopFace = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${inTopLoop},.T.)`)}),${innerCylSurf},.F.)`,
  );
  const inBotLoop = emit(
    ctx,
    allocId(ctx),
    `EDGE_LOOP('',(${[oe(ec_bsTop, true), oe(ec_pos_yNeg, false), oe(ec_bsBot, false), oe(ec_neg_yNeg, true)].join(",")}))`,
  );
  const inBotFace = emit(
    ctx,
    allocId(ctx),
    `ADVANCED_FACE('',(${emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${inBotLoop},.T.)`)}),${innerCylSurf},.F.)`,
  );

  const shell = emit(
    ctx,
    allocId(ctx),
    `CLOSED_SHELL('',(${[botFace, topFace, posXFace, negXFace, inTopFace, inBotFace].join(",")}))`,
  );
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${escStepStr(brepName)}',${shell})`);
}

/**
 * Recognizes exact analytical `Intersect` on aligned Box∩Box, coaxial Cylinder∩Cylinder,
 * and contained Z-aligned Box∩Cylinder primitives.
 */
function tryBuildAnalyticalIntersectBrep(
  ctx: StepContext,
  solid: Extract<Solid, { left: Solid; right: Solid }>,
  parentMatrix: Mat4,
  brepName: string,
): string | null {
  const a = unwrapLeafWithTags(ctx, solid.left, parentMatrix);
  const b = unwrapLeafWithTags(ctx, solid.right, parentMatrix);
  const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

  if (a.leaf.kind === SolidKind.Box && b.leaf.kind === SolidKind.Box) {
    const sA = matrixScale(a.worldMatrix);
    const sB = matrixScale(b.worldMatrix);
    const uX = transformDir(a.worldMatrix, [1, 0, 0]);
    const uY = transformDir(a.worldMatrix, [0, 1, 0]);
    const uZ = transformDir(a.worldMatrix, [0, 0, 1]);
    const vX = transformDir(b.worldMatrix, [1, 0, 0]);
    const vY = transformDir(b.worldMatrix, [0, 1, 0]);
    const vZ = transformDir(b.worldMatrix, [0, 0, 1]);
    if (Math.abs(dot(uX, vX) - 1) > 1e-4 || Math.abs(dot(uY, vY) - 1) > 1e-4 || Math.abs(dot(uZ, vZ) - 1) > 1e-4) {
      return null;
    }
    const cA = transformPoint(a.worldMatrix, [0, 0, 0]);
    const cB = transformPoint(b.worldMatrix, [0, 0, 0]);
    const d: Vec3 = [cB[0] - cA[0], cB[1] - cA[1], cB[2] - cA[2]];
    const cx = dot(d, uX) / sA;
    const cy = dot(d, uY) / sA;
    const cz = dot(d, uZ) / sA;
    const x0 = Math.max(-a.leaf.width / 2, cx - (b.leaf.width * sB) / (2 * sA));
    const x1 = Math.min(a.leaf.width / 2, cx + (b.leaf.width * sB) / (2 * sA));
    const y0 = Math.max(-a.leaf.height / 2, cy - (b.leaf.height * sB) / (2 * sA));
    const y1 = Math.min(a.leaf.height / 2, cy + (b.leaf.height * sB) / (2 * sA));
    const z0 = Math.max(-a.leaf.depth / 2, cz - (b.leaf.depth * sB) / (2 * sA));
    const z1 = Math.min(a.leaf.depth / 2, cz + (b.leaf.depth * sB) / (2 * sA));
    if (x1 - x0 <= 1e-5 || y1 - y0 <= 1e-5 || z1 - z0 <= 1e-5) return null;
    return buildBoxBrep(
      ctx,
      brepName,
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      (z0 + z1) / 2,
      (x1 - x0) / 2,
      (y1 - y0) / 2,
      (z1 - z0) / 2,
      a.worldMatrix,
    );
  }

  if (a.leaf.kind === SolidKind.Cylinder && b.leaf.kind === SolidKind.Cylinder) {
    const rABot = a.leaf.radiusBottom ?? a.leaf.radius;
    const rATop = a.leaf.radiusTop ?? a.leaf.radius;
    const rBBot = b.leaf.radiusBottom ?? b.leaf.radius;
    const rBTop = b.leaf.radiusTop ?? b.leaf.radius;
    if (Math.abs(rABot - rATop) > 1e-6 || Math.abs(rBBot - rBTop) > 1e-6) return null;
    const sA = matrixScale(a.worldMatrix);
    const sB = matrixScale(b.worldMatrix);
    const zA = transformDir(a.worldMatrix, [0, 0, 1]);
    const zB = transformDir(b.worldMatrix, [0, 0, 1]);
    if (Math.abs(Math.abs(dot(zA, zB)) - 1) > 1e-4) return null;
    const cA = transformPoint(a.worldMatrix, [0, 0, 0]);
    const cB = transformPoint(b.worldMatrix, [0, 0, 0]);
    const d: Vec3 = [cB[0] - cA[0], cB[1] - cA[1], cB[2] - cA[2]];
    const axialOffset = dot(d, zA);
    const radialOffset = Math.hypot(d[0] - axialOffset * zA[0], d[1] - axialOffset * zA[1], d[2] - axialOffset * zA[2]);
    if (radialOffset > 1e-4) return null;
    const rLocal = Math.min(rABot, (rBBot * sB) / sA);
    const hbLocal = (b.leaf.height * sB) / (2 * sA);
    const z0 = Math.max(-a.leaf.height / 2, axialOffset / sA - hbLocal);
    const z1 = Math.min(a.leaf.height / 2, axialOffset / sA + hbLocal);
    if (rLocal <= 1e-5 || z1 - z0 <= 1e-5) return null;
    const xA = transformDir(a.worldMatrix, [1, 0, 0]);
    const yA = transformDir(a.worldMatrix, [0, 1, 0]);
    const midWorld = transformPoint(a.worldMatrix, [0, 0, (z0 + z1) / 2]);
    const worldMat: Mat4 = [
      xA[0] * sA,
      xA[1] * sA,
      xA[2] * sA,
      0,
      yA[0] * sA,
      yA[1] * sA,
      yA[2] * sA,
      0,
      zA[0] * sA,
      zA[1] * sA,
      zA[2] * sA,
      0,
      midWorld[0],
      midWorld[1],
      midWorld[2],
      1,
    ];
    return buildCylinderBrep(ctx, brepName, rLocal, rLocal, z1 - z0, worldMat);
  }

  // Normalize (Box, Cyl) or (Cyl, Box)
  const boxCyl =
    a.leaf.kind === SolidKind.Box && b.leaf.kind === SolidKind.Cylinder
      ? { boxRef: a, cylRef: b }
      : b.leaf.kind === SolidKind.Box && a.leaf.kind === SolidKind.Cylinder
        ? { boxRef: b, cylRef: a }
        : null;
  if (boxCyl) {
    const bx = boxCyl.boxRef;
    const cy = boxCyl.cylRef;
    const bxLeaf = bx.leaf;
    const cylLeaf = cy.leaf;
    if (bxLeaf.kind !== SolidKind.Box || cylLeaf.kind !== SolidKind.Cylinder) return null;
    const rBot = cylLeaf.radiusBottom ?? cylLeaf.radius;
    const rTop = cylLeaf.radiusTop ?? cylLeaf.radius;
    if (Math.abs(rBot - rTop) > 1e-6) return null;
    const sB = matrixScale(bx.worldMatrix);
    const sC = matrixScale(cy.worldMatrix);
    const rLocal = (rBot * sC) / sB;
    const uX = transformDir(bx.worldMatrix, [1, 0, 0]);
    const uY = transformDir(bx.worldMatrix, [0, 1, 0]);
    const uZ = transformDir(bx.worldMatrix, [0, 0, 1]);
    const zC = transformDir(cy.worldMatrix, [0, 0, 1]);
    if (Math.abs(Math.abs(dot(uZ, zC)) - 1) > 1e-4) return null;
    const cB = transformPoint(bx.worldMatrix, [0, 0, 0]);
    const cC = transformPoint(cy.worldMatrix, [0, 0, 0]);
    const d: Vec3 = [cC[0] - cB[0], cC[1] - cB[1], cC[2] - cB[2]];
    const ox = dot(d, uX) / sB;
    const oy = dot(d, uY) / sB;
    const oz = dot(d, uZ) / sB;
    if (Math.abs(ox) + rLocal > bxLeaf.width / 2 + 1e-5 || Math.abs(oy) + rLocal > bxLeaf.height / 2 + 1e-5) {
      return null;
    }
    const hcLocal = (cylLeaf.height * sC) / (2 * sB);
    const z0 = Math.max(-bxLeaf.depth / 2, oz - hcLocal);
    const z1 = Math.min(bxLeaf.depth / 2, oz + hcLocal);
    if (z1 - z0 <= 1e-5) return null;
    const shiftWorld = transformPoint(bx.worldMatrix, [ox, oy, (z0 + z1) / 2]);
    const worldMat: Mat4 = [
      uX[0] * sB,
      uX[1] * sB,
      uX[2] * sB,
      0,
      uY[0] * sB,
      uY[1] * sB,
      uY[2] * sB,
      0,
      uZ[0] * sB,
      uZ[1] * sB,
      uZ[2] * sB,
      0,
      shiftWorld[0],
      shiftWorld[1],
      shiftWorld[2],
      1,
    ];
    return buildCylinderBrep(ctx, brepName, rLocal, rLocal, z1 - z0, worldMat);
  }

  return null;
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

/** Computes and records the world-space surface anchor for a `TaggedPatch` boundary feature. */
function recordTaggedPatchAnchor(
  ctx: StepContext,
  solid: Solid & { kind: SolidKind.TaggedPatch },
  parentMatrix: Mat4,
): void {
  if (ctx.featureAnchors.has(solid.tag.portName)) return;
  try {
    const localBox = computeSolidAABB(solid.child);
    const worldBox = transformAABB(localBox, parentMatrix);
    const cx = (worldBox.min[0] + worldBox.max[0]) / 2;
    const cy = (worldBox.min[1] + worldBox.max[1]) / 2;
    const cz = (worldBox.min[2] + worldBox.max[2]) / 2;
    const hx = (worldBox.max[0] - worldBox.min[0]) / 2;
    const hy = (worldBox.max[1] - worldBox.min[1]) / 2;
    const hz = (worldBox.max[2] - worldBox.min[2]) / 2;
    let anchor: Vec3 = [cx, cy, cz];
    const norm = solid.tag.normal;
    if (norm) {
      const nLen = Math.hypot(norm[0], norm[1], norm[2]);
      if (nLen > 1e-9) {
        const nx = norm[0] / nLen;
        const ny = norm[1] / nLen;
        const nz = norm[2] / nLen;
        anchor = [cx + nx * hx, cy + ny * hy, cz + nz * hz];
      }
    }
    ctx.featureAnchors.set(solid.tag.portName, {
      name: solid.tag.portName,
      portType: solid.tag.portType,
      anchor,
      normal: norm,
    });
  } catch {
    // Fallback centroid from translation column if child AABB fails
    const tx = parentMatrix[12] as number;
    const ty = parentMatrix[13] as number;
    const tz = parentMatrix[14] as number;
    ctx.featureAnchors.set(solid.tag.portName, {
      name: solid.tag.portName,
      portType: solid.tag.portType,
      anchor: [tx, ty, tz],
      normal: solid.tag.normal,
    });
  }
}

/** Prefixes solid B-Rep names with their parent assembly part name when `partPrefix` is set so OCCT meshes retain stage routing. */
function resolveBrepName(solidName: string, partPrefix?: string): string {
  if (!partPrefix) return solidName;
  if (!solidName || solidName === "unnamed" || solidName === partPrefix) return partPrefix;
  if (solidName.startsWith(`${partPrefix}__`)) return solidName;
  return `${partPrefix}__${solidName}`;
}

/**
 * Recursively walk the Solid tree and emit BREP entities for each constituent solid.
 * Returns an array of MANIFOLD_SOLID_BREP references.
 */
function flattenSolid(ctx: StepContext, solid: Solid, parentMatrix: Mat4, partPrefix?: string): string[] {
  const brepName = resolveBrepName(solid.name, partPrefix);
  switch (solid.kind) {
    case SolidKind.Box: {
      const brepRef = buildBoxBrep(
        ctx,
        brepName,
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
      const brepRef = buildCylinderBrep(ctx, brepName, rBot, rTop, solid.height, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Sphere: {
      const brepRef = buildSphereBrep(ctx, brepName, solid.radius, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Torus: {
      const brepRef = buildTorusBrep(ctx, brepName, solid.major, solid.minor, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Extrusion: {
      // Emit exact prism B-Rep when polygon has >= 3 vertices; otherwise approximate via bounding box
      if (solid.polygon.length >= 3) {
        const brepRef = buildExtrusionBrep(
          ctx,
          brepName,
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
      const brepRef = buildBoxBrep(ctx, brepName, cx, cy, cz, hw, hh, hd, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Revolve: {
      if (solid.polygon.length < 3) return [];
      const brepRef = buildRevolveBrep(ctx, brepName, solid.polygon, solid.angle, solid.segments ?? 24, parentMatrix);
      return brepRef ? [brepRef] : [];
    }

    case SolidKind.Polyhedron: {
      if (solid.points.length === 0) return [];
      // Emit faceted planar B-Rep when explicit face loops are provided; fallback to AABB box otherwise
      if (solid.faces && solid.faces.length > 0) {
        const brepRef = buildPolyhedronBrep(ctx, brepName, solid.points, solid.faces, parentMatrix);
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
      const brepRef = buildBoxBrep(ctx, brepName, cx, cy, cz, hw, hh, hd, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Transform: {
      // Accumulate local transform into parentMatrix and recurse into child solid
      const combined = mat4Multiply(parentMatrix, solid.matrix);
      return flattenSolid(ctx, solid.child, combined, partPrefix);
    }

    case SolidKind.Union: {
      const leftBox = computeSolidAABB(solid.left);
      const rightBox = computeSolidAABB(solid.right);
      const overlaps =
        leftBox.min[0] <= rightBox.max[0] + 1e-4 &&
        leftBox.max[0] >= rightBox.min[0] - 1e-4 &&
        leftBox.min[1] <= rightBox.max[1] + 1e-4 &&
        leftBox.max[1] >= rightBox.min[1] - 1e-4 &&
        leftBox.min[2] <= rightBox.max[2] + 1e-4 &&
        leftBox.max[2] >= rightBox.min[2] - 1e-4;
      if (overlaps) {
        const brepRef = buildEvaluatedSolidBrep(ctx, solid, parentMatrix, partPrefix);
        if (brepRef) return [brepRef];
      }
      return [
        ...flattenSolid(ctx, solid.left, parentMatrix, partPrefix),
        ...flattenSolid(ctx, solid.right, parentMatrix, partPrefix),
      ];
    }

    case SolidKind.Subtract: {
      const hollowRef = tryBuildHollowCylinderBrep(ctx, solid, parentMatrix, brepName);
      if (hollowRef) return [hollowRef];
      const crossCylRef = tryBuildCrossCylinderBrep(ctx, solid, parentMatrix, brepName);
      if (crossCylRef) return [crossCylRef];
      const plateHoleRef = tryBuildBoxWithHoleBrep(ctx, solid, parentMatrix, brepName);
      if (plateHoleRef) return [plateHoleRef];
      const slotRef = tryBuildBoxSlotBrep(ctx, solid, parentMatrix, brepName);
      if (slotRef) return [slotRef];
      const brepRef = buildEvaluatedSolidBrep(ctx, solid, parentMatrix, partPrefix);
      if (brepRef) return [brepRef];
      return flattenSolid(ctx, solid.left, parentMatrix, partPrefix);
    }

    case SolidKind.Intersect: {
      const analyticRef = tryBuildAnalyticalIntersectBrep(ctx, solid, parentMatrix, brepName);
      if (analyticRef) return [analyticRef];
      const brepRef = buildEvaluatedSolidBrep(ctx, solid, parentMatrix, partPrefix);
      if (brepRef) return [brepRef];
      return [];
    }

    case SolidKind.TaggedPatch: {
      recordTaggedPatchAnchor(ctx, solid, parentMatrix);
      return flattenSolid(ctx, solid.child, parentMatrix, partPrefix);
    }

    case SolidKind.Fillet:
    case SolidKind.Chamfer: {
      const brepRef = buildEvaluatedSolidBrep(ctx, solid, parentMatrix, partPrefix);
      if (brepRef) return [brepRef];
      return flattenSolid(ctx, solid.child, parentMatrix, partPrefix);
    }
  }
}

/**
 * Evaluates a solid (boolean CSG or fillet/chamfer) via {@link ManifoldWorker.evaluateSolid},
 * deduplicates its vertices, and emits a faceted `MANIFOLD_SOLID_BREP`.
 */
function buildEvaluatedSolidBrep(
  ctx: StepContext,
  solid: Solid,
  worldMatrix?: Mat4,
  partPrefix?: string,
): string | null {
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
  return buildPolyhedronBrep(ctx, resolveBrepName(solid.name, partPrefix), points, faceLoops, worldMatrix);
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
 * Emits an analytical `MANIFOLD_SOLID_BREP` (`CONICAL_SURFACE`, `CYLINDRICAL_SURFACE`, `PLANE`)
 * for a full 360° surface-of-revolution solid when the profile lies in the `+r` half-plane
 * and `worldMatrix` has uniform positive scaling; falls back to faceted polyhedron B-Rep otherwise.
 */
function buildRevolveBrep(
  ctx: StepContext,
  name: string,
  rawPoly: readonly (readonly [number, number])[],
  angleDeg: number,
  segments: number,
  worldMatrix?: Mat4,
): string | null {
  if (rawPoly.length < 3) return null;
  let area2 = 0;
  for (let i = 0; i < rawPoly.length; i++) {
    const [x0, y0] = rawPoly[i]!;
    const [x1, y1] = rawPoly[(i + 1) % rawPoly.length]!;
    area2 += x0 * y1 - x1 * y0;
  }
  const ordered = area2 >= 0 ? rawPoly : [...rawPoly].reverse();

  // Check uniform scaling and +r half-plane for exact analytical surfaces
  let canAnalytical = Math.abs(angleDeg) >= 359.999 && ordered.every(([r]) => r >= -1e-4);
  if (canAnalytical && worldMatrix) {
    const sx = Math.hypot(worldMatrix[0], worldMatrix[1], worldMatrix[2]);
    const sy = Math.hypot(worldMatrix[4], worldMatrix[5], worldMatrix[6]);
    const sz = Math.hypot(worldMatrix[8], worldMatrix[9], worldMatrix[10]);
    if (Math.abs(sx - sy) > 1e-4 || Math.abs(sx - sz) > 1e-4 || sx <= 1e-6) {
      canAnalytical = false;
    }
  }

  if (!canAnalytical) {
    const absAngle = Math.abs(Math.max(-360, Math.min(360, angleDeg))) || 360;
    const isFull = absAngle >= 359.999;
    const steps = Math.max(8, Math.ceil((segments * absAngle) / 360));
    const ringCount = isFull ? steps : steps + 1;
    const dirSign = angleDeg < 0 ? -1 : 1;
    const M = ordered.length;
    const pts: Vec3[] = [];
    const faces: number[][] = [];
    for (let s = 0; s < ringCount; s++) {
      const theta = (dirSign * ((s / steps) * (absAngle * Math.PI))) / 180;
      const cosT = Math.cos(theta),
        sinT = Math.sin(theta);
      for (let k = 0; k < M; k++) {
        const r = Math.max(1e-4, Math.abs(ordered[k]![0]));
        pts.push([r * cosT, r * sinT, ordered[k]![1]]);
      }
    }
    for (let s = 0; s < steps; s++) {
      const nextRing = isFull ? (s + 1) % steps : s + 1;
      const r0 = s * M,
        r1 = nextRing * M;
      for (let k = 0; k < M; k++) {
        const nk = (k + 1) % M;
        if (dirSign > 0) {
          faces.push([r0 + k, r1 + k, r1 + nk], [r0 + k, r1 + nk, r0 + nk]);
        } else {
          faces.push([r0 + k, r1 + nk, r1 + k], [r0 + k, r0 + nk, r1 + nk]);
        }
      }
    }
    if (!isFull) {
      const endOff = steps * M;
      for (let k = 1; k < M - 1; k++) {
        if (dirSign > 0) {
          faces.push([0, k + 1, k], [endOff, endOff + k, endOff + k + 1]);
        } else {
          faces.push([0, k, k + 1], [endOff, endOff + k + 1, endOff + k]);
        }
      }
    }
    return buildPolyhedronBrep(ctx, name, pts, faces, worldMatrix);
  }

  const pts: [number, number][] = [];
  for (const [r, z] of ordered) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(r - prev[0], z - prev[1]) > 1e-6) {
      pts.push([Math.max(0, r), z]);
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) < 1e-6) {
    pts.pop();
  }
  if (pts.length < 3) return null;

  const scale = matrixScale(worldMatrix);
  const effZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, 1]) : [0, 0, 1];
  const effNegZAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [0, 0, -1]) : [0, 0, -1];
  const effXAxis: Vec3 = worldMatrix ? transformDir(worldMatrix, [1, 0, 0]) : [1, 0, 0];

  interface RevolveRing {
    r: number;
    z: number;
    isAxis: boolean;
    pPos: Vec3;
    pNeg: Vec3;
    vpPos: string;
    vpNeg: string;
    ec0?: string;
    ec1?: string;
    plPos: string;
    plNeg: string;
  }

  const rings: RevolveRing[] = pts.map(([r, z], idx) => {
    const isAxis = r <= 1e-4;
    const center: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, z]) : [0, 0, z];
    const plPos = axis2Placement3d(ctx, center, effZAxis, effXAxis);
    const plNeg = axis2Placement3d(ctx, center, effNegZAxis, effXAxis);
    if (isAxis) {
      const vp = emit(ctx, allocId(ctx), `VERTEX_POINT('ra${idx}',${cartesianPoint(ctx, center)})`);
      return { r: 0, z, isAxis: true, pPos: center, pNeg: center, vpPos: vp, vpNeg: vp, plPos, plNeg };
    }
    const pPos: Vec3 = worldMatrix ? transformPoint(worldMatrix, [r, 0, z]) : [r, 0, z];
    const pNeg: Vec3 = worldMatrix ? transformPoint(worldMatrix, [-r, 0, z]) : [-r, 0, z];
    const vpPos = emit(ctx, allocId(ctx), `VERTEX_POINT('rp${idx}',${cartesianPoint(ctx, pPos)})`);
    const vpNeg = emit(ctx, allocId(ctx), `VERTEX_POINT('rn${idx}',${cartesianPoint(ctx, pNeg)})`);
    const circ = circle(ctx, center, r * scale, effZAxis, effXAxis);
    const ec0 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vpPos},${vpNeg},${circ},.T.)`);
    const ec1 = emit(ctx, allocId(ctx), `EDGE_CURVE('',${vpNeg},${vpPos},${circ},.T.)`);
    return { r, z, isAxis: false, pPos, pNeg, vpPos, vpNeg, ec0, ec1, plPos, plNeg };
  });

  const lineEdge = (a: RevolveRing, b: RevolveRing, sign: 1 | -1): string => {
    const p0 = sign > 0 ? a.pPos : a.pNeg;
    const p1 = sign > 0 ? b.pPos : b.pNeg;
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const dirRef = direction(ctx, [dx / len, dy / len, dz / len]);
    const vec = emit(ctx, allocId(ctx), `VECTOR('',${dirRef},${fmt(len)})`);
    const ln = emit(ctx, allocId(ctx), `LINE('',${cartesianPoint(ctx, p0)},${vec})`);
    return emit(
      ctx,
      allocId(ctx),
      `EDGE_CURVE('',${sign > 0 ? a.vpPos : a.vpNeg},${sign > 0 ? b.vpPos : b.vpNeg},${ln},.T.)`,
    );
  };

  const oe = (ec: string, fwd: boolean) =>
    emit(ctx, allocId(ctx), `ORIENTED_EDGE('',*,*,${ec},${fwd ? ".T." : ".F."})`);

  const stepFaces: string[] = [];
  for (let i = 0; i < rings.length; i++) {
    const a = rings[i]!;
    const b = rings[(i + 1) % rings.length]!;
    if (a.isAxis && b.isAxis) continue;
    const dr = b.r - a.r;
    const dz = b.z - a.z;
    if (Math.hypot(dr, dz) < 1e-6) continue;

    if (Math.abs(dz) < 1e-6) {
      const plane = emit(ctx, allocId(ctx), `PLANE('',${dr > 0 ? a.plNeg : a.plPos})`);
      const outer = a.r > b.r ? a : b;
      const inner = a.r > b.r ? b : a;
      const outerFwd = dr < 0;
      const outerLoop = emit(
        ctx,
        allocId(ctx),
        `EDGE_LOOP('',(${oe(outer.ec0!, outerFwd)},${oe(outer.ec1!, outerFwd)}))`,
      );
      const bounds = [emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${outerLoop},.T.)`)];
      if (!inner.isAxis) {
        const innerLoop = emit(
          ctx,
          allocId(ctx),
          `EDGE_LOOP('',(${oe(inner.ec0!, !outerFwd)},${oe(inner.ec1!, !outerFwd)}))`,
        );
        bounds.push(emit(ctx, allocId(ctx), `FACE_BOUND('',${innerLoop},.T.)`));
      }
      stepFaces.push(emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${bounds.join(",")}),${plane},.T.)`));
      continue;
    }

    const seamPos = lineEdge(a, b, 1);
    const seamNeg = lineEdge(a, b, -1);
    const isOuter = dz > 0;
    let surf: string;
    if (Math.abs(dr) < 1e-6) {
      const cBase: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, a.z]) : [0, 0, a.z];
      surf = cylindricalSurface(ctx, cBase, a.r * scale, effZAxis, effXAxis);
    } else {
      const rBot = a.z < b.z ? a.r : b.r;
      const rTop = a.z < b.z ? b.r : a.r;
      const zBot = Math.min(a.z, b.z);
      const zTop = Math.max(a.z, b.z);
      const cBot: Vec3 = worldMatrix ? transformPoint(worldMatrix, [0, 0, zBot]) : [0, 0, zBot];
      const coneSemi = Math.atan2((rTop - rBot) * scale, (zTop - zBot) * scale);
      surf = conicalSurface(ctx, cBot, Math.max(1e-6, rBot * scale), coneSemi, effZAxis, effXAxis);
    }

    for (const half of [0, 1]) {
      const loopEdges: string[] = [];
      if (!a.isAxis) {
        loopEdges.push(oe(half === 0 ? a.ec0! : a.ec1!, isOuter));
      }
      if (isOuter) {
        loopEdges.push(oe(half === 0 ? seamNeg : seamPos, true));
        if (!b.isAxis) loopEdges.push(oe(half === 0 ? b.ec0! : b.ec1!, false));
        loopEdges.push(oe(half === 0 ? seamPos : seamNeg, false));
      } else {
        loopEdges.push(oe(half === 0 ? seamPos : seamNeg, true));
        if (!b.isAxis) loopEdges.push(oe(half === 0 ? b.ec0! : b.ec1!, true));
        loopEdges.push(oe(half === 0 ? seamNeg : seamPos, false));
      }
      const el = emit(ctx, allocId(ctx), `EDGE_LOOP('',(${loopEdges.join(",")}))`);
      const fb = emit(ctx, allocId(ctx), `FACE_OUTER_BOUND('',${el},.T.)`);
      stepFaces.push(emit(ctx, allocId(ctx), `ADVANCED_FACE('',(${fb}),${surf},${isOuter ? ".T." : ".F."})`));
    }
  }

  if (stepFaces.length === 0) return null;
  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${stepFaces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${escStepStr(name)}',${shell})`);
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

  const triFace = (oes: string[], a: Vec3, b: Vec3, c: Vec3, fallbackNormal: Vec3, fallbackRefDir: Vec3): string => {
    const e1x = b[0] - a[0],
      e1y = b[1] - a[1],
      e1z = b[2] - a[2];
    const e2x = c[0] - a[0],
      e2y = c[1] - a[1],
      e2z = c[2] - a[2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nLen = Math.hypot(nx, ny, nz);
    const e1Len = Math.hypot(e1x, e1y, e1z);
    const normal: Vec3 = nLen > 1e-10 ? [nx / nLen, ny / nLen, nz / nLen] : fallbackNormal;
    const refDir: Vec3 = e1Len > 1e-10 ? [e1x / e1Len, e1y / e1Len, e1z / e1Len] : fallbackRefDir;
    return buildFace(oes, a, normal, refDir);
  };

  // Side faces: planar quads when untwisted, two planar triangles when warped by twist
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const dx = pts2d[j]![0] - pts2d[i]![0];
    const dy = pts2d[j]![1] - pts2d[i]![1];
    const len = Math.hypot(dx, dy) || 1.0;
    const sideNormal: Vec3 = [dy / len, -dx / len, 0];
    const sideRefDir: Vec3 = [dx / len, dy / len, 0];

    const p0 = localVerts[i]!;
    const p1 = localVerts[j]!;
    const p2 = localVerts[N + j]!;
    const p3 = localVerts[N + i]!;
    const v1x = p1[0] - p0[0],
      v1y = p1[1] - p0[1],
      v1z = p1[2] - p0[2];
    const v2x = p2[0] - p0[0],
      v2y = p2[1] - p0[1],
      v2z = p2[2] - p0[2];
    const v3x = p3[0] - p0[0],
      v3y = p3[1] - p0[1],
      v3z = p3[2] - p0[2];
    const cx = v1y * v3z - v1z * v3y;
    const cy = v1z * v3x - v1x * v3z;
    const cz = v1x * v3y - v1y * v3x;
    const cLen = Math.hypot(cx, cy, cz) || 1.0;
    const nonPlanarity = Math.abs(v2x * cx + v2y * cy + v2z * cz) / cLen;

    if (nonPlanarity > 1e-6) {
      const diag = edgeCurve(i, N + j);
      faces.push(
        triFace(
          [orientedEdge(botEdges[i]!, true), orientedEdge(vertEdges[j]!, true), orientedEdge(diag, false)],
          p0,
          p1,
          p2,
          sideNormal,
          sideRefDir,
        ),
      );
      faces.push(
        triFace(
          [orientedEdge(diag, true), orientedEdge(topEdges[i]!, false), orientedEdge(vertEdges[i]!, false)],
          p0,
          p2,
          p3,
          sideNormal,
          sideRefDir,
        ),
      );
    } else {
      faces.push(
        buildFace(
          [
            orientedEdge(botEdges[i]!, true),
            orientedEdge(vertEdges[j]!, true),
            orientedEdge(topEdges[i]!, false),
            orientedEdge(vertEdges[i]!, false),
          ],
          p0,
          sideNormal,
          sideRefDir,
        ),
      );
    }
  }

  const shell = emit(ctx, allocId(ctx), `CLOSED_SHELL('',(${faces.join(",")}))`);
  return emit(ctx, allocId(ctx), `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Product definition boilerplate ───────────────────────────────────────

/** Emits STEP `PRODUCT_DEFINITION` and `ADVANCED_BREP_SHAPE_REPRESENTATION` entities linking `brepRefs`, returning the `PRODUCT_DEFINITION_SHAPE` ID. */
function emitProductDefinition(
  ctx: StepContext,
  productName: string,
  brepRefs: string[],
  geomCtx: string,
  appCtx: string,
): string {
  const safeName = escStepStr(productName);
  const placementId = allocId(ctx);
  const placement = emit(
    ctx,
    placementId,
    `AXIS2_PLACEMENT_3D('placement',${cartesianPoint(ctx, [0, 0, 0])},${direction(ctx, [0, 0, 1])},${direction(ctx, [1, 0, 0])})`,
  );
  const shapeRepId = allocId(ctx);
  const brepList = brepRefs.length > 0 ? brepRefs.join(",") : placement;
  const shapeRep = emit(ctx, shapeRepId, `ADVANCED_BREP_SHAPE_REPRESENTATION('',(${brepList}),${geomCtx})`);
  const shapeRep2Id = allocId(ctx);
  const shapeRep2 = emit(ctx, shapeRep2Id, `SHAPE_REPRESENTATION('',(${placement}),${geomCtx})`);
  emit(ctx, allocId(ctx), `SHAPE_REPRESENTATION_RELATIONSHIP('SRR','None',${shapeRep2},${shapeRep})`);

  const prodCtxId = allocId(ctx);
  const prodCtx = emit(ctx, prodCtxId, `PRODUCT_CONTEXT('part definition',${appCtx},'mechanical')`);
  const prodId = allocId(ctx);
  const prod = emit(ctx, prodId, `PRODUCT('${safeName}','${safeName}',$,(${prodCtx}))`);
  const pdfId = allocId(ctx);
  const pdf = emit(ctx, pdfId, `PRODUCT_DEFINITION_FORMATION('',$,${prod})`);
  const pdcId = allocId(ctx);
  const pdc = emit(ctx, pdcId, `PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pdId = allocId(ctx);
  const pd = emit(ctx, pdId, `PRODUCT_DEFINITION('${safeName}','${safeName}',${pdf},${pdc})`);
  const pdsId = allocId(ctx);
  const pds = emit(ctx, pdsId, `PRODUCT_DEFINITION_SHAPE('',$,${pd})`);
  emit(ctx, allocId(ctx), `SHAPE_DEFINITION_REPRESENTATION(${pds},${shapeRep2})`);
  emit(ctx, allocId(ctx), `PRODUCT_RELATED_PRODUCT_CATEGORY('${safeName}','${safeName}',(${prod}))`);
  return pds;
}

// ── Global context entities ──────────────────────────────────────────────

/** Emits SI length/angle/steradian units, global uncertainty, and AP214/AP242 application context entities. */
function emitGlobalContext(
  ctx: StepContext,
  options?: StepCompileOptions,
): { geomCtx: string; appCtx: string; pmiMmUnitRef: string } {
  const isMetre = options?.lengthUnit === "m";
  const isAp242 = options?.schema === "AP242" || options?.pmi !== undefined;
  const unc = options?.uncertainty ?? (isMetre ? 1e-6 : 0.01);

  const luId = allocId(ctx);
  emit(
    ctx,
    luId,
    isMetre
      ? `(\nLENGTH_UNIT()\nNAMED_UNIT(*)\nSI_UNIT($,.METRE.)\n)`
      : `(\nLENGTH_UNIT()\nNAMED_UNIT(*)\nSI_UNIT(.MILLI.,.METRE.)\n)`,
  );
  const auId = allocId(ctx);
  emit(ctx, auId, `(\nNAMED_UNIT(*)\nPLANE_ANGLE_UNIT()\nSI_UNIT($,.RADIAN.)\n)`);
  const sauId = allocId(ctx);
  emit(ctx, sauId, `(\nNAMED_UNIT(*)\nSI_UNIT($,.STERADIAN.)\nSOLID_ANGLE_UNIT()\n)`);

  let pmiMmUnitRef = ref(luId);
  if (isMetre) {
    const mmId = allocId(ctx);
    pmiMmUnitRef = emit(ctx, mmId, `(\nLENGTH_UNIT()\nNAMED_UNIT(*)\nSI_UNIT(.MILLI.,.METRE.)\n)`);
  }

  const umId = allocId(ctx);
  emit(
    ctx,
    umId,
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(unc)}),${ref(luId)},\n'DISTANCE_ACCURACY_VALUE',\n'Maximum model space distance between geometric entities at asserted connectivities')`,
  );

  const gcId = allocId(ctx);
  const geomCtx = emit(
    ctx,
    gcId,
    `(\nGEOMETRIC_REPRESENTATION_CONTEXT(3)\nGLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${ref(umId)}))\nGLOBAL_UNIT_ASSIGNED_CONTEXT((${ref(luId)},${ref(auId)},${ref(sauId)}))\nREPRESENTATION_CONTEXT('','3D')\n)`,
  );

  const acId = allocId(ctx);
  const appCtx = emit(
    ctx,
    acId,
    isAp242
      ? `APPLICATION_CONTEXT('managed model based 3d engineering')`
      : `APPLICATION_CONTEXT('Core Data for Automotive Mechanical Design Process')`,
  );
  emit(
    ctx,
    allocId(ctx),
    isAp242
      ? `APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2014,${appCtx})`
      : `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2009,${appCtx})`,
  );

  return { geomCtx, appCtx, pmiMmUnitRef };
}

/** Computes orthonormal `(zAxis, refDir)` for an anchor normal vector. */
function resolveAnchorFrame(normal?: Vec3): { zAxis: Vec3; refDir: Vec3 } {
  if (!normal) return { zAxis: [1, 0, 0], refDir: [0, 1, 0] };
  const nLen = Math.hypot(normal[0], normal[1], normal[2]);
  if (nLen < 1e-9) return { zAxis: [1, 0, 0], refDir: [0, 1, 0] };
  const zAxis: Vec3 = [normal[0] / nLen, normal[1] / nLen, normal[2] / nLen];
  const up: Vec3 = Math.abs(zAxis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const rx = up[1] * zAxis[2] - up[2] * zAxis[1];
  const ry = up[2] * zAxis[0] - up[0] * zAxis[2];
  const rz = up[0] * zAxis[1] - up[1] * zAxis[0];
  const rLen = Math.hypot(rx, ry, rz) || 1;
  return { zAxis, refDir: [rx / rLen, ry / rLen, rz / rLen] };
}

/** Emits AP242 `DATUM_FEATURE` and `*_TOLERANCE` PMI entities grounded at extracted feature anchors. */
function emitAp242Pmi(ctx: StepContext, pmi: StepPmiSpec, pmiMmUnitRef: string): void {
  const datumRefsByLabel = new Map<string, string>();
  const datumPlacementsByFeature = new Map<string, string>();

  for (const datum of pmi.datums ?? []) {
    const discovered = ctx.featureAnchors.get(datum.featureName);
    const anchor: Vec3 = datum.anchor ?? discovered?.anchor ?? [0, 0, 0];
    const { zAxis, refDir } = resolveAnchorFrame(datum.normal ?? discovered?.normal);
    const pl = axis2Placement3d(ctx, anchor, zAxis, refDir);
    const dfRef = emit(
      ctx,
      allocId(ctx),
      `DATUM_FEATURE('${escStepStr(datum.featureName)}','${escStepStr(datum.label)}',${pl},.T.)`,
    );
    datumRefsByLabel.set(datum.label, dfRef);
    datumPlacementsByFeature.set(datum.featureName, pl);
  }

  for (const tol of pmi.tolerances ?? []) {
    const discovered = tol.featureName ? ctx.featureAnchors.get(tol.featureName) : undefined;
    const anchor: Vec3 = tol.anchor ?? discovered?.anchor ?? [0, 0, 0];
    let pl = tol.featureName ? datumPlacementsByFeature.get(tol.featureName) : undefined;
    if (!pl) {
      const { zAxis, refDir } = resolveAnchorFrame(discovered?.normal);
      const pt = emit(ctx, allocId(ctx), `CARTESIAN_POINT('${escStepStr(tol.id)}',(${anchor.map(fmt).join(",")}))`);
      const dirZ = direction(ctx, zAxis);
      const dirX = direction(ctx, refDir);
      pl = emit(
        ctx,
        allocId(ctx),
        `AXIS2_PLACEMENT_3D('${escStepStr(tol.featureName ?? tol.name)}',${pt},${dirZ},${dirX})`,
      );
    }
    const measRef = emit(
      ctx,
      allocId(ctx),
      `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(tol.zoneValue)}),${pmiMmUnitRef})`,
    );
    const modPrefix = tol.materialCondition && tol.materialCondition !== "RFS" ? `[${tol.materialCondition}] ` : "";
    const descText = `${modPrefix}${tol.description ?? tol.name}`.trim();
    const resolvedDatumRefs = (tol.datumRefs ?? [])
      .map((lbl) => datumRefsByLabel.get(lbl))
      .filter((r): r is string => r !== undefined);

    const baseArgs = `'${escStepStr(tol.name)}','${escStepStr(descText)}',${measRef},${pl}`;
    const body =
      resolvedDatumRefs.length > 0
        ? `${tol.characteristic}(${baseArgs},(${resolvedDatumRefs.join(",")}))`
        : `${tol.characteristic}(${baseArgs})`;
    emit(ctx, allocId(ctx), body);
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Compile a single {@link Solid} to an ISO-10303-21 STEP string.
 */
export function compileToStep(solid: Solid, productName?: string, options?: StepCompileOptions): string {
  const ctx = createContext();
  const { geomCtx, appCtx, pmiMmUnitRef } = emitGlobalContext(ctx, options);
  const brepRefs = flattenSolid(ctx, solid, IDENTITY);
  emitProductDefinition(ctx, productName ?? solid.name, brepRefs, geomCtx, appCtx);
  if (options?.pmi) {
    emitAp242Pmi(ctx, options.pmi, pmiMmUnitRef);
  }
  return wrapStep(ctx, productName ?? solid.name, options);
}

/**
 * Compile an {@link Assembly} to an ISO-10303-21 STEP string.
 */
export function compileAssemblyToStep(asm: Assembly, options?: StepCompileOptions): string {
  return compileAssemblyToAp242Step(asm, options).stepText;
}

/**
 * Compile an {@link Assembly} to an ISO-10303-21 STEP string along with all resolved 3D `TaggedPatch` feature anchors.
 */
export function compileAssemblyToAp242Step(
  asm: Assembly,
  options?: StepCompileOptions,
): { stepText: string; featureAnchors: StepFeatureAnchor[] } {
  const ctx = createContext();
  const effectiveOpts: StepCompileOptions = options ?? { schema: "AP214" };
  const { geomCtx, appCtx, pmiMmUnitRef } = emitGlobalContext(ctx, effectiveOpts);

  for (let i = 0; i < asm.parts.length; i++) {
    const p = asm.parts[i];
    if (!p) continue;
    const partPrefix = effectiveOpts.preservePartNames ? p.solid.name : undefined;
    const refs = flattenSolid(ctx, p.solid, IDENTITY, partPrefix);
    const uniqueName = effectiveOpts.preservePartNames ? p.solid.name : `${asm.name}_${p.solid.name}_${i}`;
    emitProductDefinition(ctx, uniqueName, refs, geomCtx, appCtx);
  }

  if (effectiveOpts.pmi) {
    emitAp242Pmi(ctx, effectiveOpts.pmi, pmiMmUnitRef);
  }

  return {
    stepText: wrapStep(ctx, asm.name, effectiveOpts),
    featureAnchors: [...ctx.featureAnchors.values()],
  };
}

/** Wraps emitted STEP entity records in an ISO-10303-21 `HEADER` and `DATA` envelope. */
function wrapStep(ctx: StepContext, name: string, options?: StepCompileOptions): string {
  const isAp242 = options?.schema === "AP242" || options?.pmi !== undefined;
  const schemaStr = isAp242
    ? "AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF"
    : "AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }";
  const timeStamp = options?.timeStamp ?? new Date().toISOString();
  const safeName = escStepStr(name);

  const provenanceBlock = options?.provenance
    ? `${serializeStepProvenanceMeta({
        ...options.provenance,
        assemblyName: options.provenance.assemblyName ?? safeName,
        ...(options.provenance.compiledAt ? {} : options.timeStamp ? { compiledAt: options.timeStamp } : {}),
      })}\n`
    : "";

  const header = `ISO-10303-21;
HEADER;
${provenanceBlock}FILE_DESCRIPTION(
/* description */ ('${safeName} - Generated by ModelScript Procedural CAD'),
/* implementation_level */ '2;1');

FILE_NAME(
/* name */ '${safeName}.stp',
/* time_stamp */ '${timeStamp}',
/* author */ ('ModelScript'),
/* organization */ ('ModelScript'),
/* preprocessor_version */ 'ModelScript Procedural CAD v1',
/* originating_system */ 'Ansatz Studio',
/* authorisation */ '');

FILE_SCHEMA(('${schemaStr}'));
ENDSEC;

DATA;`;

  return [header, ...ctx.entities, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
