// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CandidateFilter,
  CegarRefinementSynthesizer,
  ConstraintTheoryOracle,
  type DesignCandidate,
  type PhysicalRefutationWitness,
  SemanticTheoryCoordinator,
} from "../src/index.js";

describe("Phase 3: Multi-Fidelity Candidate Filter & CEGAR Refinement Engine", () => {
  it("should correctly partition design candidates into Pareto non-dominated fronts", () => {
    // 6 Candidates with objectives: mass (min) and drag (min)
    const candidates: DesignCandidate[] = [
      {
        id: "c1",
        name: "Lightweight",
        parameters: { r: 1.0 },
        objectives: { mass: 1.0, drag: 10.0 },
        tier1Passed: true,
        tier2Passed: true,
      },
      {
        id: "c2",
        name: "Aero",
        parameters: { r: 2.0 },
        objectives: { mass: 2.0, drag: 5.0 },
        tier1Passed: true,
        tier2Passed: true,
      },
      {
        id: "c3",
        name: "Balanced",
        parameters: { r: 1.5 },
        objectives: { mass: 1.5, drag: 7.0 },
        tier1Passed: true,
        tier2Passed: true,
      },
      {
        id: "c4",
        name: "Dominated1",
        parameters: { r: 0.8 },
        objectives: { mass: 2.5, drag: 12.0 },
        tier1Passed: true,
        tier2Passed: true,
      }, // Dominated by all
      {
        id: "c5",
        name: "Dominated2",
        parameters: { r: 1.2 },
        objectives: { mass: 1.6, drag: 8.0 },
        tier1Passed: true,
        tier2Passed: true,
      }, // Dominated by c3
      {
        id: "c6",
        name: "FailedTier1",
        parameters: { r: 0.5 },
        objectives: { mass: 0.5, drag: 2.0 },
        tier1Passed: false,
        tier2Passed: true,
      },
    ];

    const fronts = CandidateFilter.extractParetoFronts(candidates.filter((c) => c.tier1Passed && c.tier2Passed));

    assert.ok(fronts.length >= 2, "Should have at least 2 Pareto fronts");
    const rank1Ids = fronts[0]!.map((c) => c.id).sort();
    // c1, c2, c3 are non-dominated with each other
    assert.deepEqual(rank1Ids, ["c1", "c2", "c3"], "Rank 1 Pareto front should contain c1, c2, c3");

    // c5 is in front 2
    const rank2Ids = fronts[1]!.map((c) => c.id).sort();
    assert.ok(rank2Ids.includes("c5"), "Front 2 should contain c5");
  });

  it("should prune candidates down to diverse target count using crowding distance", () => {
    // Create 10 candidates along a trade-off curve between mass (min) and safetyMargin (max)
    const candidates: DesignCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      candidates.push({
        id: `cand_${i}`,
        name: `Design_${i}`,
        parameters: { thickness: 1.0 + i * 0.2 },
        objectives: {
          mass: 1.0 + i * 0.3, // 1.0 to 3.7 (min)
          safetyMargin: 0.05 + i * 0.05, // 0.05 to 0.50 (max)
        },
        tier1Passed: true,
        tier2Passed: true,
      });
    }

    const pruned = CandidateFilter.pruneToCandidates(candidates, {
      targetCount: 3,
      directions: { mass: "min", safetyMargin: "max" },
    });

    assert.equal(pruned.length, 3, "Should prune down to exactly 3 final candidates");
    // Boundary candidates should have Infinite crowding distance and be selected
    const selectedIds = pruned.map((c) => c.id);
    assert.ok(selectedIds.includes("cand_0"), "Minimum mass extreme boundary should be preserved");
    assert.ok(selectedIds.includes("cand_9"), "Maximum safety margin extreme boundary should be preserved");
  });

  it("should synthesize CEGAR refinement hyperplanes and tighten coordinator bounds upon physical failure", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Initial exploratory parameter bound: filletRadius in [0.5, 5.0]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["filletRadius", 0.5, 5.0],
      domain: "constraint",
    });

    assert.equal(coordinator.checkSat().isSat, true, "Initial design space is SAT");

    // Simulate Tier-3 FEA physical failure witness:
    // Actual stress = 582 MPa, allowable threshold = 553 MPa (exceeded by 29 MPa)
    // Sensitivity gradient dSigma / dR = -20 MPa/mm
    const witness: PhysicalRefutationWitness = {
      candidateId: "cand_1",
      failedProperty: "vonMisesStress",
      actualValue: 582.0,
      thresholdValue: 553.0,
      parameters: { filletRadius: 1.2 },
      sensitivityGradients: { filletRadius: -20.0 },
    };

    // Synthesize CEGAR refinement invariant
    const refinement = CegarRefinementSynthesizer.synthesizeRefinement(witness);

    // Required delta = 29 / 20 = 1.45 mm => new filletRadius >= 1.2 + 1.45 = 2.65 mm
    assert.ok(refinement.suggestedBounds.filletRadius, "Must suggest bound for filletRadius");
    assert.equal(refinement.suggestedBounds.filletRadius.min, 2.65);
    assert.match(refinement.explanation, /filletRadius >= 2.65/);

    // Feed refinement invariant back into the coordinator
    CegarRefinementSynthesizer.applyRefinementToCoordinator(coordinator, refinement);

    // The coordinator's feasible space is now tightened: filletRadius in [2.65, 5.0]
    const updatedInt = constraints.getInterval("filletRadius");
    assert.ok(updatedInt);
    assert.equal(updatedInt!.lo, 2.65, "Lower bound must be tightened to 2.65 via CEGAR refinement");

    // An exploratory candidate proposing filletRadius = 1.8 mm must now be immediately refuted!
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["filletRadius", "<=", 1.8],
      domain: "constraint",
    });

    const refutedRes = coordinator.checkSat();
    assert.equal(refutedRes.isSat, false, "Candidate violating CEGAR refinement bound is immediately UNSAT");
    coordinator.popLevel();

    // While a candidate proposing filletRadius = 3.0 mm remains SAT
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["filletRadius", "==", 3.0],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true, "Candidate meeting CEGAR refinement bound is SAT");
    coordinator.popLevel();
  });
});
