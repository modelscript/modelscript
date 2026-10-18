// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { splitPolygon } from "../src/csg-bsp.js";
import {
  DEFAULT_DESIGN_RULES,
  DEFAULT_ROUTING_RULES,
  PCBRenderer,
  PCBRouter,
  generateManufacturingFiles,
  runDRC,
} from "../src/ecad/index.js";
import {
  AnimationController,
  AssemblyBVH,
  AssemblyClusteringEngine,
  DynamicClearanceVerifier,
  IDENTITY,
  ManifoldWorker,
  ParameterInversionEngine,
  RomLoadPipeline,
  ToleranceStackVerifier,
  assembly,
  box,
  compileToStep,
  computeProjectedFrontalArea,
  computeSolidAABB,
  createPolygon,
  cylinder,
  fillet,
  intersect,
  linearExtrude,
  mergeSourceMetadata,
  mirror,
  mirrorMatrix,
  part,
  patchModelicaCadAnnotation,
  quaternionFromAxisAngle,
  quaternionFromEuler,
  quaternionSlerp,
  quaternionToEuler,
  resolveClearanceRule,
  rotate,
  rotationMatrix,
  scale,
  serializeCadBinding,
  sphere,
  translate,
  verifyAssemblyClearance,
  type CsgPlane,
  type CsgVertex,
} from "../src/index.js";

