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
      // Approximate cylinder as a bounding box in Phase 1
      const brepRef = buildBoxBrep(
        ctx,
        solid.name,
        0,
        0,
        0,
        solid.radius,
        solid.height / 2,
        solid.radius,
        parentMatrix,
      );
      return [brepRef];
    }

    case SolidKind.Sphere: {
      // Approximate sphere as a bounding box in Phase 1
      const brepRef = buildBoxBrep(ctx, solid.name, 0, 0, 0, solid.radius, solid.radius, solid.radius, parentMatrix);
      return [brepRef];
    }

    case SolidKind.Torus: {
      // Approximate torus as a flat bounding box in Phase 1
      const outer = solid.major + solid.minor;
      const brepRef = buildBoxBrep(ctx, solid.name, 0, 0, 0, outer, solid.minor, outer, parentMatrix);
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
