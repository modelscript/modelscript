// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AbstractDomainOracle,
  CausalizationTheoryOracle,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  EntailmentTheoryOracle,
  FlowAlgebraOracle,
  OntologyTheoryOracle,
  SemanticTheoryCoordinator,
  UqTheoryOracle,
} from "../src/index.js";

describe("Phase 1: Semantic Theory Coordinator & Base Oracles", () => {
  it("should detect ontological disjointness conflicts in OntologyTheoryOracle", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    coordinator.registerOracle(ontology);

    // Classes: Taxiing and Flying are disjoint
    coordinator.assertLiteral({
      predicate: "disjoint",
      args: ["Taxiing", "Flying"],
      domain: "ontology",
    });

    // Subclassing: HighSpeedTaxiing is a subclass of Taxiing
    coordinator.assertLiteral({
      predicate: "subClassOf",
      args: ["HighSpeedTaxiing", "Taxiing"],
      domain: "ontology",
    });

    // Individual flight1 is HighSpeedTaxiing (thus Taxiing)
    coordinator.assertLiteral({
      predicate: "type",
      args: ["flight1", "HighSpeedTaxiing"],
      domain: "ontology",
    });

    // Check SAT before conflict
    const satRes = coordinator.checkSat();
    assert.equal(satRes.isSat, true, "Model should be SAT before conflict assertion");

    // Assert that flight1 is also Flying
    coordinator.assertLiteral({
      predicate: "type",
      args: ["flight1", "Flying"],
      domain: "ontology",
    });

    // Check SAT after disjoint types asserted
    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false, "Model should be UNSAT due to disjoint types");
    assert.ok(unsatRes.conflict, "Conflict clause should be present");
    assert.match(unsatRes.conflict.explanation, /Ontological Conflict/);
    assert.ok(unsatRes.conflict.culpritEntities.includes("flight1"));
  });

  it("should automatically enforce scoped bundle closure for unlinked sibling concepts", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    coordinator.registerOracle(ontology);

    // Bundle with siblings: Battery, FuelCell, SolarPanel
    coordinator.assertLiteral({
      predicate: "bundleClosure",
      args: ["PowerPackage", ["Battery", "FuelCell", "SolarPanel"]],
      domain: "ontology",
    });

    // individual pow1 is Battery
    coordinator.assertLiteral({
      predicate: "type",
      args: ["pow1", "Battery"],
      domain: "ontology",
    });

    // asserting pow1 is also SolarPanel violates automatically synthesized bundle closure disjointness
    coordinator.assertLiteral({
      predicate: "type",
      args: ["pow1", "SolarPanel"],
      domain: "ontology",
    });

    const res = coordinator.checkSat();
    assert.equal(res.isSat, false, "Bundle closure should enforce disjointness between Battery and SolarPanel");
    assert.ok(unsatEntities(res.conflict?.culpritEntities, ["Battery", "SolarPanel"]));
  });

  it("should detect arithmetic interval contradictions in ConstraintTheoryOracle", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Thrust >= 500 N
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["thrust", ">=", 500],
      domain: "constraint",
    });

    // Thrust <= 400 N
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["thrust", "<=", 400],
      domain: "constraint",
    });

    const res = coordinator.checkSat();
    assert.equal(res.isSat, false, "Contradictory bounds [500, 400] should trigger UNSAT");
    assert.match(res.conflict?.explanation || "", /Arithmetic Bound Conflict/);
    assert.ok(res.conflict?.culpritEntities.includes("thrust"));
  });

  it("should detect temporal negative cycles in AbstractDomainOracle (Octagon DBM)", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const octagon = new AbstractDomainOracle();
    coordinator.registerOracle(octagon);

    // Event B happens at least 10s after Event A: t_B - t_A >= 10
    coordinator.assertLiteral({
      predicate: "time_succession",
      args: ["EventA", "EventB", 10, 20],
      domain: "abstract_domain",
    });

    // Event C happens at least 5s after Event B: t_C - t_B >= 5
    coordinator.assertLiteral({
      predicate: "time_succession",
      args: ["EventB", "EventC", 5, 10],
      domain: "abstract_domain",
    });

    // Contradiction: Event A must happen at least 2s after Event C: t_A - t_C >= 2
    // Loop: t_C - t_A >= 15, but t_A - t_C >= 2 implies (t_C - t_A) + (t_A - t_C) >= 17 > 0 (negative cycle)
    coordinator.assertLiteral({
      predicate: "time_succession",
      args: ["EventC", "EventA", 2, 5],
      domain: "abstract_domain",
    });

    const res = coordinator.checkSat();
    assert.equal(res.isSat, false, "Cyclic temporal succession should produce negative cycle UNSAT");
    assert.match(res.conflict?.explanation || "", /Temporal Succession Conflict/);
  });

  it("should coordinate Nelson-Oppen equality sharing across Ontology and Constraint oracles", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const constraints = new ConstraintTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(constraints);

    // Ontology asserts that moduleA and moduleB represent the exact same component
    coordinator.assertLiteral({
      predicate: "sameIndividual",
      args: ["moduleA", "moduleB"],
      domain: "ontology",
    });

    // Constraint asserts bounds on moduleA: mass in [10, 15]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["moduleA", 10, 15],
      domain: "constraint",
    });

    // Constraint asserts bounds on moduleB: mass in [12, 20]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["moduleB", 12, 20],
      domain: "constraint",
    });

    // Run Nelson-Oppen coordinator
    const satRes = coordinator.checkSat();
    assert.equal(satRes.isSat, true, "Combined system should be SAT");

    // The equality sharing must have tightened both moduleA and moduleB to [12, 15]
    const intA = constraints.getInterval("moduleA");
    assert.ok(intA, "Interval for moduleA must exist");
    assert.equal(intA!.lo, 12, "moduleA lower bound should be tightened to 12 via equality sharing");
    assert.equal(intA!.hi, 15, "moduleA upper bound should be tightened to 15 via equality sharing");

    // Now introduce cross-theory conflict: moduleB must be >= 25
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["moduleB", ">=", 25],
      domain: "constraint",
    });

    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false, "Combined system should be UNSAT due to cross-theory bound conflict");
  });

  it("should support backtracking push/pop levels", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Base level: mass in [10, 100]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["mass", 10, 100],
      domain: "constraint",
    });

    assert.equal(coordinator.checkSat().isSat, true);

    // Push decision level 1: assert conflicting bound mass >= 200
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["mass", ">=", 200],
      domain: "constraint",
    });

    assert.equal(coordinator.checkSat().isSat, false, "Should be UNSAT at decision level 1");

    // Pop decision level 1: conflict should be undone
    coordinator.popLevel();
    const restoredRes = coordinator.checkSat();
    assert.equal(restoredRes.isSat, true, "Should be restored to SAT after popLevel()");
    const restoredInt = constraints.getInterval("mass");
    assert.equal(restoredInt?.lo, 10);
    assert.equal(restoredInt?.hi, 100);
  });

  it("should enforce ISO 80000 dimensional homogeneity and catch physical dimension mismatches", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const dimOracle = new DimensionalTheoryOracle();
    coordinator.registerOracle(dimOracle);

    // F = m * a
    coordinator.assertLiteral({ predicate: "dimension", args: ["m", "kg"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "dimension", args: ["a", "m/s2"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "dimensionMult", args: ["F_calc", "m", "a"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "dimension", args: ["F_req", "N"], domain: "constraint" });

    // F_calc == F_req should be dimensionally consistent
    coordinator.assertLiteral({ predicate: "equal", args: ["F_calc", "F_req"], domain: "constraint" });
    assert.equal(coordinator.checkSat().isSat, true, "F = m * a should match dimension of Newton (N)");

    // Contradiction: attempt to equate Force with Power (Watt)
    coordinator.assertLiteral({ predicate: "dimension", args: ["P_motor", "W"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "equal", args: ["F_req", "P_motor"], domain: "constraint" });

    const unsat = coordinator.checkSat();
    assert.equal(unsat.isSat, false, "Equating Force (N) with Power (W) should trigger dimensional conflict");
    assert.match(unsat.conflict?.explanation || "", /Dimensional Inconsistency \(ISO 80000\)/);
  });

  it("should enforce conjugated port flow algebra and catch opposing flow directions", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const flowOracle = new FlowAlgebraOracle();
    coordinator.registerOracle(flowOracle);

    // Port definition: HydraulicPort with pressure (potential) and flowRate (flow)
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

    // Pump output port (standard HydraulicPort: flowRate is 'out')
    coordinator.assertLiteral({
      predicate: "portUsage",
      args: ["pumpOut", "HydraulicPort", false],
      domain: "constraint",
    });

    // Actuator input port (conjugated ~HydraulicPort: flowRate is inverted to 'in')
    coordinator.assertLiteral({
      predicate: "portUsage",
      args: ["actuatorIn", "HydraulicPort", true],
      domain: "constraint",
    });

    // Connect pump to actuator: out connects to ~out (which is in) -> VALID
    coordinator.assertLiteral({
      predicate: "connect",
      args: ["pumpOut", "actuatorIn"],
      domain: "constraint",
    });

    assert.equal(coordinator.checkSat().isSat, true, "Valid connection between port and conjugated port");

    // Invalid: connect two standard (non-conjugated) output ports
    coordinator.assertLiteral({
      predicate: "portUsage",
      args: ["auxPumpOut", "HydraulicPort", false],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "connect",
      args: ["pumpOut", "auxPumpOut"],
      domain: "constraint",
    });

    const unsat = coordinator.checkSat();
    assert.equal(unsat.isSat, false, "Connecting two output ports should trigger direction conflict");
    assert.match(unsat.conflict?.explanation || "", /Port Connection Direction Conflict/);
  });

  it("should evaluate stochastic UQ safety bounds and detect margin violations", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const uqOracle = new UqTheoryOracle();
    coordinator.registerOracle(uqOracle);

    // Fuel consumption: normal distribution with mean = 40.0, stdDev = 2.0
    coordinator.assertLiteral({
      predicate: "distribution",
      args: ["fuelRate", "normal", 40.0, 2.0],
      domain: "dynamic_simulation",
    });

    // Requirement: Probability of fuelRate > 48.0 must be <= 0.001 (0.1%)
    // (48.0 - 40.0) / 2.0 = 4.0 sigma => P(X > 48) ~ 3.16e-5 <= 0.001 -> PASS
    coordinator.assertLiteral({
      predicate: "probBound",
      args: ["fuelRate", ">", 48.0, 0.001],
      domain: "dynamic_simulation",
    });

    assert.equal(coordinator.checkSat().isSat, true, "4 sigma margin should satisfy 0.1% probability requirement");

    // Strict requirement: Probability of fuelRate > 41.0 must be <= 0.01 (1%)
    // (41.0 - 40.0) / 2.0 = 0.5 sigma => P(X > 41) ~ 30.8% > 1% -> VIOLATION!
    coordinator.assertLiteral({
      predicate: "probBound",
      args: ["fuelRate", ">", 41.0, 0.01],
      domain: "dynamic_simulation",
    });

    const unsat = coordinator.checkSat();
    assert.equal(unsat.isSat, false, "High failure probability should violate stochastic safety bound");
    assert.match(unsat.conflict?.explanation || "", /Uncertainty Quantification \(UQ\) Conflict/);
  });

  it("should verify causalization feasibility and Nyquist-Shannon software loop stability", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const causalOracle = new CausalizationTheoryOracle();
    coordinator.registerOracle(causalOracle);

    // Actuator loop with dominant pole at 10 Hz, sampled at 200 Hz (f_sample >= 10 * f_pole) -> PASS
    coordinator.assertLiteral({
      predicate: "sampleRate",
      args: ["pitchLoop", 200, 10],
      domain: "constraint",
    });

    assert.equal(coordinator.checkSat().isSat, true, "200 Hz sampling on 10 Hz pole is stable");

    // Flight surface loop with dominant pole at 50 Hz, sampled at only 100 Hz (< 500 Hz required) -> VIOLATION
    coordinator.assertLiteral({
      predicate: "sampleRate",
      args: ["rudderLoop", 100, 50],
      domain: "constraint",
    });

    const unsat = coordinator.checkSat();
    assert.equal(unsat.isSat, false, "Sampling too slow for physical dynamics triggers discretization instability");
    assert.match(unsat.conflict?.explanation || "", /Discretization Instability Conflict/);
  });

  it("should prove V-Model requirement entailment and generate cryptographic ProofManifests", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const entailOracle = new EntailmentTheoryOracle();
    coordinator.registerOracle(entailOracle);

    // Parent requirement: total system mass <= 150 kg
    coordinator.assertLiteral({
      predicate: "requirement",
      args: ["Req_Parent_Mass", "totalMass", "<=", 150],
      domain: "constraint",
    });

    // Sub-requirement: allocated structure mass <= 120 kg (120 <= 150 guarantees parent)
    coordinator.assertLiteral({
      predicate: "requirement",
      args: ["Req_Child_Structure", "totalMass", "<=", 120],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "entailment",
      args: ["Req_Parent_Mass", ["Req_Child_Structure"]],
      domain: "constraint",
    });

    const satRes = coordinator.checkSat();
    assert.equal(satRes.isSat, true, "Child requirement (<= 120) mathematically guarantees parent (<= 150)");

    // Proof manifest must have been generated
    const manifests = entailOracle.getCertifiedManifests();
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.isCertifiedCompliant, true);
    assert.ok(manifests[0]?.compositeRootHash, "Merkle root hash must be computed");

    // Introduce requirement gap: Sub-requirement allows <= 180 kg, which fails parent (<= 150 kg)
    coordinator.assertLiteral({
      predicate: "requirement",
      args: ["Req_Child_Loose", "totalMass", "<=", 180],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "entailment",
      args: ["Req_Parent_Mass", ["Req_Child_Loose"]],
      domain: "constraint",
    });

    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false, "Loose sub-requirement fails to entail parent requirement");
    assert.match(unsatRes.conflict?.explanation || "", /V-Model Requirement Entailment Gap/);
  });
});

function unsatEntities(culprits?: string[], expected?: string[]): boolean {
  if (!culprits || !expected) return false;
  return expected.every((e) => culprits.includes(e));
}
