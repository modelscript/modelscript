// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AbstractDomainOracle,
  CandidateFilter,
  CegarRefinementSynthesizer,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  EntailmentTheoryOracle,
  FlowAlgebraOracle,
  OntologyTheoryOracle,
  SemanticTheoryCoordinator,
  UqTheoryOracle,
  type DesignCandidate,
} from "../src/index.js";

describe("Phase 5: End-to-End Multi-Physics Verification Funnel & CEGAR Integration", () => {
  it("should execute full multi-physics verification pipeline for Aerospace Flight Actuator", () => {
    const tStart = performance.now();

    // 1. Initialize Semantic Theory Coordinator with All Oracles
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const constraints = new ConstraintTheoryOracle();
    const abstractDomain = new AbstractDomainOracle();
    const dimensions = new DimensionalTheoryOracle();
    const flowAlgebra = new FlowAlgebraOracle();
    const uq = new UqTheoryOracle();
    const entailment = new EntailmentTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(constraints);
    coordinator.registerOracle(abstractDomain);
    coordinator.registerOracle(dimensions);
    coordinator.registerOracle(flowAlgebra);
    coordinator.registerOracle(uq);
    coordinator.registerOracle(entailment);

    // 2. Tier 1: Assert Architectural & Ontological Constraints
    // Bundle closure for Actuator Subsystems
    coordinator.assertLiteral({
      predicate: "bundleClosure",
      args: ["ActuatorPkg", ["HydraulicActuator", "ElectromechanicalActuator", "PneumaticActuator"]],
      domain: "ontology",
    });

    coordinator.assertLiteral({
      predicate: "type",
      args: ["flightActuator1", "HydraulicActuator"],
      domain: "ontology",
    });

    // ISO 80000 Dimensionality: Piston Force F = Pressure P * Area A
    coordinator.assertLiteral({ predicate: "dimension", args: ["P_supply", "Pa"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "dimension", args: ["A_piston", "m"], domain: "constraint" });
    // In our simplified test: Area is length^2 => let's assert dimension of force directly
    coordinator.assertLiteral({ predicate: "dimension", args: ["F_output", "N"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "dimension", args: ["F_req", "N"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "equal", args: ["F_output", "F_req"], domain: "constraint" });

    // Conjugated Port Flow Algebra: Hydraulic supply connects to ~ActuatorPort
    coordinator.assertLiteral({
      predicate: "portType",
      args: [
        "HydraulicPort",
        [
          { name: "pressure", direction: "inout", isFlow: false },
          { name: "flowRate", direction: "out", isFlow: true },
        ],
      ],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "portUsage",
      args: ["manifoldPort", "HydraulicPort", false],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "portUsage",
      args: ["cylinderPort", "HydraulicPort", true], // Conjugated
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "connect",
      args: ["manifoldPort", "cylinderPort"],
      domain: "constraint",
    });

    // Requirements Entailment: Parent Actuator Load <= 50 kN, Sub-system <= 45 kN
    coordinator.assertLiteral({
      predicate: "requirement",
      args: ["Req_Actuator_Load", "load_kN", "<=", 50],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "requirement",
      args: ["Req_Cylinder_Load", "load_kN", "<=", 45],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "entailment",
      args: ["Req_Actuator_Load", ["Req_Cylinder_Load"]],
      domain: "constraint",
    });

    // Check Tier 1 & 2 Satisfiability Gate
    const gateRes = coordinator.checkSat();
    assert.equal(gateRes.isSat, true, "Tier 1 & 2 multi-theory gate should pass");
    assert.ok(performance.now() - tStart < 100, "Tier 1 & 2 gate should execute in < 100 ms");

    // 3. Tier 2: Pareto Candidate Extraction from 50 Design Space Variants
    const variants: DesignCandidate[] = [];
    for (let i = 0; i < 50; i++) {
      const r = 1.0 + (i % 10) * 0.3;
      const t = 2.0 + Math.floor(i / 10) * 0.5;
      variants.push({
        id: `variant_${i}`,
        name: `Actuator_r${r.toFixed(1)}_t${t.toFixed(1)}`,
        parameters: { filletRadius: r, wallThickness: t },
        objectives: {
          mass: 1.2 + t * 0.4 - r * 0.05,
          drag: 15.0 - t * 0.2 - r * 0.8,
          stress: 600.0 - r * 35.0 - t * 40.0,
        },
        tier1Passed: true,
        tier2Passed: true,
      });
    }

    // Prune down to top 3 diverse Pareto non-dominated candidates
    const shortlisted = CandidateFilter.pruneToCandidates(variants, {
      targetCount: 3,
      directions: { mass: "min", drag: "min", stress: "min" },
    });

    assert.equal(shortlisted.length, 3, "Pruned pool must contain exactly 3 shortlisted candidates");

    // 4. Tier 3 Confirmation & CEGAR Feedback
    // Candidate #1 has filletRadius = 1.0, wallThickness = 2.0
    // Yield stress threshold is 520 MPa, but local 3D FEA stress concentration reaches 565 MPa (+45 MPa breach)
    const testCandidate = shortlisted[0]!;
    const failureWitness = {
      candidateId: testCandidate.id,
      failedProperty: "vonMisesStress",
      actualValue: 565.0,
      thresholdValue: 520.0,
      parameters: { filletRadius: 1.0, wallThickness: 2.0 },
      sensitivityGradients: { filletRadius: -30.0, wallThickness: -40.0 },
    };

    // Synthesize CEGAR refinement invariant
    const refinement = CegarRefinementSynthesizer.synthesizeRefinement(failureWitness);
    assert.ok(refinement.suggestedBounds.filletRadius);
    // Delta = 45 MPa, sensitivity = -30 => required increase = 45 / 30 = 1.5 mm => filletRadius >= 2.5 mm
    assert.equal(refinement.suggestedBounds.filletRadius.min, 2.5);

    // Apply CEGAR invariant into Coordinator
    CegarRefinementSynthesizer.applyRefinementToCoordinator(coordinator, refinement);

    // Verify candidate with r < 2.5 is now refuted
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["filletRadius", "<=", 2.0],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, false, "CEGAR refinement invariant must refute defective variant");
    coordinator.popLevel();

    // Verify candidate with r = 2.8 is certified
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["filletRadius", "==", 2.8],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true, "Refined design candidate is certified compliant");

    // Verify Proof Manifest generated
    const manifests = entailment.getCertifiedManifests();
    assert.ok(manifests.length >= 1, "Proof manifest trail must be certified");
    coordinator.popLevel();
  });
});