describe("CAD Geometry, Kinematics, STEP, Clearance & ECAD Comprehensive Fixes", () => {
  it("computes exact AABB for Extrusion (XY polygon along Z) and Intersect solids", () => {
    const ext = linearExtrude(
      [
        [-10, -5],
        [10, -5],
        [10, 5],
        [-10, 5],
      ],
      12,
    );
    const extBox = computeSolidAABB(ext);
    assert.deepStrictEqual(extBox.min, [-10, -5, 0]);
    assert.deepStrictEqual(extBox.max, [10, 5, 12]);

    const b1 = box({ width: 20, height: 20, depth: 20 }); // [-10, 10]^3
    const b2 = translate(box({ width: 20, height: 20, depth: 20 }), [10, 0, 0]); // [0, 20] x [-10, 10]^2
    const inter = intersect(b1, b2);
    const interBox = computeSolidAABB(inter);
    assert.deepStrictEqual(interBox.min, [0, -10, -10]);
    assert.deepStrictEqual(interBox.max, [10, 10, 10]);
  });

  it("prioritizes specific clearance rules over wildcard rules regardless of rule array order", () => {
    const rules = [
      { partA: "*", partB: "*", minClearance: 10 },
      { partA: "Chassis", partB: "*", minClearance: 5 },
      { partA: "Battery", partB: "Chassis", minClearance: 2 },
    ];
    assert.strictEqual(resolveClearanceRule("Chassis", "Battery", 1, rules), 2);
    assert.strictEqual(resolveClearanceRule("Chassis", "Motor", 1, rules), 5);
    assert.strictEqual(resolveClearanceRule("Arm", "Motor", 1, rules), 10);

    const b1 = box({ width: 10, height: 10, depth: 10, name: "Chassis" });
    const b2 = translate(box({ width: 10, height: 10, depth: 10, name: "Battery" }), [13, 0, 0]); // gap = 3
    const asm = assembly("RulePriorityAsm", [part(b1), part(b2)]);
    const report = verifyAssemblyClearance(asm, 10, rules);
    assert.strictEqual(report.isCompliant, true);
  });

  it("computes real 2D silhouette projected frontal area from mesh and solid geometry", () => {
    // 10mm x 10mm = 100 mm² = 1e-4 m²; 20mm x 20mm = 400 mm² = 4e-4 m²
    const smallCube = box({ width: 10, height: 10, depth: 10 });
    const largeCube = box({ width: 20, height: 20, depth: 20 });
    const areaSmall = computeProjectedFrontalArea(smallCube, [1, 0, 0]);
    const areaLarge = computeProjectedFrontalArea(largeCube, [1, 0, 0]);
    assert(Math.abs(areaSmall - 1e-4) < 1e-5, `Expected ~1e-4 m², got ${areaSmall}`);
    assert(Math.abs(areaLarge - 4e-4) < 2e-5, `Expected ~4e-4 m², got ${areaLarge}`);
    assert(areaLarge > areaSmall * 3.5);
  });

  it("handles radians vs degrees and translation uncertainty in DynamicClearanceVerifier", () => {
    const arm = box({ width: 20, height: 2, depth: 2, name: "Arm" });
    const obstacle = translate(box({ width: 4, height: 4, depth: 4, name: "Pillar" }), [0, 8, 0]);
    const asm = assembly("RotAsm", [part(arm), part(obstacle)]);

    // Rotate Arm from 0 to pi/2 radians around Z -> sweeps through (0, 8, 0)
    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      trajectory: [
        {
          time: 0.5,
          states: {
            theta: { lo: 0, hi: Math.PI / 2 },
          },
          nominal: {
            theta: Math.PI / 2,
          },
        },
      ],
      bindings: [
        {
          partName: "Arm",
          rotation: {
            axis: [0, 0, 1],
            angle: "theta",
            inDegrees: false,
          },
        },
      ],
      defaultMinClearance: 0.5,
    });
    assert.strictEqual(report.isCertifiedSafe, false);
    assert(report.violations.length > 0);
    assert(report.counterexampleAssembly !== undefined);
  });

  it("unwraps Transform inside Fillet/Chamfer and computes outward normals under non-uniform scale & mirror", () => {
    const filletedTranslated = fillet(translate(box({ width: 10, height: 10, depth: 10 }), [20, 0, 0]), 1.0);
    const mesh = ManifoldWorker.evaluateSolid(filletedTranslated);
    // All vertices should have X in [15, 25]
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      assert(mesh.vertices[i]! >= 14.9 && mesh.vertices[i]! <= 25.1);
    }

    // Mirror box and verify unit normals
    const mirrored = mirror(box({ width: 10, height: 10, depth: 10 }), [1, 0, 0]);
    const mirroredMesh = ManifoldWorker.evaluateSolid(mirrored);
    for (let i = 0; i < mirroredMesh.normals.length; i += 3) {
      const len = Math.hypot(mirroredMesh.normals[i]!, mirroredMesh.normals[i + 1]!, mirroredMesh.normals[i + 2]!);
      assert(Math.abs(len - 1) < 1e-4);
    }

    // Twisted extrusion side normals should have non-zero Z component
    const twisted = linearExtrude(
      [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
      10,
      { twist: 45, scale: 0.5 },
    );
    const twistedMesh = ManifoldWorker.evaluateSolid(twisted);
    let hasSlopedSideNormal = false;
    for (let i = 0; i < twistedMesh.normals.length; i += 3) {
      const nz = Math.abs(twistedMesh.normals[i + 2]!);
      if (nz > 0.05 && nz < 0.95) {
        hasSlopedSideNormal = true;
        break;
      }
    }
    assert.strictEqual(hasSlopedSideNormal, true);
  });

  it("does not mutate input vertices in createPolygon and preserves smooth normals in splitPolygon", () => {
    // Winding in XY plane has +Z geometric normal, but vertex normals point in -Z so createPolygon reverses its copy
    const reversedInputVerts: CsgVertex[] = [
      { pos: [0, 0, 0], normal: [0, 0, -1] },
      { pos: [10, 0, 0], normal: [0, 0, -1] },
      { pos: [0, 10, 0], normal: [0, 0, -1] },
    ];
    const poly = createPolygon(reversedInputVerts, 0);
    assert(poly !== null);
    // First vertex of reversedInputVerts must remain [0, 0, 0]
    assert.deepStrictEqual(reversedInputVerts[0]!.pos, [0, 0, 0]);
    assert.deepStrictEqual(poly.vertices[0]!.pos, [0, 10, 0]);

    // Split spanning polygon with smooth normals
    const smoothVerts: CsgVertex[] = [
      { pos: [0, 0, 0], normal: [0, 0, 1] },
      { pos: [10, 0, 0], normal: [0.5, 0, 0.866] },
      { pos: [0, 10, 0], normal: [0, 0.5, 0.866] },
    ];
    const unflipped = createPolygon(smoothVerts, 0)!;
    const cutPlane: CsgPlane = { normal: [1, 0, 0], w: 5 };
    const front: (typeof unflipped)[] = [];
    const back: (typeof unflipped)[] = [];
    splitPolygon(cutPlane, unflipped, [], [], front, back);
    assert.strictEqual(front.length, 1);
    assert.strictEqual(back.length, 1);
    // Interpolated vertex at x=5 along edge (0,0,0)->(10,0,0) should have interpolated normal, not flat [0,0,1]
    const interpVert = front[0]!.vertices.find((v) => Math.abs(v.pos[0] - 5) < 1e-5 && Math.abs(v.pos[1]) < 1e-5);
    assert(interpVert !== undefined);
    assert(interpVert.normal[0] > 0.1, `Expected interpolated normal X > 0.1, got ${interpVert.normal[0]}`);
  });

  it("compiles cone frustums to CONICAL_SURFACE and applies scale to analytical sphere STEP B-Rep", () => {
    const cone = cylinder({ radius: 10, radiusBottom: 10, radiusTop: 4, height: 20 });
    const coneStep = compileToStep(cone);
    assert(coneStep.includes("CONICAL_SURFACE("), "Frustum STEP output must contain CONICAL_SURFACE");

    const scaledSphere = scale(sphere({ radius: 5 }), [3, 3, 3]);
    const sphereStep = compileToStep(scaledSphere);
    assert(/SPHERICAL_SURFACE\('',#\d+,15\.0\)/.test(sphereStep), "Scaled sphere STEP must have radius 15.0");
  });

  it("clusters transformed identical primitives and separates distinct dimensions in AssemblyClusteringEngine", () => {
    const b1 = translate(box({ width: 10, height: 10, depth: 10, name: "Bolt_1" }), [10, 0, 0]);
    const b2 = translate(rotate(box({ width: 10, height: 10, depth: 10, name: "Bolt_2" }), [0, 0, 1], 90), [20, 0, 0]);
    const b3 = translate(box({ width: 50, height: 10, depth: 10, name: "Beam_1" }), [0, 30, 0]);
    const asm = assembly("ClusterAsm", [part(b1), part(b2), part(b3)]);

    const res = AssemblyClusteringEngine.clusterAssembly(asm, { minInstanceCount: 2 });
    assert.strictEqual(res.clusters.length, 1);
    assert.strictEqual(res.clusters[0]!.count, 2);
    assert.deepStrictEqual(res.clusters[0]!.batchBuffer.getInstancePosition(0), [10, 0, 0]);
    assert.deepStrictEqual(res.clusters[0]!.batchBuffer.getInstancePosition(1), [20, 0, 0]);
    assert.strictEqual(res.singletons.length, 1);
  });

  it("performs hierarchical BVH raycast and rejects boxes behind the ray", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `item_${i}`,
      aabb: {
        min: [i * 20 - 2, -2, -2] as [number, number, number],
        max: [i * 20 + 2, 2, 2] as [number, number, number],
      },
    }));
    const bvh = new AssemblyBVH(items, 2);
    assert(bvh.depth > 1);

    // Ray starting at x=50 pointing in +X should hit item_3 at x=60 (distance 8), NOT items at x=0,20,40 behind it
    const hit = bvh.raycast([50, 0, 0], [1, 0, 0]);
    assert(hit !== null);
    assert.strictEqual(hit.id, "item_3");
    assert(Math.abs(hit.distance - 8) < 1e-6);

    // Ray starting inside item_0 at [0, 0, 0] should hit item_0 with distance 0
    const insideHit = bvh.raycast([0, 0, 0], [1, 0, 0]);
    assert(insideHit !== null);
    assert.strictEqual(insideHit.id, "item_0");
    assert.strictEqual(insideHit.distance, 0);
  });

  it("guards zero-length axis in rotationMatrix and mirrorMatrix and composes metadata in mergeSourceMetadata", () => {
    assert.deepStrictEqual(rotationMatrix([0, 0, 0], 45), [...IDENTITY]);
    assert.deepStrictEqual(mirrorMatrix([0, 0, 0]), [...IDENTITY]);

    const merged = mergeSourceMetadata(
      { translation: [1, 2, 3], scale: [2, 2, 2] },
      { translation: [4, 5, 6], scale: [3, 1, 0.5] },
    );
    assert.deepStrictEqual(merged?.translation, [5, 7, 9]);
    assert.deepStrictEqual(merged?.scale, [6, 2, 1]);
  });

  it("serializes 0-based CADBinding index as 1-based and preserves sibling Modelica annotations when patching", () => {
    const str = serializeCadBinding({
      property: "position",
      variable: "body.r[1]",
      index: 0,
    });
    assert(str.includes("index = 1"));

    const modelicaCode = `model Test
  Modelica.Mechanics.MultiBody.Parts.Body chassis annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
end Test;`;
    const patched = patchModelicaCadAnnotation(modelicaCode, "chassis", {
      uri: "chassis.step",
    });
    assert(patched.updatedSource.includes("Placement(transformation(extent={{-10,-10},{10,10}}))"));
    assert(patched.updatedSource.includes('uri = "chassis.step"'));
  });

  it("supports all 6 Euler rotation orders, accurate small-angle SLERP, and rad-to-deg animation bindings", () => {
    const orders = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"] as const;
    for (const order of orders) {
      const euler: [number, number, number] = [0.2, -0.35, 0.45];
      const q = quaternionFromEuler(euler[0], euler[1], euler[2], order);
      const back = quaternionToEuler(q, order);
      assert(Math.abs(back[0] - euler[0]) < 1e-5, `Order ${order} X mismatch: ${back[0]} vs ${euler[0]}`);
      assert(Math.abs(back[1] - euler[1]) < 1e-5, `Order ${order} Y mismatch: ${back[1]} vs ${euler[1]}`);
      assert(Math.abs(back[2] - euler[2]) < 1e-5, `Order ${order} Z mismatch: ${back[2]} vs ${euler[2]}`);
    }

    // Small-angle SLERP at t=0.25
    const q0 = quaternionFromAxisAngle([0, 0, 1], 0);
    const q1 = quaternionFromAxisAngle([0, 0, 1], 1e-4);
    const qInterp = quaternionSlerp(q0, q1, 0.25);
    const expected = quaternionFromAxisAngle([0, 0, 1], 0.25e-4);
    assert(Math.abs(qInterp[2] - expected[2]) < 1e-9);

    // AnimationController rad rotation binding -> degrees
    const ctrl = new AnimationController();
    ctrl.setBindings([
      {
        componentName: "pendulum",
        bindings: [{ property: "rotation", index: 2, variable: "rev.phi", unit: "rad" }],
      },
    ]);
    ctrl.loadTimeseries([0, 1], [[0], [Math.PI / 2]], ["rev.phi"]);
    ctrl.seek(1);
    const tf = ctrl.getTransform("pendulum");
    assert(Math.abs(tf.rotation[2] - 90) < 1e-4, `Expected 90 deg, got ${tf.rotation[2]}`);
  });

  it("accounts for asymmetric tolerance mean shift and negative CTE in ToleranceStackVerifier", () => {
    const res = ToleranceStackVerifier.verify({
      name: "Asymmetric_And_Negative_CTE",
      dimensions: [
        {
          name: "HousingSlot",
          nominal: 10.0,
          upperTol: 0.4,
          lowerTol: 0.0,
          direction: 1,
          material: { name: "Invar_Neg", ctePpmK: -2.0 },
        },
        {
          name: "PinWidth",
          nominal: 9.0,
          upperTol: 0.0,
          lowerTol: 0.0,
          direction: -1,
        },
      ],
      environment: { refTempC: 20, operatingTempRange: [20, 120] },
    });
    // Nominal gap = 1.0, asymmetric mean shift = +0.2 -> meanGap at ref = 1.2
    // At 120C (deltaT = 100), negative CTE (-2 ppm/K) shrinks Housing by 10 * -2e-6 * 100 = -0.002 (midpoint -0.001)
    assert(Math.abs(res.thermalExpansionBounds.min - -0.002) < 1e-6);
    assert(Math.abs(res.statisticalRss.meanGap - (1.2 - 0.001)) < 1e-5);
  });

  it("merges existing MCAD source parameters in ParameterInversionEngine and supports multi-axis ROM loads", () => {
    const mcadSource = `const wall_thickness = 2.0;\nconst length = 100.0;\n`;
    // Update only wall_thickness; constraint depends on both wall_thickness and length
    const cert = ParameterInversionEngine.patchMcadSourceCertified(
      mcadSource,
      { wall_thickness: 1.5 },
      {
        constraints: [
          {
            name: "SlendernessRatio",
            description: "length / wall_thickness <= 80",
            evaluate: (p) => p.length! / p.wall_thickness! <= 80,
          },
        ],
      },
    );
    assert.strictEqual(cert.isCertifiedSafe, true);
    assert(cert.updatedSource.includes("const wall_thickness = 1.5;"));

    // Variable-major trajectory layout in RomLoadPipeline
    const loads = RomLoadPipeline.extractPeakTransientLoads(
      {
        t: [0, 0.5, 1.0],
        states: ["flange.f_x", "flange.f_y"],
        // 2 variables x 3 time steps (variable-major)
        y: [
          [0, 120, 40],
          [0, -50, -10],
        ],
      },
      "flange",
    );
    assert.strictEqual(loads.length, 2);
    assert.deepStrictEqual(loads[0]!.forceVector, [120, 0, 0]);
    assert.deepStrictEqual(loads[1]!.forceVector, [0, 50, 0]);

    const deck = RomLoadPipeline.generateCalculixDeck("Bracket", [
      {
        surfacePatchId: "Load_Node_flange",
        appliedForce: [120, -50, 0],
        fixedFaces: ["base_mount", "side_mount"],
      },
    ]);
    assert(deck.includes("Load_Node_flange, 1, 120.00"));
    assert(deck.includes("Load_Node_flange, 2, -50.00"));
    assert(deck.includes("base_mount, 1, 3"));
    assert(deck.includes("side_mount, 1, 3"));
  });

  it("handles ECAD Gerber vias/roundrect/silkscreen, DRC segment/via/rect clearances, obstacle routing, and pin ratsnest", () => {
    // 1. Gerber generation with vias, roundrect solder mask, and silkscreen outline
    const mfgFiles = generateManufacturingFiles({
      traces: [{ start: [10, 10], end: [20, 20], width: 0.25, layer: "TopCopper", net: "VCC" }],
      pads: [
        {
          center: [18, 20],
          width: 1.5,
          height: 0.6,
          drill: 0,
          shape: "roundrect",
          layer: "TopCopper",
          net: "VCC",
          component: "U1",
        },
      ],
      vias: [{ center: [25, 25], drill: 0.4, annularRing: 0.2, net: "VCC" }],
      outline: {
        vertices: [
          [0, 0],
          [50, 0],
          [50, 40],
          [0, 40],
        ],
      },
      netlist: {
        components: [
          {
            name: "U1",
            type: "IC",
            pins: ["1"],
            parameters: {},
            placement: { x: 20, y: 20, rotation: 0, layer: "top" },
          },
        ],
        nets: [],
      },
    });
    const topCopper = mfgFiles.find((f) => f.layer === "TopCopper")!.content;
    assert(topCopper.includes("X25000000Y25000000D03*"), "Via must be flashed on copper layer");
    const topMask = mfgFiles.find((f) => f.layer === "TopSolderMask")!.content;
    assert(topMask.includes("%AMROUNDRECT*"), "Roundrect pad must define %AMROUNDRECT* macro in solder mask");
    const topSilk = mfgFiles.find((f) => f.layer === "TopSilkscreen")!.content;
    assert(topSilk.includes("D01*"), "Silkscreen must draw component outline segments");

    // 2. DRC crossing traces & via clearance
    const drcRes = runDRC({
      pads: [],
      traces: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          width: 0.25,
          layer: "F.Cu",
          netId: "N1",
          selected: false,
        },
        {
          points: [
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
          width: 0.25,
          layer: "F.Cu",
          netId: "N2",
          selected: false,
        },
      ],
      vias: [{ center: { x: 5, y: 0.1 }, outerRadius: 0.4, drillRadius: 0.2, netId: "N3", selected: false }],
      boardOutline: [],
      expectedNets: new Map(),
      rules: DEFAULT_DESIGN_RULES,
    });
    assert(drcRes.violations.length > 0);
    assert(
      drcRes.violations.some(
        (v) => v.rule === "copper-clearance" && v.affectedObjects.includes("N1") && v.affectedObjects.includes("N2"),
      ),
    );

    // 3. Obstacle-aware routing
    const router = new PCBRouter(
      [
        {
          center: { x: 5, y: 0 },
          width: 2,
          height: 2,
          shape: "rect",
          layer: "F.Cu",
          netId: "BLOCK",
          component: "U1",
          pinName: "1",
          selected: false,
        },
      ],
      [],
      DEFAULT_ROUTING_RULES,
    );
    router.startRoute("F.Cu", { x: 0, y: 0 });
    const preview = router.updateRoute({ x: 10, y: 0 });
    assert(preview.length >= 3, "Router must detour around obstacle pad with intermediate waypoints");

    // 4. Renderer ratsnest from pad positions
    const renderer = new PCBRenderer();
    renderer.setPads([
      {
        center: { x: 12, y: 15 },
        width: 1,
        height: 1,
        shape: "rect",
        layer: "F.Cu",
        netId: "N1",
        component: "R1",
        pinName: "p",
        selected: false,
      },
      {
        center: { x: 28, y: 35 },
        width: 1,
        height: 1,
        shape: "rect",
        layer: "F.Cu",
        netId: "N1",
        component: "R2",
        pinName: "n",
        selected: false,
      },
    ]);
    renderer.loadNetlist({
      components: [
        {
          name: "R1",
          type: "Resistor",
          pins: ["p"],
          parameters: {},
          placement: { x: 10, y: 10, rotation: 0, layer: "top" },
        },
        {
          name: "R2",
          type: "Resistor",
          pins: ["n"],
          parameters: {},
          placement: { x: 30, y: 30, rotation: 0, layer: "top" },
        },
      ],
      nets: [
        {
          name: "N1",
          pins: [
            { component: "R1", localName: "p", name: "R1.p" },
            { component: "R2", localName: "n", name: "R2.n" },
          ],
        },
      ],
    });
    const ratsnest = (renderer as any).ratsnest;
    assert.strictEqual(ratsnest.length, 1);
    assert.deepStrictEqual(ratsnest[0].from, { x: 12, y: 15 });
    assert.deepStrictEqual(ratsnest[0].to, { x: 28, y: 35 });
  });
});
