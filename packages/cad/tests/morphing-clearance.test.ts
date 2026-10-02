// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembly,
  box,
  cylinder,
  DynamicClearanceVerifier,
  part,
  translate,
  type DynamicTransformBinding,
  type TrajectoryStepEnclosure,
} from "../src/index.js";

describe("CAD 4D Deformable Organ & Device Spatial Clearance Verifier", () => {
  it("should compute exact closest point pair and dynamic clearance vector", () => {
    // Left Ventricle Wall patch: 40x40x40mm centered at origin
    // Bounds: X [-20, 20], Y [-20, 20], Z [-20, 20]
    const lvWall = box({ width: 40, height: 40, depth: 40, name: "LV_Myocardium" });

    // LVAD Inflow Cannula: Cylinder radius 6mm, height 30mm, placed along Z axis at Z=45mm
    // Bounds: X [-6, 6], Y [-15, 15], Z [30, 60]
    // Distance along Z: 30 - 20 = 10mm
    const cannula = translate(cylinder({ radius: 6, height: 30, name: "Cannula" }), [0, 0, 45]);

    const asm = assembly("CardiacDeviceAssembly", [part(lvWall), part(cannula)]);

    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { "cannula.dispZ": { lo: 0.0, hi: 0.0 } },
        nominal: { "cannula.dispZ": 0.0 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "Cannula",
        translation: { z: "cannula.dispZ" },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 5.0,
    });

    assert.strictEqual(report.isCertifiedSafe, true);
    assert.strictEqual(report.timeHistory.length, 1);
    const step = report.timeHistory[0]!;
    assert.strictEqual(Math.round(step.minDistance), 19);
    assert.ok(step.closestPoints, "Closest points must be recorded");

    // Closest point on LV_Myocardium is (0, 0, 20) and on Cannula is (0, 0, 39)
    const [ptA, ptB] = step.closestPoints;
    assert.strictEqual(Math.round(ptA[2]), 20);
    assert.strictEqual(Math.round(ptB[2]), 39);
  });

  it("should evaluate dynamic volume-radial deformation and certify clearance during normal heartbeat", () => {
    // Ventricular chamber: 60x60x60mm reference box at origin (representing end-diastole V0 = 120 mL)
    // Bounds: [-30, 30] in all axes
    const ventricle = box({ width: 60, height: 60, depth: 60, name: "VentricularChamber" });

    // Cannula placed at X = 50mm, width 10 (bounds [45, 55], distance to chamber boundary 45 - 30 = 15mm at V0)
    const cannula = translate(box({ width: 10, height: 10, depth: 10, name: "InflowCannula" }), [50, 0, 0]);

    const asm = assembly("NormalCardiacCycle", [part(ventricle), part(cannula)]);

    // Cardiac cycle trajectory: End-diastole (120mL) -> End-systole (60mL) -> Diastole (120mL)
    // When volume shrinks to 60mL, scale factor is (60/120)^(1/3) ~= 0.7937
    // Half-width shrinks from 30mm to 30 * 0.7937 ~= 23.81mm
    // Gap to cannula increases from 15mm to 45 - 23.81 = 21.19mm
    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0, // End-diastole
        states: { "heart.lv.V": { lo: 115.0, hi: 125.0 } },
        nominal: { "heart.lv.V": 120.0 },
      },
      {
        time: 0.35, // End-systole (ejection)
        states: { "heart.lv.V": { lo: 55.0, hi: 65.0 } },
        nominal: { "heart.lv.V": 60.0 },
      },
      {
        time: 0.8, // Next diastole
        states: { "heart.lv.V": { lo: 115.0, hi: 125.0 } },
        nominal: { "heart.lv.V": 120.0 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "VentricularChamber",
        deformation: {
          mode: "volume_radial",
          referenceVolume: 120.0,
          volume: "heart.lv.V",
        },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 10.0, // Minimum required clearance is 10mm
    });

    assert.strictEqual(report.isCertifiedSafe, true, "Should certify safe clearance across normal cardiac cycle");
    assert.strictEqual(report.violations.length, 0);
    // At t=0, distance is 45 - 30*(125/120)^(1/3) ~= 14.59mm, margin is 14.59 - 10 = 4.59mm > 4mm
    assert.ok(report.worstMargin > 4.0, `Expected margin > 4mm, got ${report.worstMargin}`);
  });

  it("should detect ventricular wall collapse / suction when hypovolemia or excessive speed collapses cavity", () => {
    // Apical myocardial wall: positioned at X = 25mm, width 10mm (bounds [20, 30])
    // Deformation anchor origin is at X = 30mm (epicardium/pericardium boundary)
    // As volume collapses, endocardium (X = 20mm) moves inward toward X = 15mm
    const apicalWall = translate(box({ width: 10, height: 20, depth: 20, name: "ApicalWall" }), [25, 0, 0]);
    // Cannula tip fixed at X = 15mm, width 2mm (bounds [14, 16])
    // Initial clearance at t=0: 20 - 16 = 4.0mm
    const cannulaTip = translate(box({ width: 2, height: 2, depth: 2, name: "CannulaTip" }), [15, 0, 0]);

    const asm = assembly("SuctionCollapseModel", [part(apicalWall), part(cannulaTip)]);

    // Suction trajectory: Severe hypovolemia causes wall to collapse inward
    // At t=0: scale is 1.0 (gap = 4.0mm)
    // At t=0.6: scale is 1.2 inward (dMin = 20 - 30 = -10; -10 * 1.2 = -12; newMin = 30 - 12 = 18; gap = 18 - 16 = 2.0mm)
    // At t=1.2: scale is 1.5 inward (newMin = 30 - 15 = 15; penetration with cannula [14, 16] = collision!)
    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { "wall.collapseScale": { lo: 1.0, hi: 1.0 } },
        nominal: { "wall.collapseScale": 1.0 },
      },
      {
        time: 0.6,
        states: { "wall.collapseScale": { lo: 1.15, hi: 1.25 } },
        nominal: { "wall.collapseScale": 1.2 },
      },
      {
        time: 1.2, // Catastrophic collapse
        states: { "wall.collapseScale": { lo: 1.45, hi: 1.55 } },
        nominal: { "wall.collapseScale": 1.5 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "ApicalWall",
        deformation: {
          mode: "anisotropic",
          anchorOrigin: [30, 0, 0], // Anchor at epicardial base
          scale: { x: "wall.collapseScale" },
        },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 1.5, // 1.5mm critical suction safety threshold
    });

    assert.strictEqual(report.isCertifiedSafe, false, "Must detect suction collision/violation");
    assert.ok(report.violations.length > 0, "Must record violation");
    assert.strictEqual(report.worstCaseTime, 1.2, "Collapse must be flagged at t=1.2s");
    assert.ok(report.counterexampleAssembly !== undefined, "Must synthesize counterexample assembly for 3D inspection");
    assert.ok(report.summary.includes("Dynamic clearance FALSIFIED"), "Summary must indicate falsification");
  });

  it("should evaluate anisotropic wall deformation and modal displacement", () => {
    const myocardialPatch = box({ width: 20, height: 20, depth: 20, name: "Myocardium" });
    const lead = translate(box({ width: 2, height: 2, depth: 2, name: "PacemakerLead" }), [15, 0, 0]);

    const asm = assembly("PacingLeadStrain", [part(myocardialPatch), part(lead)]);

    // Anisotropic scaling: Wall thickens along X by 30% (scale.x = 1.3) while Y and Z remain nominal
    // Initial X boundary is at X = 10mm; scaled by 1.3 it reaches X = 13mm
    // Gap to lead drops from 15 - 10 = 5mm down to 15 - 13 = 2mm
    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: {
          "strain.radialX": { lo: 1.0, hi: 1.0 },
          "mode.twist": { lo: 0.0, hi: 0.0 },
        },
        nominal: { "strain.radialX": 1.0, "mode.twist": 0.0 },
      },
      {
        time: 0.25, // Peak systolic contraction
        states: {
          "strain.radialX": { lo: 1.25, hi: 1.35 },
          "mode.twist": { lo: -0.5, hi: 0.5 },
        },
        nominal: { "strain.radialX": 1.3, "mode.twist": 0.0 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "Myocardium",
        deformation: {
          mode: "anisotropic",
          scale: { x: "strain.radialX" },
          modalWeights: { torsion: "mode.twist" },
        },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 3.0, // 3mm safety margin
    });

    assert.strictEqual(report.isCertifiedSafe, false, "Must detect that 2mm clearance violates 3mm requirement");
    assert.strictEqual(report.violations[0]?.status, "clearance_violation");
    assert.strictEqual(report.violations[0]?.time, 0.25);
  });
});
