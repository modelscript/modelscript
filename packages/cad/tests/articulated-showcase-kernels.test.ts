// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOY_MATERIAL_PRESETS,
  AnimationController,
  AssemblyBVH,
  assembly,
  box,
  buildAssemblyGraph,
  classifyAlloyPreset,
  cylinder,
  decimateMeshForLoD,
  evaluateForwardKinematics,
  part,
  resolveActiveMissionPhase,
  sampleTelemetryFrame,
  solveBranchedTreeIk,
  solveConstrainedChainIk,
  solveSliderCrankKinematics,
  solveSwashplatePumpKinematics,
  sphere,
  synthesizeMechanicalDetailTextures,
  type BVHItem,
  type SimulatorHudSpec,
} from "../src/index.js";

describe("Articulated Showcase Kernels (@modelscript/cad)", () => {
  describe("Studio PBR Robotic Presets & Mechanical Detail Maps", () => {
    it("exposes robotic ceramic, anodized, safety-orange, and optical presets", () => {
      assert.ok(ALLOY_MATERIAL_PRESETS["ceramic-white-shell"].useDetailMaps);
      assert.ok(ALLOY_MATERIAL_PRESETS["dark-anodized-joint"].metalness > 0.8);
      assert.equal(classifyAlloyPreset("mantle_carapace_upper"), "ceramic-white-shell");
      assert.equal(classifyAlloyPreset("optic_eye_lens"), "optical-lens-glass");
      assert.equal(classifyAlloyPreset("safety_trim_ring"), "safety-orange-accent");
      assert.equal(classifyAlloyPreset("arm_knuckle_joint"), "dark-anodized-joint");
    });

    it("synthesizes tileable panel-seam and micro-rivet detail buffers", () => {
      const maps = synthesizeMechanicalDetailTextures(64);
      assert.equal(maps.size, 64);
      assert.equal(maps.normalRgba.length, 64 * 64 * 4);
      assert.equal(maps.roughnessRgba.length, 64 * 64 * 4);
      assert.equal(maps.aoRgba.length, 64 * 64 * 4);

      // Seam edge (x = 0) should have darker AO than panel interior (x = 16, y = 16)
      const seamAo = maps.aoRgba[(16 * 64 + 0) * 4]!;
      const interiorAo = maps.aoRgba[(16 * 64 + 16) * 4]!;
      assert.ok(seamAo < interiorAo, `Expected seam AO (${seamAo}) < interior AO (${interiorAo})`);
    });
  });

  describe("Hierarchical AssemblyGraph & Forward Kinematics", () => {
    it("builds topological FK order, subsystem part counts, and evaluates chained joints", () => {
      const mantle = sphere({ radius: 0.2, name: "mantle_core" });
      const seg1 = cylinder({ radius: 0.04, height: 0.12, name: "arm0_seg1" });
      const seg2 = cylinder({ radius: 0.03, height: 0.1, name: "arm0_seg2" });
      const pump = box({ width: 0.08, height: 0.1, depth: 0.08, name: "pump_core" });

      const asm = assembly(
        "PelagosTest",
        [
          part(seg2, {
            subsystemId: "arm-chains",
            parentName: "arm0_seg1",
            joint: { kind: "revolute", origin: [0.12, 0, 0], axis: [0, 0, 1], channel: "q2" },
          }),
          part(mantle, { subsystemId: "mantle" }),
          part(seg1, {
            subsystemId: "arm-chains",
            parentName: "mantle_core",
            joint: { kind: "revolute", origin: [0.2, 0, 0], axis: [0, 0, 1], channel: "q1" },
          }),
          part(pump, { subsystemId: "pump-core", parentName: "mantle_core" }),
        ],
        {
          subsystems: [
            { id: "mantle", code: "02", label: "MANTLE", defaultGhostable: true },
            { id: "pump-core", code: "03", label: "PUMP CORE" },
            { id: "arm-chains", code: "04", label: "ARM CHAINS" },
          ],
        },
      );

      const graph = buildAssemblyGraph(asm);
      assert.equal(graph.nodes.length, 4);

      const idxMantle = graph.nameToNodeIndex.get("mantle_core")!;
      const idxSeg1 = graph.nameToNodeIndex.get("arm0_seg1")!;
      const idxSeg2 = graph.nameToNodeIndex.get("arm0_seg2")!;

      assert.ok(graph.topologicalOrder.indexOf(idxMantle) < graph.topologicalOrder.indexOf(idxSeg1));
      assert.ok(graph.topologicalOrder.indexOf(idxSeg1) < graph.topologicalOrder.indexOf(idxSeg2));

      const armSub = graph.subsystems.find((s) => s.id === "arm-chains");
      assert.equal(armSub?.partCount, 2);

      // Rotate q1 by +90 deg about +Z: seg2 origin (0.12, 0, 0) in seg1 frame moves to (0.2, 0.12, 0)
      const fk = evaluateForwardKinematics(graph, { q1: Math.PI / 2, q2: 0 });
      assert.ok(Math.abs(fk.positions[idxSeg2 * 3]! - 0.2) < 1e-6);
      assert.ok(Math.abs(fk.positions[idxSeg2 * 3 + 1]! - 0.12) < 1e-6);

      // Detach arm0_seg1 from mantle_core: seg1 moves to root-relative origin, seg2 follows seg1
      const fkDetached = evaluateForwardKinematics(graph, { q1: 0, q2: 0 }, fk, new Set(["arm0_seg1"]));
      assert.ok(Math.abs(fkDetached.positions[idxSeg1 * 3]! - 0.2) < 1e-6);
      assert.ok(Math.abs(fkDetached.positions[idxSeg2 * 3]! - 0.32) < 1e-6);
    });
  });

  describe("Constrained Chain IK, Branched Tree IK & Closed-Loop Pump Kinematics", () => {
    it("respects angular cone limits during constrained FABRIK solves", () => {
      const initial = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ];
      const maxAngle = Math.PI / 6; // 30 deg max bend per joint
      const res = solveConstrainedChainIk(
        initial,
        { x: -1, y: 1.5, z: 0 },
        {
          maxIterations: 30,
          jointLimits: [{ maxConeAngleRad: maxAngle }, { maxConeAngleRad: maxAngle }, { maxConeAngleRad: maxAngle }],
        },
      );

      // Verify consecutive bone angles obey maxAngle (plus numerical tolerance)
      let prevDir = { x: 1, y: 0, z: 0 };
      for (let i = 0; i < res.joints.length - 1; i++) {
        const dx = res.joints[i + 1]!.x - res.joints[i]!.x;
        const dy = res.joints[i + 1]!.y - res.joints[i]!.y;
        const dz = res.joints[i + 1]!.z - res.joints[i]!.z;
        const len = Math.hypot(dx, dy, dz);
        const dir = { x: dx / len, y: dy / len, z: dz / len };
        const angle = Math.acos(Math.max(-1, Math.min(1, dir.x * prevDir.x + dir.y * prevDir.y + dir.z * prevDir.z)));
        assert.ok(angle <= maxAngle + 1e-3, `Joint ${i} exceeded cone limit: ${angle} > ${maxAngle}`);
        prevDir = dir;
      }
    });

    it("solves multi-arm branched IK including a detached arm", () => {
      const result = solveBranchedTreeIk({ x: 0, y: 0, z: 0 }, [
        {
          id: "arm0",
          initialJoints: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
          ],
          target: { x: 1.4, y: 1.0, z: 0 },
          attached: true,
        },
        {
          id: "arm3_detached",
          initialJoints: [
            { x: 3, y: 0, z: 0 },
            { x: 4, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
          target: { x: 4.2, y: 1.1, z: 0 },
          attached: false,
        },
      ]);

      assert.equal(result.branches.size, 2);
      assert.ok(result.branches.get("arm0")!.reached);
      assert.ok(result.branches.get("arm3_detached")!.reached);
      // Detached branch root stayed at x = 3 instead of snapping to root (0,0,0)
      assert.ok(Math.abs(result.branches.get("arm3_detached")!.joints[0]!.x - 3) < 1e-6);
    });

    it("solves 7-piston swashplate pump and slider-crank closed-loop kinematics accurately", () => {
      const pump = solveSwashplatePumpKinematics(0.75, 7, 0.28, 0.042);
      assert.equal(pump.pistons.length, 7);
      const dischargingCount = pump.pistons.filter((p) => p.isDischarging).length;
      assert.ok(dischargingCount === 3 || dischargingCount === 4);
      assert.ok(pump.instantaneousFlowNorm > 0.85 && pump.instantaneousFlowNorm < 1.15);

      const crank = solveSliderCrankKinematics(Math.PI / 2, 0.05, 0.2);
      // At 90 deg, crankPin is (0, 0.05), slider x = sqrt(0.2^2 - 0.05^2)
      assert.ok(Math.abs(crank.sliderPosition - Math.sqrt(0.2 * 0.2 - 0.05 * 0.05)) < 1e-6);
    });
  });

  describe("Variable-Topology AnimationController (Detach / Reconnect & Visibility)", () => {
    it("couples attached components to parent pose and releases them when detached", () => {
      const ctrl = new AnimationController();
      ctrl.loadTimeseries(
        [0, 5, 10],
        [
          [0, 0, 1, 1], // t=0: mantle x=0, arm local x=0, attached=1, visible=1
          [2, 0.5, 0, 1], // t=5: mantle x=2, arm world x=0.5, attached=0, visible=1
          [4, 0, 1, 0], // t=10: mantle x=4, arm local x=0, attached=1, visible=0
        ],
        ["mantle.x", "arm3.x", "arm3.attached", "arm3.visible"],
      );
      ctrl.updateBinding({
        componentName: "mantle",
        bindings: [{ property: "position", index: 0, variable: "mantle.x" }],
      });
      ctrl.updateBinding({
        componentName: "arm3",
        bindings: [
          { property: "position", index: 0, variable: "arm3.x" },
          { property: "visible", variable: "arm3.visible" },
        ],
      });
      ctrl.setAttachmentRules([
        {
          componentName: "arm3",
          parentName: "mantle",
          attachmentVariable: "arm3.attached",
          mountOffset: [0.25, 0, 0],
        },
      ]);

      ctrl.seek(0);
      const tf0 = ctrl.getTransform("arm3");
      assert.equal(tf0.attached, true);
      assert.equal(tf0.visible, true);
      assert.ok(Math.abs(tf0.position[0] - 0.25) < 1e-6);

      ctrl.seek(5);
      const tf5 = ctrl.getTransform("arm3");
      assert.equal(tf5.attached, false);
      assert.ok(Math.abs(tf5.position[0] - 0.5) < 1e-6);

      ctrl.seek(10);
      const tf10 = ctrl.getTransform("arm3");
      assert.equal(tf10.attached, true);
      assert.equal(tf10.visible, false);
      assert.ok(Math.abs(tf10.position[0] - 4.25) < 1e-6);

      ctrl.removeBinding("arm3");
      assert.equal(ctrl.getComponentValues("arm3").length, 0);
    });
  });

  describe("Incremental AssemblyBVH.refit() & Vertex-Clustering Mesh Decimation", () => {
    it("refits moving AABBs in-place and updates raycast hits without rebuilding", () => {
      const items: BVHItem[] = [
        { id: 10, aabb: { min: [-1, -1, -1], max: [1, 1, 1] } },
        { id: 20, aabb: { min: [5, -1, -1], max: [7, 1, 1] } },
      ];
      const bvh = new AssemblyBVH(items, 1);

      const hitBefore = bvh.raycast([0, 0, -10], [0, 0, 1]);
      assert.equal(hitBefore?.id, 10);

      // Move item 10 away and move item 20 into the ray path
      bvh.refit(
        new Map([
          [10, { min: [20, -1, -1], max: [22, 1, 1] }],
          [20, { min: [-1, -1, -1], max: [1, 1, 1] }],
        ]),
      );

      const hitAfter = bvh.raycast([0, 0, -10], [0, 0, 1]);
      assert.equal(hitAfter?.id, 20);
      assert.equal(bvh.root.aabb.max[0], 22);
    });

    it("decimates high-poly meshes while preserving non-degenerate geometry and normals", () => {
      // Build a 16x16 grid mesh (289 vertices, 512 triangles)
      const grid = 16;
      const verts: number[] = [];
      const indices: number[] = [];
      for (let y = 0; y <= grid; y++) {
        for (let x = 0; x <= grid; x++) {
          verts.push(x / grid, Math.sin(x * 0.4) * 0.1, y / grid);
        }
      }
      for (let y = 0; y < grid; y++) {
        for (let x = 0; x < grid; x++) {
          const i0 = y * (grid + 1) + x;
          const i1 = i0 + 1;
          const i2 = i0 + (grid + 1);
          const i3 = i2 + 1;
          indices.push(i0, i2, i1, i1, i2, i3);
        }
      }

      const dec = decimateMeshForLoD(verts, indices, 0.25);
      assert.equal(dec.originalTriangleCount, 512);
      assert.ok(dec.decimatedTriangleCount > 0 && dec.decimatedTriangleCount < dec.originalTriangleCount);
      assert.equal(dec.normals.length, dec.vertices.length);
    });
  });

  describe("Headless Field-Simulator Telemetry HUD Sampling", () => {
    it("samples gauges, sparklines, bar arrays, horizons, and active mission phases", () => {
      const spec: SimulatorHudSpec = {
        modelCode: "Pelagos OC-8",
        modelSubtitle: "EIGHT-ARM SUBSEA DRONE",
        simId: "OC8-0731",
        durationSec: 25,
        loadGauge: { label: "JET LOAD", channel: "jet.load", ticks: ["IDLE", "CRUISE", "BURST"] },
        statusChannel: "jet.thrust",
        statusRules: [
          { minValue: 0, label: "STANDBY", color: "#94a3b8" },
          { minValue: 3, label: "JETTING", color: "#f97316" },
        ],
        leftWidgets: [
          {
            kind: "sparkline",
            id: "thrust",
            code: "01",
            label: "THRUST",
            unit: "N",
            channel: "jet.thrust",
            min: 0,
            max: 10,
            accentColor: "#f97316",
          },
          {
            kind: "bar-array",
            id: "arms",
            code: "03",
            label: "CURLING",
            channels: [
              { id: "a1", label: "A1", channel: "arm1.curl", attachedChannel: "arm1.attached" },
              { id: "a3", label: "A3", channel: "arm3.curl", attachedChannel: "arm3.attached" },
            ],
            min: 0,
            max: 100,
            accentColor: "#f97316",
          },
        ],
        rightWidgets: [
          {
            kind: "horizon",
            id: "depth",
            code: "04",
            label: "DEPTH",
            depthChannel: "depth.m",
            pitchChannel: "att.pitch",
            rollChannel: "att.roll",
            holdChannel: "depth.hold",
          },
        ],
        missionPhases: [
          { id: "dive", label: "DIVE", startTime: 0, endTime: 6, color: "#38bdf8" },
          { id: "jet", label: "INBOUND · JET ASSIST", startTime: 6, endTime: 20, color: "#f97316" },
        ],
        operationLog: [{ id: "ev1", time: 8, code: "DETACH", label: "Arm 3 Autonomous Detach", category: "autonomy" }],
      };

      const frame = sampleTelemetryFrame(spec, 14, null, (ch) => {
        if (ch === "jet.load") return 78;
        if (ch === "jet.thrust") return 6.0;
        if (ch === "arm1.curl") return 77;
        if (ch === "arm1.attached") return 1;
        if (ch === "arm3.curl") return 63;
        if (ch === "arm3.attached") return 0;
        if (ch === "depth.m") return 42.5;
        if (ch === "att.pitch") return -6.5;
        if (ch === "att.roll") return 2.1;
        if (ch === "depth.hold") return 1;
        return 0;
      });

      assert.equal(frame.loadPercent, 78);
      assert.equal(frame.statusLabel, "JETTING");
      assert.equal(resolveActiveMissionPhase(spec.missionPhases, 14)?.id, "jet");
      const armWidget = frame.leftWidgets[1]!;
      assert.equal(armWidget.kind, "bar-array");
      assert.equal(armWidget.bars[0]!.attached, true);
      assert.equal(armWidget.bars[1]!.attached, false);
      const horizon = frame.rightWidgets[0]!;
      assert.equal(horizon.kind, "horizon");
      assert.equal(horizon.holdActive, true);
      assert.equal(horizon.depth, 42.5);
    });
  });
});
