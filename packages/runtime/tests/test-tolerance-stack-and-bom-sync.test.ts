// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  BomSyncManager,
  DigitalThreadHypergraph,
  SemanticTheoryCoordinator,
  ThreadDomain,
  ToleranceStackOracle,
  type ToleranceChainSpec,
} from "../src/index.js";

describe("Phase 2: Manufacturing & Quality (GD&T Tolerance Stacks & BOM Cost/Carbon)", () => {
  describe("ToleranceStackOracle & STEP AP242 Semantic GD&T", () => {
    it("computes Worst-Case and RSS tolerance stack-up for precision pin-in-bushing assembly", () => {
      const oracle = new ToleranceStackOracle();

      // Piston Pin in Rod Bushing:
      // Gap = Bushing_ID (direction: +1) - Pin_OD (direction: -1)
      const pinChain: ToleranceChainSpec = {
        chainId: "piston_pin_clearance",
        name: "Piston Pin to Rod Bushing Radial Clearance",
        contributors: [
          {
            partId: "RodBushing",
            featureName: "inner_diameter",
            direction: 1,
            nominal: 22.05,
            tolerance: 0.015, // 22.050 ± 0.015 mm
            cpk: 1.33,
          },
          {
            partId: "PistonPin",
            featureName: "outer_diameter",
            direction: -1,
            nominal: 22.0,
            tolerance: 0.01, // 22.000 ± 0.010 mm
            cpk: 1.5,
          },
        ],
        targetClearance: {
          min: 0.02, // 20 microns min clearance (hydrodynamic oil film)
          max: 0.085, // 85 microns max clearance (prevent rod knock)
          name: "oil_film_clearance",
        },
        method: "worst_case",
      };

      // 1. Worst Case evaluation
      const resWc = oracle.calculateChain(pinChain);
      assert.strictEqual(resWc.nominalClearance, 0.05); // 22.05 - 22.00 = 0.05 mm
      assert.strictEqual(resWc.variation, 0.025); // 0.015 + 0.010 = 0.025 mm
      assert.strictEqual(resWc.minClearance, 0.025); // 0.050 - 0.025 = 0.025 mm
      assert.strictEqual(resWc.maxClearance, 0.075); // 0.050 + 0.025 = 0.075 mm
      assert.strictEqual(resWc.isSatisfied, true);
      assert.strictEqual(resWc.topContributors[0].partId, "RodBushing");
      assert.strictEqual(resWc.topContributors[0].percentContribution, 60);

      // 2. RSS (Root Sum Square) statistical evaluation
      const resRss = oracle.calculateChain({ ...pinChain, method: "rss" });
      const expectedRssVar = Math.sqrt(0.015 * 0.015 + 0.01 * 0.01); // ~0.018027 mm
      assert.ok(Math.abs(resRss.variation - expectedRssVar) < 1e-6);
      assert.ok(resRss.minClearance > resWc.minClearance); // Statistical bounds tighter than WC
      assert.strictEqual(resRss.isSatisfied, true);

      // 3. Six-Sigma evaluation with Cpk
      const resSixSigma = oracle.calculateChain({ ...pinChain, method: "six_sigma" });
      assert.ok(resSixSigma.variation > 0);
      assert.strictEqual(resSixSigma.isSatisfied, true);
    });

    it("detects mechanical interference conflict when tolerances stack up unfavorably", () => {
      const coordinator = new SemanticTheoryCoordinator();
      const oracle = new ToleranceStackOracle();
      coordinator.registerOracle(oracle);

      // Loose tolerances causing interference under worst-case:
      const tightFittingAssembly: ToleranceChainSpec = {
        chainId: "rotor_stator_airgap",
        name: "Electric Motor Rotor-Stator Airgap",
        contributors: [
          {
            partId: "StatorBore",
            featureName: "bore_radius",
            direction: 1,
            nominal: 50.1,
            tolerance: 0.08, // Stator bore variation
          },
          {
            partId: "RotorOD",
            featureName: "outer_radius",
            direction: -1,
            nominal: 50.0,
            tolerance: 0.06, // Rotor OD variation
          },
        ],
        targetClearance: {
          min: 0.02, // Minimum 0.02 mm airgap required to prevent rotor scraping
          max: 0.3,
        },
        method: "worst_case",
      };

      // Assert literal into Theory Coordinator
      coordinator.assertLiteral({
        predicate: "toleranceChain",
        args: [tightFittingAssembly],
        domain: "spatial_physics",
      });

      // Nominal = 0.10, Variation = 0.08 + 0.06 = 0.14 mm
      // Min Clearance = 0.10 - 0.14 = -0.04 mm (Interference!)
      const checkRes = coordinator.checkSat();
      assert.strictEqual(checkRes.isSat, false);
      assert.ok(checkRes.conflict);
      assert.ok(checkRes.conflict?.explanation.includes("Tolerance Stack Interference"));
      assert.ok(checkRes.conflict?.culpritEntities.includes("StatorBore"));
    });

    it("propagates clearance interval equalities across Nelson-Oppen theory coordinator", () => {
      const coordinator = new SemanticTheoryCoordinator();
      const oracle = new ToleranceStackOracle();
      coordinator.registerOracle(oracle);

      const shaftChain: ToleranceChainSpec = {
        chainId: "shaft_housing",
        name: "Shaft to Housing",
        contributors: [
          { partId: "Housing", featureName: "bore", direction: 1, nominal: 30.04, tolerance: 0.01 },
          { partId: "Shaft", featureName: "journal", direction: -1, nominal: 30.0, tolerance: 0.01 },
        ],
        targetClearance: { min: 0.01, max: 0.07 },
        method: "worst_case",
      };

      coordinator.assertLiteral({
        predicate: "toleranceChain",
        args: [shaftChain],
        domain: "spatial_physics",
      });

      const eqList = oracle.propagateEqualities();
      assert.strictEqual(eqList.length, 1);
      assert.strictEqual(eqList[0].varA, "clearance_shaft_housing");
      assert.deepStrictEqual(eqList[0].bounds, [0.02, 0.06]); // 0.04 ± 0.02
    });
  });

  describe("BomSyncManager & Embodied Carbon Tracking", () => {
    it("synchronizes eBOM to mBOM with mass, procurement cost, and embodied carbon LCA", () => {
      const bom = new BomSyncManager();

      // Register Drone Frame Subsystem parts
      bom.registerItem({
        id: "PART-ARM-01",
        sysmlPart: "DroneSystem::StructuralArm",
        description: "Quadcopter Motor Arm",
        quantity: 4,
        material: "ALUMINUM_6061",
        volumeM3: 0.0001, // 100 cm3
        massKg: 0.27, // 0.0001 * 2700 = 0.27 kg each
        process: "cnc_machining",
      });

      bom.registerItem({
        id: "PART-BASE-01",
        sysmlPart: "DroneSystem::CentralChassis",
        description: "Center Hub Plate",
        quantity: 1,
        material: "CARBON_FIBER_CFRP",
        volumeM3: 0.0003, // 300 cm3
        massKg: 0.465, // 0.0003 * 1550 = 0.465 kg
        process: "additive_3d",
      });

      const summary = bom.getSummary();
      // Total Mass: 4 * 0.27 + 1 * 0.465 = 1.08 + 0.465 = 1.545 kg
      assert.strictEqual(summary.totalMassKg, 1.545);
      assert.strictEqual(summary.itemCount, 2);
      assert.ok(summary.totalCostUsd > 0);
      assert.ok(summary.totalEmbodiedCarbonKgCo2e > 0);

      // Verify individual arm calculation:
      const arm = bom.getItem("PART-ARM-01")!;
      assert.ok(arm.unitCostUsd && arm.unitCostUsd > 0);
      assert.ok(arm.embodiedCarbonKgCo2e && arm.embodiedCarbonKgCo2e > 0);
    });

    it("evaluates live cost, carbon, and mass deltas upon material substitution", () => {
      const bom = new BomSyncManager();

      bom.registerItem({
        id: "BRACKET-01",
        sysmlPart: "AvionicsBracket",
        description: "Avionics Mounting Bracket",
        quantity: 2,
        material: "ALUMINUM_6061",
        volumeM3: 0.00008, // 80 cm3
        massKg: 0.216,
        process: "cnc_machining",
      });

      const summaryBefore = bom.getSummary();

      // Switch material from Aluminum to Titanium Grade 5
      const deltas = bom.updateItemMaterial("BRACKET-01", "TITANIUM_TI6AL4V");

      // Titanium is denser (4430 vs 2700) and much more expensive ($48/kg vs $4.8/kg) and higher carbon (36.5 vs 8.9)
      assert.ok(deltas.deltaCost > 0, "Titanium should increase cost");
      assert.ok(deltas.deltaCarbon > 0, "Titanium should increase embodied carbon footprint");
      assert.ok(deltas.deltaMass > 0, "Titanium bracket should increase mass");

      const summaryAfter = bom.getSummary();
      assert.ok(summaryAfter.totalCostUsd > summaryBefore.totalCostUsd);
      assert.ok(summaryAfter.totalEmbodiedCarbonKgCo2e > summaryBefore.totalEmbodiedCarbonKgCo2e);
    });

    it("federates BOM items into DigitalThreadHypergraph across BOM, Manufacturing, and Cost domains", () => {
      const hg = new DigitalThreadHypergraph(64);
      const bom = new BomSyncManager();

      bom.registerItem({
        id: "ACTUATOR-BODY",
        sysmlPart: "HydraulicActuator::CylinderBody",
        description: "Actuator Outer Barrel",
        quantity: 1,
        material: "STEEL_316L",
        massKg: 1.8,
        process: "cnc_machining",
      });

      bom.bindToHypergraph(hg, 85000);
      assert.strictEqual(hg.getThreadCount(), 1);

      const slot = hg.findSlotByThreadId(85000);
      assert.notStrictEqual(slot, undefined);

      const rec = hg.getRecord(slot!);
      assert.ok(rec);
      assert.ok(rec.domainNodes[ThreadDomain.SysML2]);
      assert.ok(rec.domainNodes[ThreadDomain.BOM]);
      assert.ok(rec.domainNodes[ThreadDomain.Manufacturing]);
      assert.ok(rec.domainNodes[ThreadDomain.CostCarbon]);
    });
  });
});
