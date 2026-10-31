// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMobility, lintSimpackModel, parseSimDeck, parseSpckXml, simpackToModelica } from "../src/index.js";

describe("@modelscript/simpack", () => {
  it("should parse a SIMPACK XML model (.spck)", () => {
    const xml = `
<simpack_model name="FourBar">
  <body id="crank" name="Crank" mass="2.5" ixx="0.05" iyy="0.05" izz="0.02" />
  <body id="coupler" name="Coupler" mass="4.0" ixx="0.10" iyy="0.10" izz="0.04" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m_crank_base" body="crank" x="0" y="0" z="0" />
  <marker id="m_crank_tip" body="crank" x="0.2" y="0" z="0" />
  <marker id="m_coupler_base" body="coupler" x="0" y="0" z="0" />
  <joint id="j1" type="revolute" from="m_ground" to="m_crank_base" />
  <joint id="j2" type="revolute" from="m_crank_tip" to="m_coupler_base" />
</simpack_model>
`;
    const model = parseSpckXml(xml, "FourBar");
    assert.equal(model.bodies.size, 2);
    assert.equal(model.markers.size, 4);
    assert.equal(model.joints.size, 2);

    const mobility = analyzeMobility(model);
    assert.equal(mobility.numBodies, 2);
    assert.equal(mobility.numJoints, 2);
    // 6*2 - 2*5 = 2 degrees of freedom before closing loop
    assert.equal(mobility.calculatedMobility, 2);

    const diags = lintSimpackModel(model);
    assert.equal(diags.length, 0);

    const mo = simpackToModelica(model);
    assert.ok(mo.includes("model FourBar"));
    assert.ok(mo.includes("Body crank"));
  });

  it("should parse classic SIMPACK ASCII decks (.sim)", () => {
    const deck = `
$ Classic Simpack deck
BODY b_chassis Chassis 1200.0 500.0 800.0 1000.0
MARKER m1 b_chassis 1.5 0.8 -0.3
MARKER m2 $inertial 0.0 0.0 0.0
JOINT j_ground revolute m2 m1
`;
    const model = parseSimDeck(deck, "VehicleChassis");
    assert.equal(model.bodies.size, 1);
    assert.equal(model.markers.size, 2);
    assert.equal(model.joints.size, 1);
    assert.equal(model.bodies.get("b_chassis")?.mass, 1200.0);
  });

  it("should evaluate kinematic loop closure residuals", async () => {
    const { solveLoopClosureResidual } = await import("../src/kinematics/loop-solver.js");
    const positions = new Map([
      ["b1", { x: 0, y: 0, z: 0 }],
      ["b2", { x: 1, y: 0, z: 0 }],
      ["b3", { x: 1, y: 1, z: 0 }],
      ["b4", { x: 0, y: 1, z: 0 }],
    ]);

    const res = solveLoopClosureResidual(positions, ["b1", "b2", "b3", "b4"]);
    assert.ok(res.isClosed);
    assert.ok(Math.abs(res.closureError.x) < 1e-6);
    assert.ok(Math.abs(res.closureError.y) < 1e-6);
  });

  it("should parse SIMPACK Flexible Body Interface (.fbi) modal data", async () => {
    const { parseFbiFile } = await import("../src/parser/fbi-parser.js");
    const fbiContent = `
$ SIMPACK Flexible Body Modal Data
HEADER 1420 4
MODE 1 12.4 1500.0 9.1e6
MODE 2 18.2 1450.0 1.9e7
MODE 3 24.5 1200.0 2.8e7
MODE 4 35.1 1100.0 5.4e7
`;
    const fbi = parseFbiFile(fbiContent, "BogieFrameFlex");
    assert.equal(fbi.numNodes, 1420);
    assert.equal(fbi.numModes, 4);
    assert.equal(fbi.modes[0]?.frequencyHz, 12.4);
    assert.equal(fbi.modes[1]?.generalizedMass, 1450.0);
  });

  it("should evaluate exact 3D spatial transformations and joint constraint equations", async () => {
    const { rotationMatrixFromEuler, computeMarkerSpatialTransform, evaluateJointConstraint } =
      await import("../src/kinematics/index.js");

    const R1 = rotationMatrixFromEuler(0, 0, 0); // Identity
    const tA = computeMarkerSpatialTransform({ x: 0, y: 0, z: 0 }, R1, { x: 0.1, y: 0, z: 0 }, R1);
    const tB = computeMarkerSpatialTransform({ x: 0.1, y: 0, z: 0 }, R1, { x: 0, y: 0, z: 0 }, R1);

    // Revolute joint between coincident markers with aligned axes
    const res = evaluateJointConstraint("rev1", "revolute", tA, tB);
    assert.ok(res.constraintNorm < 1e-6);
    assert.equal(res.positionError.x, 0);
    assert.equal(res.orientationError.x, 0);
  });

  it("should index SIMPACK models into Salsa multi-file WorkspaceIndex", async () => {
    const { SimpackWorkspaceIndex } = await import("../src/workspace-index.js");
    const index = new SimpackWorkspaceIndex();

    const xml = `
<simpack_model name="SuspensionAssembly">
  <body id="b_wheel" mass="45.0" />
  <marker id="m_wheel_center" body="b_wheel" x="0" y="0.8" z="0.3" />
  <joint id="j_spin" type="revolute" from="m_wheel_center" to="m_spindle" />
</simpack_model>
`;
    const res = index.indexFile("file:///workspace/Suspension.spck", xml);
    assert.equal(index.fileCount, 1);
    assert.ok(res.symbols.size >= 3);
    assert.ok(res.byName.has("b_wheel"));
    assert.ok(res.byName.has("j_spin"));
  });

  it("should lower direct 6-DOF kinematics and force element constitutive equations into DAEBuilder", async () => {
    const { lowerSimpackToDae } = await import("../src/dae/simpack-to-dae.js");

    const xml = `
<simpack_model name="QuarterCar">
  <body id="b_chassis" name="Chassis" mass="350.0" ixx="80.0" iyy="120.0" izz="150.0" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m_chassis_mount" body="b_chassis" x="0" y="0" z="-0.2" />
  <spring id="s1" from="m_ground" to="m_chassis_mount" kz="40000" cz="2500" />
</simpack_model>
`;
    const model = parseSpckXml(xml, "QuarterCar");
    const dae = lowerSimpackToDae(model);

    // 1 body: 12 variables (x,y,z,vx,vy,vz,phi,theta,psi,wx,wy,wz)
    // 1 force: 3 variables (s1.fx, s1.fy, s1.fz)
    // Total variables: 15
    assert.equal(dae.varCount, 15);

    // Verify lookup of variables
    assert.ok(dae.lookupVariable("b_chassis.z") >= 0);
    assert.ok(dae.lookupVariable("b_chassis.vz") >= 0);
    assert.ok(dae.lookupVariable("b_chassis.wz") >= 0);
    assert.ok(dae.lookupVariable("s1.fz") >= 0);

    // 1 body: 12 equations (6 kinematic + 3 translational Newton + 3 rotational Euler)
    // 1 force: 3 constitutive equations (s1.fx, s1.fy, s1.fz)
    // Total equations: 15
    assert.equal(dae.eqCount, 15);
  });

  it("should simulate direct DAE dynamics of a quarter-car multibody suspension", async () => {
    const { lowerSimpackToDae } = await import("../src/dae/simpack-to-dae.js");
    const { initBltWasm } = await import("@modelscript/runtime");
    const { simulateArena } = await import("@modelscript/simulate");

    await initBltWasm();

    const xml = `
<simpack_model name="QuarterCar">
  <body id="b_chassis" name="Chassis" mass="350.0" ixx="80.0" iyy="120.0" izz="150.0" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m_chassis_mount" body="b_chassis" x="0" y="0" z="-0.2" />
  <spring id="s1" from="m_ground" to="m_chassis_mount" kz="40000" cz="2500" />
</simpack_model>
`;
    const model = parseSpckXml(xml, "QuarterCar");
    const dae = lowerSimpackToDae(model);

    const zIdx = dae.lookupVariable("b_chassis.z");
    if (zIdx >= 0) {
      dae.setVarStartValue(zIdx, 0.08); // 80 mm initial bump displacement
    }

    const result = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.5,
      step: 0.001,
    });

    assert.equal(result.t.length, 501);
    const zStateIdx = result.states.indexOf("b_chassis.z");
    assert.ok(zStateIdx >= 0);
    assert.equal(result.y[0]![zStateIdx], 0.08);
  });

  it("should evaluate mathematical expressions in SIMPACK XML attributes and ASCII decks", async () => {
    const xml = `
<simpack_model name="Arm">
  <body id="link1" mass="2.5 * 2" ixx="0.05 / 2" />
  <marker id="m1" body="link1" x="0.1 + 0.15" y="0" z="0" />
</simpack_model>
`;
    const model = parseSpckXml(xml, "Arm");
    const link1 = model.bodies.get("link1");
    assert.ok(link1);
    assert.equal(link1.mass, 5.0);
    assert.equal(link1.inertia.ixx, 0.025);
    const m1 = model.markers.get("m1");
    assert.ok(m1);
    assert.equal(m1.position.x, 0.25);

    const deck = `
$ Parameter expression in SIMPACK deck
set l_base = 0.5 * 3
BODY b_chassis Chassis (600.0 * 2) 500.0 800.0 1000.0
MARKER m1 b_chassis l_base 0.0 0.0
`;
    const deckModel = parseSimDeck(deck, "DeckArm");
    const chassis = deckModel.bodies.get("b_chassis");
    assert.ok(chassis);
    assert.equal(chassis.mass, 1200.0);
    const deckM1 = deckModel.markers.get("m1");
    assert.ok(deckM1);
    assert.equal(deckM1.position.x, 1.5);
  });

  it("should merge multiple SIMPACK sub-models into a unified multi-body assembly", async () => {
    const { SimpackWorkspaceIndex } = await import("../src/workspace-index.js");
    const index = new SimpackWorkspaceIndex();

    const wheelXml = `
<simpack_model name="WheelModule">
  <body id="wheel" mass="45.0" />
  <marker id="m_hub" body="wheel" x="0" y="0" z="0" />
</simpack_model>
`;
    index.indexFile("file:///workspace/Wheel.spck", wheelXml);

    const chassisXml = `
<simpack_model name="ChassisAssembly">
  <body id="chassis" mass="350.0" />
  <marker id="m_susp_point" body="chassis" x="0" y="0" z="-0.2" />
</simpack_model>
`;
    index.indexFile("file:///workspace/Chassis.spck", chassisXml);

    const chassisModel = index.getModel("file:///workspace/Chassis.spck")!;
    assert.equal(chassisModel.bodies.size, 1);

    const merged = index.mergeAssembly(chassisModel, ["file:///workspace/Wheel.spck"]);
    assert.equal(merged.bodies.size, 2);
    assert.ok(merged.bodies.has("chassis"));
    assert.ok(merged.bodies.has("WheelModule.wheel"));
    assert.ok(merged.markers.has("WheelModule.m_hub"));
  });

  it("should achieve 100% numerical parity between WebAssembly kernel and pure TS reference", async () => {
    const {
      getWasmKinematicsBridge,
      pureTsRotationMatrixFromEuler,
      pureTsMultiplyMatrices,
      pureTsTransformVector,
      pureTsComputeMarkerSpatialTransform,
      pureTsEvaluateJointConstraint,
    } = await import("../src/kinematics/index.js");

    const bridge = getWasmKinematicsBridge();
    assert.ok(bridge);

    // 1. Tait-Bryan Euler rotation matrix parity
    const angles = [
      [0, 0, 0],
      [0.1, 0.2, 0.3],
      [Math.PI / 4, Math.PI / 6, Math.PI / 3],
      [-0.5, 1.2, -0.8],
    ];

    for (const [alpha, beta, gamma] of angles) {
      const rWasm = bridge.rotationMatrixFromEuler(alpha!, beta!, gamma!);
      const rTs = pureTsRotationMatrixFromEuler(alpha!, beta!, gamma!);

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          assert.ok(
            Math.abs(rWasm[r]![c]! - rTs[r]![c]!) < 1e-14,
            `Mismatch at [${r}][${c}]: wasm=${rWasm[r]![c]!}, ts=${rTs[r]![c]!}`,
          );
        }
      }
    }

    // 2. Matrix multiplication parity
    const A = bridge.rotationMatrixFromEuler(0.2, 0.4, 0.6);
    const B = bridge.rotationMatrixFromEuler(-0.3, 0.5, -0.1);
    const mAB_wasm = bridge.multiplyMatrices(A, B);
    const mAB_ts = pureTsMultiplyMatrices(A, B);

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(mAB_wasm[r]![c]! - mAB_ts[r]![c]!) < 1e-14);
      }
    }

    // 3. Vector transformation parity
    const v = { x: 1.5, y: -2.3, z: 0.7 };
    const tv_wasm = bridge.transformVector(A, v);
    const tv_ts = pureTsTransformVector(A, v);
    assert.ok(Math.abs(tv_wasm.x - tv_ts.x) < 1e-14);
    assert.ok(Math.abs(tv_wasm.y - tv_ts.y) < 1e-14);
    assert.ok(Math.abs(tv_wasm.z - tv_ts.z) < 1e-14);

    // 4. Marker spatial transform parity
    const bodyPos = { x: 10.0, y: -5.0, z: 2.0 };
    const markerLocalPos = { x: 0.5, y: 0.2, z: -0.1 };
    const st_wasm = bridge.computeMarkerSpatialTransform(bodyPos, A, markerLocalPos, B);
    const st_ts = pureTsComputeMarkerSpatialTransform(bodyPos, A, markerLocalPos, B);

    assert.ok(Math.abs(st_wasm.position.x - st_ts.position.x) < 1e-14);
    assert.ok(Math.abs(st_wasm.position.y - st_ts.position.y) < 1e-14);
    assert.ok(Math.abs(st_wasm.position.z - st_ts.position.z) < 1e-14);

    // 5. Joint constraint evaluation across all joint types
    const jointTypes = ["spherical", "revolute", "prismatic", "fixed", "cylindrical", "planar"] as const;
    const markerB_st = bridge.computeMarkerSpatialTransform(
      { x: 10.1, y: -4.95, z: 2.05 },
      A,
      { x: 0.5, y: 0.2, z: -0.1 },
      B,
    );

    for (const jType of jointTypes) {
      const resWasm = bridge.evaluateJointConstraint("j_test", jType, st_wasm, markerB_st);
      const resTs = pureTsEvaluateJointConstraint("j_test", jType, st_ts, markerB_st);

      assert.ok(Math.abs(resWasm.constraintNorm - resTs.constraintNorm) < 1e-14);
      assert.ok(Math.abs(resWasm.positionError.x - resTs.positionError.x) < 1e-14);
      assert.ok(Math.abs(resWasm.positionError.y - resTs.positionError.y) < 1e-14);
      assert.ok(Math.abs(resWasm.positionError.z - resTs.positionError.z) < 1e-14);
      assert.ok(Math.abs(resWasm.orientationError.x - resTs.orientationError.x) < 1e-14);
      assert.ok(Math.abs(resWasm.orientationError.y - resTs.orientationError.y) < 1e-14);
      assert.ok(Math.abs(resWasm.orientationError.z - resTs.orientationError.z) < 1e-14);
    }
  });

  it("should evaluate batched marker transformations and joint constraints in WebAssembly", async () => {
    const { getWasmKinematicsBridge } = await import("../src/kinematics/index.js");
    const bridge = getWasmKinematicsBridge();

    const identity = bridge.identityMatrix();
    const rotCarbody = bridge.rotationMatrixFromEuler(0.01, 0.02, 0.005);
    const rotBogie = bridge.rotationMatrixFromEuler(0.015, -0.01, 0.002);

    // 3 Bodies: 0 = Carbody, 1 = Bogie1, 2 = Bogie2
    const bodyTransforms = [
      { position: { x: 0, y: 0, z: 1.5 }, rotation: rotCarbody },
      { position: { x: 7.5, y: 0, z: 0.6 }, rotation: rotBogie },
      { position: { x: -7.5, y: 0, z: 0.6 }, rotation: rotBogie },
    ];

    // Markers on various bodies (and -1 for inertial track)
    const markers = [
      { bodyIdx: -1, localPos: { x: 0, y: 0, z: 0 }, localRot: identity },
      { bodyIdx: 0, localPos: { x: 7.5, y: 0, z: -0.5 }, localRot: identity },
      { bodyIdx: 1, localPos: { x: 0, y: 0, z: 0.4 }, localRot: identity },
      { bodyIdx: 0, localPos: { x: -7.5, y: 0, z: -0.5 }, localRot: identity },
      { bodyIdx: 2, localPos: { x: 0, y: 0, z: 0.4 }, localRot: identity },
    ];

    // Batch marker transform in WebAssembly
    const globalMarkers = bridge.batchMarkerTransforms(markers, bodyTransforms);
    assert.equal(globalMarkers.length, 5);

    // Marker 0 is ground (inertial frame)
    assert.equal(globalMarkers[0]?.position.x, 0);
    assert.equal(globalMarkers[0]?.position.y, 0);
    assert.equal(globalMarkers[0]?.position.z, 0);

    // Marker 1 is on carbody (z = 1.5 - sin(0.02)*7.5 - cos(0.02)*0.5 ≈ 0.85)
    assert.ok(globalMarkers[1]!.position.z > 0.8);

    // Evaluate joints connecting markers
    const joints = [
      { id: "j_secondary_front", type: "revolute" as const, markerAIdx: 1, markerBIdx: 2 },
      { id: "j_secondary_rear", type: "revolute" as const, markerAIdx: 3, markerBIdx: 4 },
    ];

    const residuals = bridge.batchEvaluateJoints(joints, globalMarkers);
    assert.equal(residuals.length, 2);
    assert.equal(residuals[0]?.jointId, "j_secondary_front");
    assert.equal(residuals[1]?.jointId, "j_secondary_rear");
    assert.ok(residuals[0]!.constraintNorm >= 0);
    assert.ok(residuals[1]!.constraintNorm >= 0);

    // High throughput benchmark
    const N = 10000;
    const tStart = performance.now();
    for (let k = 0; k < N; k++) {
      bridge.rotationMatrixFromEuler(0.01 * k, 0.02 * k, 0.005 * k);
    }
    const tElapsed = performance.now() - tStart;
    assert.ok(tElapsed < 500, `Benchmark took ${tElapsed}ms for ${N} operations (< 500ms expected)`);
  });

  it("should detect unclosed 4-bar loop residuals (no telescoping cancellation) and iteratively close the loop", async () => {
    const { solveLoopClosureResidual } = await import("../src/kinematics/loop-solver.js");
    const openPositions = new Map([
      ["b1", { x: 0, y: 0, z: 0 }],
      ["b2", { x: 1, y: 0, z: 0 }],
      ["b3", { x: 1, y: 1, z: 0 }],
      ["b4", { x: 0, y: 2.5, z: 0 }],
    ]);

    const res = solveLoopClosureResidual(openPositions, ["b1", "b2", "b3", "b4"]);
    assert.equal(res.isClosed, false);
    const errNorm = Math.sqrt(res.closureError.x ** 2 + res.closureError.y ** 2 + res.closureError.z ** 2);
    assert.ok(errNorm > 0.5, `Expected non-zero closure residual, got ${errNorm}`);
    assert.ok(res.adjustedPositions);

    // Re-evaluating the iteratively adjusted positions should close the loop
    const recheck = solveLoopClosureResidual(res.adjustedPositions, ["b1", "b2", "b3", "b4"]);
    assert.equal(recheck.isClosed, true);
  });

  it("should emit K7006 BAUMGARTE_DIVERGENCE when joint Baumgarte stabilization parameters are non-positive", () => {
    const xml = `
<simpack_model name="DivergentBaumgarte">
  <body id="b1" mass="10.0" />
  <marker id="m0" body="$inertial" x="0" y="0" z="0" />
  <marker id="m1" body="b1" x="0" y="0" z="0" />
  <joint id="j1" type="revolute" from="m0" to="m1" alpha="-5.0" beta="0.0" />
</simpack_model>
`;
    const model = parseSpckXml(xml, "DivergentBaumgarte");
    const diags = lintSimpackModel(model);
    const k7006 = diags.filter((d) => d.code === "K7006");
    assert.equal(k7006.length, 2);
  });

  it("should lower 3D marker lever arms, rotational joint constraints, and 6-DOF rotational/nonlinear bushings into DAE arena", async () => {
    const { lowerSimpackToDae, getSimpackJointConstraintSpec } = await import("../src/dae/simpack-to-dae.js");

    const xml = `
<simpack_model name="BogieSuspension">
  <body id="b_frame" mass="1200.0" ixx="400.0" iyy="800.0" izz="900.0" />
  <body id="b_wheelset" mass="800.0" ixx="200.0" iyy="50.0" izz="200.0" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m_frame_pivot" body="b_frame" x="0.5" y="0.2" z="-0.1" />
  <marker id="m_frame_bush" body="b_frame" x="1.2" y="0.8" z="-0.3" />
  <marker id="m_wheel_bush" body="b_wheelset" x="1.2" y="0.8" z="0.0" />
  <joint id="j_rev" type="revolute" from="m_ground" to="m_frame_pivot" />
  <bushing id="bush1" from="m_frame_bush" to="m_wheel_bush"
    kx="500000" ky="500000" kz="800000"
    cx="5000" cy="5000" cz="12000"
    krx="25000" kry="15000" krz="30000"
    crx="400" cry="300" crz="500"
    k3z="1000000" />
</simpack_model>
`;
    const model = parseSpckXml(xml, "BogieSuspension");
    const dae = lowerSimpackToDae(model, undefined, { stabilization: "lagrange" });

    // 2 bodies (24 vars) + 1 bushing with rotational stiffness (3 trans + 3 rot = 6 vars) + 1 revolute joint (5 lam vars) = 35
    assert.equal(dae.varCount, 35);
    assert.equal(dae.eqCount, 35);

    const varNames = dae.getVariables().map((v) => v.name);
    assert.ok(varNames.includes("bush1.tx") && varNames.includes("bush1.ty") && varNames.includes("bush1.tz"));
    for (let k = 0; k < 5; k++) {
      assert.ok(varNames.includes(`lam_j_rev_${k}`), `Expected lam_j_rev_${k}`);
    }

    const referencedVars = new Set<string>();
    for (const eq of dae.getEquations()) {
      dae.collectExprVarNames(eq.lhs, referencedVars);
      dae.collectExprVarNames(eq.rhs, referencedVars);
    }
    // Verify 3D rotational lever arm terms (theta * sz - psi * sy) on offset markers
    assert.ok(referencedVars.has("b_frame.theta") && referencedVars.has("b_frame.psi"));

    // Verify joint constraint specs across all joint types
    assert.equal(getSimpackJointConstraintSpec("spherical").transAxes.length, 3);
    assert.equal(
      getSimpackJointConstraintSpec("universal").transAxes.length +
        getSimpackJointConstraintSpec("universal").rotAxes.length,
      4,
    );
    assert.equal(
      getSimpackJointConstraintSpec("cylindrical").transAxes.length +
        getSimpackJointConstraintSpec("cylindrical").rotAxes.length,
      4,
    );
    assert.equal(
      getSimpackJointConstraintSpec("prismatic").transAxes.length +
        getSimpackJointConstraintSpec("prismatic").rotAxes.length,
      5,
    );
    assert.equal(
      getSimpackJointConstraintSpec("fixed").transAxes.length + getSimpackJointConstraintSpec("fixed").rotAxes.length,
      6,
    );
  });
});
