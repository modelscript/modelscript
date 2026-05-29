#!/usr/bin/env npx tsx
/**
 * Generate a valid ISO-10303-21 (STEP AP214) file representing a drone chassis.
 *
 * Each part is an ADVANCED_BREP_SHAPE_REPRESENTATION with a named
 * MANIFOLD_SOLID_BREP inside a CLOSED_SHELL composed of ADVANCED_FACEs.
 *
 * Parts:
 *   CentralBody        — octagonal-ish main plate
 *   Arm_FR / Arm_FL / Arm_RR / Arm_RL — four diagonal arms
 *   Motor_FR / Motor_FL / Motor_RR / Motor_RL — cylindrical motor mounts
 *   LandingSkid_L / LandingSkid_R — landing gear bars
 *   CameraMount         — front camera bracket
 *
 * Usage:
 *   npx tsx generate-drone-step.ts > drone.step
 */

// ── Entity ID allocator ──────────────────────────────────────────────────
let nextId = 10;
function id(): number {
  return nextId++;
}
function ref(n: number): string {
  return `#${n}`;
}

// Collect all entities, emit at end
const entities: string[] = [];
function emit(eid: number, body: string): string {
  const line = `${ref(eid)}=${body};`;
  entities.push(line);
  return ref(eid);
}

// ── Math helpers ─────────────────────────────────────────────────────────
type V3 = [number, number, number];

function fmt(n: number): string {
  // Format number with enough precision
  if (Number.isInteger(n) && Math.abs(n) < 1e6) return n.toFixed(1);
  return n.toPrecision(15).replace(/\.?0+$/, "") || "0.";
}

function cartesianPoint(label: string, p: V3): string {
  const eid = id();
  return emit(eid, `CARTESIAN_POINT('${label}',(${p.map(fmt).join(",")}))`);
}

function direction(label: string, d: V3): string {
  const eid = id();
  return emit(eid, `DIRECTION('${label}',(${d.map(fmt).join(",")}))`);
}

function axis2Placement3d(label: string, origin: V3, axis: V3, refDir: V3): string {
  const o = cartesianPoint("", origin);
  const a = direction("axis", axis);
  const r = direction("ref_dir", refDir);
  const eid = id();
  return emit(eid, `AXIS2_PLACEMENT_3D('${label}',${o},${a},${r})`);
}

// ── Box BREP builder ─────────────────────────────────────────────────────
// Returns a MANIFOLD_SOLID_BREP ref for an axis-aligned box.

