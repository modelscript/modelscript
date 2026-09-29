// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BlastRadiusRegressionRunner,
  DigitalThreadHypergraph,
  ShapeRefitEngine,
  ThreadDomain,
  ThreadRelation,
  TradeStudyEngine,
} from "../src/index.js";

describe("Phase 5: Active Digital Thread (Optimization Writeback, Branching, Trade Studies & CI/CD)", () => {
  describe("TradeStudyEngine & Multi-Disciplinary Pareto Front Exploration", () => {
    it("computes non-dominated Pareto front, crowding distance, and knee point", () => {
      const engine = new TradeStudyEngine("StructuralBracketTradeStudy", [
        { name: "mass_kg", sense: "minimize", unit: "kg", weight: 1.0 },
        { name: "cost_usd", sense: "minimize", unit: "$", weight: 1.0 },
        { name: "stress_mpa", sense: "minimize", unit: "MPa", weight: 1.0 },
      ]);

      // 6 design candidate variants with distinct trade-offs:
      // Cand 1: Ultra-light carbon fiber, high cost, low stress
      engine.addCandidate({
        id: "variant_cf_01",
        name: "Carbon Fiber Epoxy",
        parameters: { material: "CFRP", wall_thickness: 2.5 },
        objectives: { mass_kg: 1.2, cost_usd: 150.0, stress_mpa: 180.0 },
      });

      // Cand 2: Standard structural steel, heavy, cheap, medium stress
      engine.addCandidate({
        id: "variant_steel_01",
        name: "Mild Steel A36",
        parameters: { material: "Steel", wall_thickness: 3.5 },
        objectives: { mass_kg: 4.8, cost_usd: 25.0, stress_mpa: 210.0 },
      });

      // Cand 3: Aerospace Aluminum 7075-T6 (balanced)
      engine.addCandidate({
        id: "variant_al_01",
        name: "Aluminum 7075-T6",
        parameters: { material: "Al7075", wall_thickness: 3.0 },
        objectives: { mass_kg: 2.1, cost_usd: 55.0, stress_mpa: 195.0 },
      });

      // Cand 4: Dominated poor design (heavier AND more expensive than Cand 3)
      engine.addCandidate({
        id: "variant_dominated_01",
        name: "Cast Iron Heavy",
        parameters: { material: "CastIron", wall_thickness: 5.0 },
        objectives: { mass_kg: 6.5, cost_usd: 80.0, stress_mpa: 280.0 },
      });

      // Cand 5: Titanium alloy Ti-6Al-4V (extremely light, very high cost)
      engine.addCandidate({
        id: "variant_ti_01",
        name: "Titanium Ti-6Al-4V",
        parameters: { material: "Ti6Al4V", wall_thickness: 2.2 },
        objectives: { mass_kg: 1.5, cost_usd: 220.0, stress_mpa: 160.0 },
      });

      const res = engine.evaluate();

      assert.equal(res.totalCandidates, 5);
      assert.ok(res.paretoFront.length >= 3, "Pareto front should contain at least 3 non-dominated points");

      // Verify dominated design is NOT on Pareto front (rank > 0)
      const domPoint = res.allRankedCandidates.find((c) => c.id === "variant_dominated_01")!;
      assert.ok(domPoint.rank > 0, "Dominated candidate must have rank > 0");

      // Verify knee point is identified
      assert.ok(res.kneePoint, "A knee point must be selected");
      assert.equal(res.kneePoint.isKneePoint, true);
      // Balanced Aluminum or Carbon should be knee point
      assert.ok(
        res.kneePoint.id === "variant_al_01" || res.kneePoint.id === "variant_cf_01",
        `Expected Al or CF knee point, got ${res.kneePoint.id}`,
      );

      // Verify variant branch creation in hypergraph
      const hypergraph = new DigitalThreadHypergraph();
      const parentBranch = 0;
      const branches = engine.federateToHypergraph(hypergraph, parentBranch);

      assert.ok(branches.size >= 3);
      for (const [, branchId] of branches) {
        assert.ok(branchId > 0, "Variant branches should be positive integers");
      }
    });
  });

  describe("ShapeRefitEngine & Geometric Writeback", () => {
    it("fits analytic cylinder and wall thickness to morphed mesh and generates writeback patches", () => {
      // 1. Generate synthetic morphed circle points on XY plane
      // True center = [15.0, 25.0], True radius = 8.45 mm
      const trueR = 8.45;
      const trueCenter = [15.0, 25.0];
      const points: { x: number; y: number; z: number }[] = [];

      for (let i = 0; i < 36; i++) {
        const theta = (i / 36) * 2 * Math.PI;
        // Minor perturbation from FEA mesh nodes (+/- 0.02 mm)
        const dr = 0.02 * Math.sin(5 * theta);
        const r = trueR + dr;
        points.push({
          x: trueCenter[0]! + r * Math.cos(theta),
          y: trueCenter[1]! + r * Math.sin(theta),
          z: 0.0,
        });
      }

      const cylFit = ShapeRefitEngine.fitCylinderRadius(points, 8.0, "XY");
      assert.ok(Math.abs(cylFit.radius - trueR) < 0.05, `Fitted radius ${cylFit.radius} should be near ${trueR}`);
      assert.ok(Math.abs(cylFit.center[0] - trueCenter[0]!) < 0.1);
      assert.ok(Math.abs(cylFit.center[1] - trueCenter[1]!) < 0.1);
      assert.ok(cylFit.residualRms < 0.05);

      // 2. Fit wall thickness from point pairs
      const innerPts = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ];
      const outerPts = [
        { x: 3.25, y: 0, z: 0 },
        { x: 13.25, y: 0, z: 0 },
      ];
      const thickFit = ShapeRefitEngine.fitWallThickness(innerPts, outerPts, 3.0);
      assert.equal(thickFit.fittedThickness, 3.25);
      assert.equal(thickFit.deltaThickness, 0.25);

      // 3. Generate writeback patch
      const patch = ShapeRefitEngine.generateWritebackPatch("pin_hole_radius", 8.0, cylFit.radius, {
        targetFile: "models/suspension_arm.scad",
        unit: "mm",
        sourceDomain: "FEA_TopologyOptimization",
      });

      assert.equal(patch.parameterName, "pin_hole_radius");
      assert.equal(patch.nominalValue, 8.0);
      assert.equal(patch.optimizedValue, cylFit.radius);
      assert.ok(patch.openScadPatch.replacementLine.includes("pin_hole_radius ="));
      assert.ok(patch.openScadPatch.replacementLine.includes("Optimized by ModelScript"));
      assert.ok(patch.sysml2Patch.attributeDef.includes("attribute def pin_hole_radius"));
      assert.ok(patch.provenanceActivity.activityId.startsWith("act_refit_"));
    });
  });

  describe("BlastRadiusRegressionRunner & CI/CD", () => {
    it("computes minimal selective verification plan from git changeset", () => {
      const runner = new BlastRadiusRegressionRunner();
      const hypergraph = new DigitalThreadHypergraph();

      // Setup digital thread slots:
      // Slot 1: SysML Req (101) -> CAD Geometry (201) -> FEA Model (301)
      const slot1 = hypergraph.createThread(1, 0, ThreadRelation.DerivesFrom);
      hypergraph.bindDomainNode(slot1, ThreadDomain.SysML2, 101);
      hypergraph.bindDomainNode(slot1, ThreadDomain.CAD, 201);
      hypergraph.bindDomainNode(slot1, ThreadDomain.FEA, 301);

      // Slot 2: CAD Geometry (201) -> Modelica 1D (401)
      const slot2 = hypergraph.createThread(2, 0, ThreadRelation.Aligned);
      hypergraph.bindDomainNode(slot2, ThreadDomain.CAD, 201);
      hypergraph.bindDomainNode(slot2, ThreadDomain.Modelica, 401);

      // Slot 3: Unrelated CFD Airfoil (501)
      const slot3 = hypergraph.createThread(3, 0, ThreadRelation.Aligned);
      hypergraph.bindDomainNode(slot3, ThreadDomain.CFD, 501);

      // Register file mappings
      runner.registerMapping("cad/bracket.scad", ThreadDomain.CAD, 201, "StructuralBracketCAD");

      // Simulate a git changeset that only modified bracket.scad
      const plan = runner.plan(hypergraph, [{ path: "cad/bracket.scad", changeType: "modified" }]);

      assert.equal(plan.changedFiles.length, 1);
      assert.equal(plan.affectedRootNodes.length, 1);
      assert.equal(plan.affectedRootNodes[0]!.domain, ThreadDomain.CAD);

      // Stale slots must include slot 1 and slot 2 (downstream FEA and Modelica), but NOT slot 3 (CFD)
      assert.ok(plan.staleThreadSlots.includes(slot1));
      assert.ok(plan.staleThreadSlots.includes(slot2));
      assert.ok(!plan.staleThreadSlots.includes(slot3), "CFD slot should not be stale!");

      // Scheduled jobs should contain FEA and Modelica, but NOT CFD!
      const scheduledDomains = plan.scheduledJobs.map((j) => j.domain);
      assert.ok(scheduledDomains.includes(ThreadDomain.FEA), "FEA must be scheduled");
      assert.ok(scheduledDomains.includes(ThreadDomain.Modelica), "Modelica must be scheduled");
      assert.ok(!scheduledDomains.includes(ThreadDomain.CFD), "CFD must be skipped");

      assert.ok(plan.skippedJobsCount > 0);
      assert.ok(plan.estimatedComputeSavedSec >= 600, "Should save at least 600s compute by skipping CFD");
    });
  });
});