function buildBoxBrep(name: string, cx: number, cy: number, cz: number, hw: number, hh: number, hd: number): string {
  // 8 corner points
  //    4---5
  //   /|  /|      Y up, Z forward, X right
  //  7---6 |
  //  | 0-|-1
  //  |/  |/
  //  3---2
  const corners: V3[] = [
    [cx - hw, cy - hh, cz - hd], // 0
    [cx + hw, cy - hh, cz - hd], // 1
    [cx + hw, cy - hh, cz + hd], // 2
    [cx - hw, cy - hh, cz + hd], // 3
    [cx - hw, cy + hh, cz - hd], // 4
    [cx + hw, cy + hh, cz - hd], // 5
    [cx + hw, cy + hh, cz + hd], // 6
    [cx - hw, cy + hh, cz + hd], // 7
  ];

  // Vertex points
  const vp: string[] = corners.map((c, i) => {
    const cp = cartesianPoint("", c);
    const vid = id();
    return emit(vid, `VERTEX_POINT('v${i}',${cp})`);
  });

  // Helper to create an edge curve between two vertex points
  function edgeCurve(v0idx: number, v1idx: number): string {
    const p0 = corners[v0idx];
    const p1 = corners[v1idx];
    const dx = p1[0] - p0[0],
      dy = p1[1] - p0[1],
      dz = p1[2] - p0[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir = direction("", [dx / len, dy / len, dz / len]);
    const vec = (() => {
      const vid = id();
      return emit(vid, `VECTOR('',${dir},${fmt(len)})`);
    })();
    const lineOrigin = cartesianPoint("", p0);
    const line = (() => {
      const lid = id();
      return emit(lid, `LINE('',${lineOrigin},${vec})`);
    })();
    const ecid = id();
    return emit(ecid, `EDGE_CURVE('',${vp[v0idx]},${vp[v1idx]},${line},.T.)`);
  }

  // 12 edges of a box
  // Bottom face: 0-1, 1-2, 2-3, 3-0
  const e01 = edgeCurve(0, 1);
  const e12 = edgeCurve(1, 2);
  const e23 = edgeCurve(2, 3);
  const e30 = edgeCurve(3, 0);
  // Top face: 4-5, 5-6, 6-7, 7-4
  const e45 = edgeCurve(4, 5);
  const e56 = edgeCurve(5, 6);
  const e67 = edgeCurve(6, 7);
  const e74 = edgeCurve(7, 4);
  // Vertical edges: 0-4, 1-5, 2-6, 3-7
  const e04 = edgeCurve(0, 4);
  const e15 = edgeCurve(1, 5);
  const e26 = edgeCurve(2, 6);
  const e37 = edgeCurve(3, 7);

  // Helper to create an oriented edge
  function orientedEdge(ec: string, forward: boolean): string {
    const oeid = id();
    return emit(oeid, `ORIENTED_EDGE('',*,*,${ec},${forward ? ".T." : ".F."})`);
  }

  // Helper to build a face from 4 oriented edges and a plane
  function buildFace(oes: string[], planeOrigin: V3, planeNormal: V3, planeRefDir: V3): string {
    const loopId = id();
    const loop = emit(loopId, `EDGE_LOOP('',(${oes.join(",")}))`);
    const boundId = id();
    const bound = emit(boundId, `FACE_OUTER_BOUND('',${loop},.T.)`);
    const planePlace = axis2Placement3d("", planeOrigin, planeNormal, planeRefDir);
    const planeId = id();
    const plane = emit(planeId, `PLANE('',${planePlace})`);
    const faceId = id();
    return emit(faceId, `ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  }

  // 6 faces
  // Bottom (Y-): 0-1-2-3 (normal -Y)
  const fBottom = buildFace(
    [orientedEdge(e01, true), orientedEdge(e12, true), orientedEdge(e23, true), orientedEdge(e30, true)],
    [cx, cy - hh, cz],
    [0, -1, 0],
    [1, 0, 0],
  );
  // Top (Y+): 7-6-5-4 (normal +Y)
  const fTop = buildFace(
    [orientedEdge(e67, false), orientedEdge(e56, false), orientedEdge(e45, false), orientedEdge(e74, false)],
    [cx, cy + hh, cz],
    [0, 1, 0],
    [1, 0, 0],
  );
  // Front (Z+): 2-6-7-3 (normal +Z)
  const fFront = buildFace(
    [orientedEdge(e26, true), orientedEdge(e67, true), orientedEdge(e37, false), orientedEdge(e23, false)],
    [cx, cy, cz + hd],
    [0, 0, 1],
    [1, 0, 0],
  );
  // Back (Z-): 0-4-5-1 (normal -Z)
  const fBack = buildFace(
    [orientedEdge(e04, true), orientedEdge(e45, true), orientedEdge(e15, false), orientedEdge(e01, false)],
    [cx, cy, cz - hd],
    [0, 0, -1],
    [-1, 0, 0],
  );
  // Right (X+): 1-5-6-2 (normal +X)
  const fRight = buildFace(
    [orientedEdge(e15, true), orientedEdge(e56, true), orientedEdge(e26, false), orientedEdge(e12, false)],
    [cx + hw, cy, cz],
    [1, 0, 0],
    [0, 0, 1],
  );
  // Left (X-): 3-7-4-0 (normal -X)
  const fLeft = buildFace(
    [orientedEdge(e37, true), orientedEdge(e74, true), orientedEdge(e04, false), orientedEdge(e30, false)],
    [cx - hw, cy, cz],
    [-1, 0, 0],
    [0, 0, -1],
  );

  // Closed shell
  const shellId = id();
  const shell = emit(shellId, `CLOSED_SHELL('',(${[fBottom, fTop, fFront, fBack, fRight, fLeft].join(",")}))`);

  // Manifold solid brep
  const brepId = id();
  return emit(brepId, `MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

// ── Product definition boilerplate ───────────────────────────────────────
function buildProduct(productName: string, brepRefs: string[], geometricContext: string, appContext: string): void {
  // Shape representation
  const placementId = id();
  const placement = emit(
    placementId,
    `AXIS2_PLACEMENT_3D('placement',${cartesianPoint("", [0, 0, 0])},${direction("axis", [0, 0, 1])},${direction("refdir", [1, 0, 0])})`,
  );
  const shapeRepId = id();
  const shapeRep = emit(
    shapeRepId,
    `ADVANCED_BREP_SHAPE_REPRESENTATION('',(${brepRefs.join(",")}),${geometricContext})`,
  );
  const shapeRep2Id = id();
  const shapeRep2 = emit(shapeRep2Id, `SHAPE_REPRESENTATION('',(${placement}),${geometricContext})`);
  const srrId = id();
  emit(srrId, `SHAPE_REPRESENTATION_RELATIONSHIP('SRR','None',${shapeRep2},${shapeRep})`);

  // Product
  const prodCtxId = id();
  const prodCtx = emit(prodCtxId, `PRODUCT_CONTEXT('part definition',${appContext},'mechanical')`);
  const prodId = id();
  const prod = emit(prodId, `PRODUCT('${productName}','${productName}',$,(${prodCtx}))`);
  const prodDefFormId = id();
  const prodDefForm = emit(prodDefFormId, `PRODUCT_DEFINITION_FORMATION('',$,${prod})`);
  const prodDefCtxId = id();
  const prodDefCtx = emit(prodDefCtxId, `PRODUCT_DEFINITION_CONTEXT('part definition',${appContext},'design')`);
  const prodDefId = id();
  const prodDef = emit(prodDefId, `PRODUCT_DEFINITION('${productName}','${productName}',${prodDefForm},${prodDefCtx})`);
  const prodDefShapeId = id();
  const prodDefShape = emit(prodDefShapeId, `PRODUCT_DEFINITION_SHAPE('',$,${prodDef})`);
  emit(id(), `SHAPE_DEFINITION_REPRESENTATION(${prodDefShape},${shapeRep2})`);

  // Category
  emit(id(), `PRODUCT_RELATED_PRODUCT_CATEGORY('${productName}','${productName}',(${prod}))`);
}

// ── Main ─────────────────────────────────────────────────────────────────
function generateDroneStep(): string {
  // Geometric context
  const lengthUnitId = id();
  emit(lengthUnitId, `(\nLENGTH_UNIT()\nNAMED_UNIT(*)\nSI_UNIT(.MILLI.,.METRE.)\n)`);
  const angleUnitId = id();
  emit(angleUnitId, `(\nNAMED_UNIT(*)\nPLANE_ANGLE_UNIT()\nSI_UNIT($,.RADIAN.)\n)`);
  const solidAngleUnitId = id();
  emit(solidAngleUnitId, `(\nNAMED_UNIT(*)\nSI_UNIT($,.STERADIAN.)\nSOLID_ANGLE_UNIT()\n)`);

  const uncertaintyId = id();
  emit(
    uncertaintyId,
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),${ref(lengthUnitId)},\n'DISTANCE_ACCURACY_VALUE',\n'Maximum model space distance between geometric entities at asserted connectivities')`,
  );

  const geomCtxId = id();
  const geomCtx = emit(
    geomCtxId,
    `(\nGEOMETRIC_REPRESENTATION_CONTEXT(3)\nGLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${ref(uncertaintyId)}))\nGLOBAL_UNIT_ASSIGNED_CONTEXT((${ref(lengthUnitId)},${ref(angleUnitId)},${ref(solidAngleUnitId)}))\nREPRESENTATION_CONTEXT('','3D')\n)`,
  );

  const appCtxId = id();
  const appCtx = emit(appCtxId, `APPLICATION_CONTEXT('Core Data for Automotive Mechanical Design Process')`);
  emit(id(), `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2009,${appCtx})`);

  // ── Build drone parts ────────────────────────────────────────

  const allBreps: string[] = [];

  // Central body plate (wider than tall)
  allBreps.push(buildBoxBrep("CentralBody", 0, 0, 0, 5, 1.5, 5));

  // Top cover (slightly smaller, raised)
  allBreps.push(buildBoxBrep("TopCover", 0, 2.0, 0, 4, 0.3, 4));

  // Electronics bay (underneath)
  allBreps.push(buildBoxBrep("ElectronicsBay", 0, -2.2, 0, 3, 0.5, 3));

  // Four diagonal arms (positioned diagonally)
  const armOffset = 6; // diagonal distance for arm center
  const armHW = 3.5,
    armHH = 0.5,
    armHD = 0.8;

  // Front-Right arm
  allBreps.push(buildBoxBrep("Arm_FR", armOffset, 0, armOffset, armHW, armHH, armHD));
  // Front-Left arm
  allBreps.push(buildBoxBrep("Arm_FL", -armOffset, 0, armOffset, armHW, armHH, armHD));
  // Rear-Right arm
  allBreps.push(buildBoxBrep("Arm_RR", armOffset, 0, -armOffset, armHW, armHH, armHD));
  // Rear-Left arm
  allBreps.push(buildBoxBrep("Arm_RL", -armOffset, 0, -armOffset, armHW, armHH, armHD));

  // Motor mounts (box approximation of cylinders) at arm tips
  const motorDist = 10;
  const motorHW = 1.5,
    motorHH = 1.0,
    motorHD = 1.5;

  allBreps.push(buildBoxBrep("Motor_FR", motorDist, 1.0, motorDist, motorHW, motorHH, motorHD));
  allBreps.push(buildBoxBrep("Motor_FL", -motorDist, 1.0, motorDist, motorHW, motorHH, motorHD));
  allBreps.push(buildBoxBrep("Motor_RR", motorDist, 1.0, -motorDist, motorHW, motorHH, motorHD));
  allBreps.push(buildBoxBrep("Motor_RL", -motorDist, 1.0, -motorDist, motorHW, motorHH, motorHD));

  // Landing skids
  // Left skid (horizontal bar)
  allBreps.push(buildBoxBrep("LandingSkid_L", -4, -4.0, 0, 0.3, 0.2, 5));
  // Right skid (horizontal bar)
  allBreps.push(buildBoxBrep("LandingSkid_R", 4, -4.0, 0, 0.3, 0.2, 5));
  // Left front strut
  allBreps.push(buildBoxBrep("Strut_LF", -4, -2.8, 3.5, 0.2, 1.2, 0.2));
  // Left rear strut
  allBreps.push(buildBoxBrep("Strut_LR", -4, -2.8, -3.5, 0.2, 1.2, 0.2));
  // Right front strut
  allBreps.push(buildBoxBrep("Strut_RF", 4, -2.8, 3.5, 0.2, 1.2, 0.2));
  // Right rear strut
  allBreps.push(buildBoxBrep("Strut_RR", 4, -2.8, -3.5, 0.2, 1.2, 0.2));

  // Camera mount (front)
  allBreps.push(buildBoxBrep("CameraMount", 0, -1.0, 6.5, 1.0, 0.4, 1.5));
  // Camera housing
  allBreps.push(buildBoxBrep("CameraHousing", 0, -1.8, 7.8, 0.8, 0.8, 0.6));

  // Battery (bottom center)
  allBreps.push(buildBoxBrep("Battery", 0, -3.2, 0, 2.5, 0.6, 4));

  // Build the product definition with all breps
  buildProduct("DroneChassisCAD", allBreps, geomCtx, appCtx);

  // ── Assemble STEP file ───────────────────────────────────────
  const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(
/* description */ ('Drone Chassis CAD Model - Generated by ModelScript'),
/* implementation_level */ '2;1');

FILE_NAME(
/* name */ 'drone-chassis.stp',
/* time_stamp */ '${new Date().toISOString()}',
/* author */ ('ModelScript'),
/* organization */ ('ModelScript'),
/* preprocessor_version */ 'ModelScript Procedural CAD v1',
/* originating_system */ 'ModelScript IDE',
/* authorisation */ '');

FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;

DATA;`;

  const footer = `ENDSEC;
END-ISO-10303-21;
`;

  return [header, ...entities, footer].join("\n");
}

// ── CLI entry point ──────────────────────────────────────────────────────
import * as fs from "fs";
const stepContent = generateDroneStep();

// Write to the examples directory
const outputPath = process.argv[2] || "/dev/stdout";
if (outputPath === "/dev/stdout") {
  process.stdout.write(stepContent);
} else {
  fs.writeFileSync(outputPath, stepContent);
  console.error(`[generate-drone-step] Wrote ${stepContent.length} bytes to ${outputPath}`);
}
