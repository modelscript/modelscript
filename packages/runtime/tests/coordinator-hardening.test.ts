// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { CongruenceClosure } from "../src/formal/craig_interpolator.js";
import { DpllTSolver } from "../src/formal/dpll_t_solver.js";
import { MultiDomainVerificationCoordinator } from "../src/formal/multidomain_coordinator.js";
import { MultiPoly, NlsatSolver } from "../src/formal/nlsat_solver.js";
import {
  CaeContractOracle,
  CausalizationTheoryOracle,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  EntailmentTheoryOracle,
  FlowAlgebraOracle,
  OntologyTheoryOracle,
  SpatialPhysicsOracle,
  ToleranceStackOracle,
} from "../src/formal/oracles/index.js";
import { assertRequirementsToTheoryCoordinator } from "../src/formal/requirement_binder.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";
import { PolyglotTransformer } from "../src/interop/polyglot-transformer.js";
import { PhysicsSimplexReconciler } from "../src/interop/simplex_reconciler.js";
import { DigitalThreadHypergraph, ThreadDomain } from "../src/interop/thread_hypergraph.js";
import { VCycleVerifier } from "../src/interop/vcycle_verifier.js";
import { UnifiedVerifier } from "../src/simulation/unified_verifier.js";

describe("Semantic Theory Coordinator Hardening & Soundness", () => {
  // =========================================================================
  // 1. Immediate Core Inversion Check (Soundness & Fast-Failure)
  // =========================================================================
  describe("Item 1: Immediate Core Inversion Check", () => {
    it("should immediately detect direct inverted interval [10, 5] as UNSAT with justification", () => {
      const coordinator = new SemanticTheoryCoordinator();
      const litId = coordinator.assertLiteral({
        predicate: "interval",
        args: ["pressure", 10, 5],
        domain: "constraint",
      });

      const res = coordinator.checkSat();
      assert.strictEqual(res.status, "UNSAT");
      assert.strictEqual(res.isSat, false);
      assert.ok(res.conflict, "Expected conflict clause");
      assert.strictEqual(res.conflict.theoryName, "SemanticTheoryCoordinator");
      assert.ok(res.conflict.explanation.includes("Immediate interval contradiction"));
      assert.ok(res.conflict.culpritEntities.includes("pressure"));
      assert.ok(res.conflict.literals.some((l) => l.id === litId));
    });

    it("should immediately detect bound inversion on union of disjoint intervals", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());

      // x in [10, 20]
      const litX = coordinator.assertLiteral({
        predicate: "interval",
        args: ["x", 10, 20],
        domain: "constraint",
      });

      // y in [0, 5]
      const litY = coordinator.assertLiteral({
        predicate: "interval",
        args: ["y", 0, 5],
        domain: "constraint",
      });

      // Assert x == y
      const litEq = coordinator.assertLiteral({
        predicate: "equal",
        args: ["x", "y"],
        domain: "constraint",
      });

      const res = coordinator.checkSat();
      assert.strictEqual(res.status, "UNSAT");
      assert.strictEqual(res.isSat, false);
      assert.ok(res.conflict, "Conflict must be generated on union");
      assert.ok(res.conflict.explanation.includes("Immediate interval contradiction"));
      // Culprits should include x and y
      assert.ok(res.conflict.culpritEntities.includes("x") || res.conflict.culpritEntities.includes("y"));
      // Conflict literals should record justifications
      const litIds = res.conflict.literals.map((l) => l.id);
      assert.ok(litIds.includes(litEq) || litIds.includes(litX) || litIds.includes(litY));
    });

    it("should preserve UNSAT status when queried with memoized querySat", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.assertLiteral({
        predicate: "interval",
        args: ["temp", 100, 20],
        domain: "constraint",
      });

      const res1 = coordinator.querySat(1);
      assert.strictEqual(res1.status, "UNSAT");
      const res2 = coordinator.querySat(1);
      assert.strictEqual(res2.status, "UNSAT");
    });
  });

  // =========================================================================
  // 2. Iterative Disjoint-Set with Cycle Guard (Stack Safety & Resilience)
  // =========================================================================
  describe("Item 2: Iterative Disjoint-Set with Cycle Guard", () => {
    it("should handle a 10,000-deep alias chain without call stack overflow", () => {
      const coordinator = new SemanticTheoryCoordinator();
      const n = 10000;

      // Construct a linear chain: v0 -> v1 -> v2 -> ... -> vn
      for (let i = 0; i < n; i++) {
        (coordinator as any).parentMap.set(`v_${i}`, `v_${i + 1}`);
      }

      // Resolving canonical representative for v_0 must not exceed call stack
      const root = coordinator.getCanonicalVar("v_0");
      assert.strictEqual(root, `v_${n}`);

      // Path compression check: v_0 should now directly point to v_n in parentMap
      assert.strictEqual((coordinator as any).parentMap.get("v_0"), `v_${n}`);
      // Subsequent lookup is O(1)
      assert.strictEqual(coordinator.getCanonicalVar("v_0"), `v_${n}`);
    });

    it("should break cyclic alias loops defensively and self-heal", () => {
      const coordinator = new SemanticTheoryCoordinator();

      // Malicious or accidental cycle: A -> B -> C -> A
      (coordinator as any).parentMap.set("nodeA", "nodeB");
      (coordinator as any).parentMap.set("nodeB", "nodeC");
      (coordinator as any).parentMap.set("nodeC", "nodeA");

      // Resolving should not loop infinitely or throw stack overflow
      const root = coordinator.getCanonicalVar("nodeA");
      assert.ok(root === "nodeA" || root === "nodeB" || root === "nodeC");

      // All nodes in the cycle should now be compressed to the broken root
      assert.strictEqual(coordinator.getCanonicalVar("nodeA"), root);
      assert.strictEqual(coordinator.getCanonicalVar("nodeB"), root);
      assert.strictEqual(coordinator.getCanonicalVar("nodeC"), root);
    });

    it("should safely resolve cyclic aliases in FlowAlgebraOracle", () => {
      const flowOracle = new FlowAlgebraOracle();
      (flowOracle as any).aliases.set("portA", "portB");
      (flowOracle as any).aliases.set("portB", "portC");
      (flowOracle as any).aliases.set("portC", "portA");

      const items = flowOracle.getEffectiveItems("portA");
      // Should return null gracefully without crashing
      assert.strictEqual(items, null);
    });

    it("should safely resolve cyclic aliases in OntologyTheoryOracle", () => {
      const ontologyOracle = new OntologyTheoryOracle();
      (ontologyOracle as any).sameIndividualMap.set("indA", "indB");
      (ontologyOracle as any).sameIndividualMap.set("indB", "indC");
      (ontologyOracle as any).sameIndividualMap.set("indC", "indA");

      // Internal findRootIndividual via assertLiteral sameIndividual
      ontologyOracle.assertLiteral({
        id: 1,
        predicate: "sameIndividual",
        args: ["indA", "indD"],
        domain: "ontology",
      });

      const res = ontologyOracle.checkSat();
      assert.strictEqual(res.isSat, true);
    });
  });

  // =========================================================================
  // 3. Cooperative Cancellation Token
  // =========================================================================
  describe("Item 3: Cooperative Cancellation Token", () => {
    it("should immediately abort checkSat with status UNKNOWN when cancellationToken is pre-aborted", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());

      coordinator.assertLiteral({
        predicate: "interval",
        args: ["paramX", 0, 100],
        domain: "constraint",
      });

      const abortController = new AbortController();
      abortController.abort();

      const res = coordinator.checkSat(50, abortController.signal);
      assert.strictEqual(res.status, "UNKNOWN");
      assert.strictEqual(res.isSat, false);
      assert.strictEqual(res.reason, "Verification cancelled by client token.");
      assert.strictEqual(res.iterations, 0);
    });

    it("should abort with CancellationToken object { isCancellationRequested: true }", () => {
      const coordinator = new SemanticTheoryCoordinator();
      const token = { isCancellationRequested: true };

      const res = coordinator.checkSat(50, token);
      assert.strictEqual(res.status, "UNKNOWN");
      assert.strictEqual(res.isSat, false);
      assert.strictEqual(res.reason, "Verification cancelled by client token.");
    });

    it("should thread cancellationToken through UnifiedVerifier.verify", async () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());

      const token = { isCancellationRequested: true };
      const report = await UnifiedVerifier.verify(
        {
          sourceText: "model Test end Test;",
          coordinator,
        },
        {
          theoryCoordinator: true,
          cancellationToken: token,
        },
      );

      assert.strictEqual(report.summary.overallPassed, false);
      assert.strictEqual(report.stages["theory_coordination"]?.passed, false);
      assert.ok(report.stages["theory_coordination"]?.summary.includes("cancelled by client token"));
    });
  });

  // =========================================================================
  // 4. General Congruence Closure for Function & Surrogate Applications
  // =========================================================================
  describe("Item 4: General Congruence Closure", () => {
    it("should deduce y1 == y2 when f(a) == y1 and f(b) == y2 with a == b", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());

      // Assert y1 = f(a)
      const litF1 = coordinator.assertLiteral({
        predicate: "funcApply",
        args: ["y1", "f", ["a"]],
      });

      // Assert y2 = f(b)
      const litF2 = coordinator.assertLiteral({
        predicate: "funcApply",
        args: ["y2", "f", ["b"]],
      });

      // Assert a == b
      const litEq = coordinator.assertLiteral({
        predicate: "equal",
        args: ["a", "b"],
        domain: "constraint",
      });

      const res = coordinator.checkSat();
      assert.strictEqual(res.status, "SAT");
      assert.strictEqual(res.isSat, true);

      // Congruence closure must unify y1 and y2
      const rootY1 = coordinator.getCanonicalVar("y1");
      const rootY2 = coordinator.getCanonicalVar("y2");
      assert.strictEqual(
        rootY1,
        rootY2,
        "y1 and y2 must share the same canonical representative via congruence closure",
      );
    });

    it("should support multi-argument congruence: g(a1, a2) == g(b1, b2) when a1 == b1 and a2 == b2", () => {
      const coordinator = new SemanticTheoryCoordinator();

      // z1 = g(a1, a2)
      coordinator.assertLiteral({
        predicate: "surrogateApply",
        args: ["z1", "aerodynamic_drag", ["a1", "a2"]],
      });

      // z2 = g(b1, b2)
      coordinator.assertLiteral({
        predicate: "surrogateApply",
        args: ["z2", "aerodynamic_drag", ["b1", "b2"]],
      });

      // Equate args
      coordinator.assertLiteral({
        predicate: "equal",
        args: ["a1", "b1"],
      });
      coordinator.assertLiteral({
        predicate: "equal",
        args: ["a2", "b2"],
      });

      const res = coordinator.checkSat();
      assert.strictEqual(res.status, "SAT");

      assert.strictEqual(coordinator.getCanonicalVar("z1"), coordinator.getCanonicalVar("z2"));
    });

    it("should propagate congruence equality to trigger interval contradiction", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());

      // y1 = f(x1), y1 in [100, 200]
      coordinator.assertLiteral({
        predicate: "funcApply",
        args: ["y1", "sensorRead", ["x1"]],
      });
      coordinator.assertLiteral({
        predicate: "interval",
        args: ["y1", 100, 200],
        domain: "constraint",
      });

      // y2 = f(x2), y2 in [0, 50]
      coordinator.assertLiteral({
        predicate: "funcApply",
        args: ["y2", "sensorRead", ["x2"]],
      });
      coordinator.assertLiteral({
        predicate: "interval",
        args: ["y2", 0, 50],
        domain: "constraint",
      });

      // When x1 == x2 is established:
      coordinator.assertLiteral({
        predicate: "equal",
        args: ["x1", "x2"],
      });

      // Congruence forces y1 == y2, which forces [100, 200] ∩ [0, 50] = ∅ -> UNSAT
      const res = coordinator.checkSat();
      assert.strictEqual(res.status, "UNSAT");
      assert.strictEqual(res.isSat, false);
      assert.ok(res.conflict, "Expected conflict on interval contradiction through congruence");
      assert.ok(res.conflict.explanation.includes("Immediate interval contradiction"));
    });

    it("should correctly handle backtrack popping of function terms", () => {
      const coordinator = new SemanticTheoryCoordinator();

      coordinator.pushLevel();
      coordinator.assertLiteral({
        predicate: "funcApply",
        args: ["res1", "myFn", ["argA"]],
      });
      assert.strictEqual((coordinator as any).functionTerms.length, 1);

      coordinator.popLevel();
      assert.strictEqual((coordinator as any).functionTerms.length, 0);
    });
  });

  // =========================================================================
  // 5. Fine-Grained Retraction of Equalities & Shared Equalities
  // =========================================================================
  describe("Item 5: Fine-Grained Retraction of Equalities", () => {
    it("should un-merge equivalence classes and restore satisfiability when retractLiteral is called on an equal literal", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());

      coordinator.assertLiteral({
        predicate: "interval",
        args: ["vA", 10, 20],
        domain: "constraint",
      });
      coordinator.assertLiteral({
        predicate: "interval",
        args: ["vB", 50, 60],
        domain: "constraint",
      });
      const eqLit = coordinator.assertLiteral({
        predicate: "equal",
        args: ["vA", "vB"],
        domain: "constraint",
      });

      assert.strictEqual(coordinator.checkSat().status, "UNSAT");

      // Retract the equality literal; vA and vB must un-merge cleanly
      coordinator.retractLiteral(eqLit);
      assert.notStrictEqual(coordinator.getCanonicalVar("vA"), coordinator.getCanonicalVar("vB"));
      const afterRetract = coordinator.checkSat();
      assert.strictEqual(afterRetract.status, "SAT");
      assert.strictEqual(afterRetract.isSat, true);
    });

    it("should preserve levelStack and filter retracted sharedEqualities in DimensionalTheoryOracle", () => {
      const dimOracle = new DimensionalTheoryOracle();
      dimOracle.pushLevel();
      dimOracle.assertLiteral({
        id: 1,
        predicate: "dimension",
        args: ["voltage", "V"],
        domain: "dimensional",
      });
      dimOracle.assertLiteral({
        id: 2,
        predicate: "dimension",
        args: ["current", "A"],
        domain: "dimensional",
      });
      dimOracle.onSharedEquality({
        varA: "voltage",
        varB: "current",
        domain: "real",
        explanation: "test unification",
        sourceOracle: "ConstraintTheoryOracle",
        justifications: [99],
      });
      assert.strictEqual(dimOracle.checkSat().isSat, false);

      // Retracting literal 99 (via a dummy literal 99 in dimOracle) should drop the shared equality and preserve levelStack
      dimOracle.assertLiteral({
        id: 99,
        predicate: "equal",
        args: ["voltage", "current"],
        domain: "dimensional",
      });
      dimOracle.retractLiteral(99);
      assert.strictEqual(dimOracle.checkSat().isSat, true);
    });
  });

  // =========================================================================
  // 6. Cycle Self-Healing in Constraint & Dimensional Oracles
  // =========================================================================
  describe("Item 6: Cycle Guards in Constraint & Dimensional Oracles", () => {
    it("should self-heal alias cycles in ConstraintTheoryOracle and DimensionalTheoryOracle", () => {
      const constraintOracle = new ConstraintTheoryOracle();
      (constraintOracle as any).aliases.set("c1", "c2");
      (constraintOracle as any).aliases.set("c2", "c3");
      (constraintOracle as any).aliases.set("c3", "c1");
      assert.ok(constraintOracle.getInterval("c1") !== undefined);

      const dimOracle = new DimensionalTheoryOracle();
      (dimOracle as any).aliases.set("d1", "d2");
      (dimOracle as any).aliases.set("d2", "d3");
      (dimOracle as any).aliases.set("d3", "d1");
      assert.strictEqual(dimOracle.getDimension("d1"), undefined);
    });
  });

  // =========================================================================
  // 7. Kirchhoff Opposite-Sign Flow Equality Propagation
  // =========================================================================
  describe("Item 7: Kirchhoff Opposite-Sign Flow Equality Propagation", () => {
    it("should negate interval bounds across opposite-sign Kirchhoff flow conservation (portA.i == -portB.i)", () => {
      const coordinator = new SemanticTheoryCoordinator();
      const constraintOracle = new ConstraintTheoryOracle();
      const flowOracle = new FlowAlgebraOracle();
      const dimOracle = new DimensionalTheoryOracle();
      coordinator.registerOracle(constraintOracle);
      coordinator.registerOracle(flowOracle);
      coordinator.registerOracle(dimOracle);

      coordinator.subscribe("portA.i", constraintOracle);
      coordinator.subscribe("portB.i", constraintOracle);
      coordinator.subscribe("portA.i", dimOracle);
      coordinator.subscribe("portB.i", dimOracle);

      // Both flows have dimension Ampere
      coordinator.assertLiteral({
        predicate: "dimension",
        args: ["portA.i", "A"],
        domain: "dimensional",
      });
      coordinator.assertLiteral({
        predicate: "dimension",
        args: ["portB.i", "A"],
        domain: "dimensional",
      });

      // Define ElectricalPin portType with across v and flow i
      coordinator.assertLiteral({
        predicate: "portType",
        args: [
          "ElectricalPin",
          [
            { name: "v", direction: "inout", isFlow: false },
            { name: "i", direction: "inout", isFlow: true },
          ],
        ],
      });
      coordinator.assertLiteral({
        predicate: "portUsage",
        args: ["portA", "ElectricalPin"],
      });
      coordinator.assertLiteral({
        predicate: "portUsage",
        args: ["portB", "ElectricalPin"],
      });

      // Connect portA and portB via flow conservation: portA.i == -portB.i
      coordinator.assertLiteral({
        predicate: "connect",
        args: ["portA", "portB"],
      });

      // portA.i in [5, 10] => portB.i must be in [-10, -5]
      coordinator.assertLiteral({
        predicate: "interval",
        args: ["portA.i", 5, 10],
        domain: "constraint",
      });

      const satRes = coordinator.checkSat();
      assert.strictEqual(satRes.status, "SAT");
      const boundsB = coordinator.getAllCanonicalBounds().get(coordinator.getCanonicalVar("portB.i"));
      assert.deepStrictEqual(boundsB, [-10, -5]);
      const oracleIntB = constraintOracle.getInterval("portB.i");
      assert.ok(oracleIntB);
      assert.strictEqual(oracleIntB.lo, -10);
      assert.strictEqual(oracleIntB.hi, -5);

      // Asserting portB.i >= 0 must trigger an UNSAT bound conflict because portB.i in [-10, -5]
      coordinator.assertLiteral({
        predicate: "bound",
        args: ["portB.i", ">=", 0],
        domain: "constraint",
      });
      const unsatRes = coordinator.checkSat();
      assert.strictEqual(unsatRes.status, "UNSAT");
    });
  });

  // =========================================================================
  // 8. Coordinator-to-Box Bound Handoff in DpllTSolver & Physics Reconciler
  // =========================================================================
  describe("Item 8: Coordinator-to-Box Bound Handoff & Physics Reconciler", () => {
    it("should transfer coordinator-tightened canonical bounds into DpllTSolver nonlinear box", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());
      const solver = new DpllTSolver({
        clauses: [[1], [2]],
        multiTheoryLiterals: new Map([
          [
            1,
            {
              id: 1,
              predicate: "interval",
              args: ["x", 4, 5],
              domain: "constraint",
            },
          ],
        ]),
        theoryLiterals: new Map([
          [
            2,
            {
              expr: { kind: "sqr", child: { kind: "var", name: "x" } },
              rel: "<=",
              rhs: 9,
            },
          ],
        ]),
        coordinator,
      });

      const res = solver.solve(new Map([["x", new Interval(-10, 10)]]));
      assert.strictEqual(res.status, "UNSAT");
    });

    it("should reject dual out-of-bounds edits on the same side in PolyglotTransformer.resolveConflictPhysics", () => {
      const transformer = new PolyglotTransformer();
      (transformer as any).conflicts.set("c_invalid", {
        id: "c_invalid",
        property: "mass",
        sourceVal: -50,
        targetVal: -10,
        isResolved: false,
      });
      transformer.resolveConflictPhysics("c_invalid", 0, 100);
      const invalidItem = (transformer as any).conflicts.get("c_invalid");
      assert.strictEqual(invalidItem.isResolved, false);
      assert.strictEqual(invalidItem.resolved, undefined);

      // When at least one proposal is within [0, 100], it resolves and clamps
      (transformer as any).conflicts.set("c_valid", {
        id: "c_valid",
        property: "mass",
        sourceVal: 20,
        targetVal: 120,
        isResolved: false,
      });
      transformer.resolveConflictPhysics("c_valid", 0, 100);
      const validItem = (transformer as any).conflicts.get("c_valid");
      assert.strictEqual(validItem.isResolved, true);
      assert.strictEqual(validItem.resolved, 70);
    });
  });

  // =========================================================================
  // 9. Secondary Oracles & DigitalThreadHypergraph Hardening
  // =========================================================================
  describe("Item 9: Secondary Domain Oracles & DigitalThreadHypergraph", () => {
    it("should preserve levelStack and non-retracted sharedEqualities across retractLiteral in CaeContractOracle & SpatialPhysicsOracle", () => {
      const cae = new CaeContractOracle();
      cae.assertLiteral({
        id: 1,
        predicate: "caeContract",
        args: [
          {
            contractId: "C1",
            metricName: "von_mises_stress",
            actualValue: 180,
            threshold: 250,
            operator: "<=",
            partName: "WingSpar",
          },
        ],
      });
      cae.onSharedEquality({
        varA: "WingSpar.von_mises_stress",
        varB: "WingSpar.von_mises_stress",
        domain: "interval",
        bounds: [0, 150],
        sourceOracle: "ConstraintTheoryOracle",
        justifications: [99],
      });
      cae.pushLevel();
      cae.assertLiteral({
        id: 2,
        predicate: "caeContract",
        args: [
          {
            contractId: "C2",
            metricName: "drag_coeff",
            actualValue: 0.02,
            threshold: 0.05,
            operator: "<=",
          },
        ],
      });

      // Retracting literal 2 should preserve levelStack and the external bound on C1 from justification 99
      cae.retractLiteral(2);
      assert.strictEqual(cae.checkSat().isSat, false, "External bound [0, 150] on C1 must survive retractLiteral(2)");

      // Retracting literal 99 (via simulated justification cleanup) or popping level must still work
      cae.popLevel();
      assert.strictEqual(cae.checkSat().isSat, false);

      const spatial = new SpatialPhysicsOracle();
      spatial.assertLiteral({
        id: 10,
        predicate: "stressMeasurement",
        args: ["Bracket", 200e6, 250e6, 1.0],
      });
      spatial.onSharedEquality({
        varA: "Bracket.max_von_mises",
        varB: "Bracket.max_von_mises",
        domain: "interval",
        bounds: [0, 150e6],
        sourceOracle: "ConstraintTheoryOracle",
        justifications: [77],
      });
      spatial.assertLiteral({
        id: 11,
        predicate: "solidGeometry",
        args: ["Housing", true, 0.05],
      });
      spatial.retractLiteral(11);
      assert.strictEqual(spatial.checkSat().isSat, false, "External bound on Bracket must survive retractLiteral(11)");
    });

    it("should restore deep-cloned equation/requirement variables after onSharedEquality and popLevel in Causalization & Entailment oracles", () => {
      const causal = new CausalizationTheoryOracle();
      causal.assertLiteral({
        id: 1,
        predicate: "algebraicLoop",
        args: ["loop1", ["v_orig"], false, false],
      });
      causal.pushLevel();
      causal.onSharedEquality({
        varA: "v_orig",
        varB: "v_aliased",
        domain: "real",
        explanation: "test alias",
        sourceOracle: "ConstraintTheoryOracle",
      });
      const conflictAtLevel1 = causal.checkSat().conflict;
      assert.ok(conflictAtLevel1?.culpritEntities.includes("v_aliased"));

      causal.popLevel();
      const conflictAtLevel0 = causal.checkSat().conflict;
      assert.ok(conflictAtLevel0?.culpritEntities.includes("v_orig"));
      assert.ok(!conflictAtLevel0?.culpritEntities.includes("v_aliased"));

      const entail = new EntailmentTheoryOracle();
      entail.assertLiteral({
        id: 1,
        predicate: "requirement",
        args: ["R_parent", "mass", "<=", 10],
      });
      entail.assertLiteral({
        id: 2,
        predicate: "requirement",
        args: ["R_child", "mass", "<=", 15],
      });
      entail.assertLiteral({
        id: 3,
        predicate: "entailment",
        args: ["R_parent", ["R_child"]],
      });
      entail.pushLevel();
      entail.onSharedEquality({
        varA: "mass",
        varB: "total_mass",
        domain: "real",
        explanation: "alias",
        sourceOracle: "ConstraintTheoryOracle",
      });
      assert.ok(entail.checkSat().conflict?.explanation.includes("total_mass"));
      entail.popLevel();
      assert.ok(entail.checkSat().conflict?.explanation.includes("mass ="));
    });

    it("should snapshot propagatedEqualities on pushLevel/popLevel in ToleranceStackOracle", () => {
      const tol = new ToleranceStackOracle();
      tol.assertLiteral({
        id: 1,
        predicate: "toleranceChain",
        args: [
          {
            chainId: "shaft_gap",
            method: "worst_case",
            targetClearance: { min: 0.1, max: 2.0 },
            contributors: [{ partId: "P1", featureName: "F1", nominal: 1.0, tolerance: 0.2, direction: 1 }],
          },
        ],
      });
      tol.pushLevel();
      const eqs1 = tol.propagateEqualities();
      assert.strictEqual(eqs1.length, 1);
      assert.strictEqual(tol.propagateEqualities().length, 0);

      // Popping back to level 0 should allow re-propagating equalities
      tol.popLevel();
      const eqsAfterPop = tol.propagateEqualities();
      assert.strictEqual(eqsAfterPop.length, 1);
    });

    it("should clear stale reverse-lookup keys when re-binding a domain node in DigitalThreadHypergraph", () => {
      const hg = new DigitalThreadHypergraph();
      const slot = hg.createThread(500);
      hg.bindDomainNode(slot, ThreadDomain.SysML2, 101);
      assert.strictEqual(hg.findThreadByDomainNode(ThreadDomain.SysML2, 101), 500);

      // Re-bind SysML2 domain on the same thread to node 202
      hg.bindDomainNode(slot, ThreadDomain.SysML2, 202);
      assert.strictEqual(hg.findThreadByDomainNode(ThreadDomain.SysML2, 202), 500);
      assert.strictEqual(hg.findThreadByDomainNode(ThreadDomain.SysML2, 101), undefined);
    });
  });

  // =========================================================================
  // 10. Integration Bridges: MultiDomainCoordinator, RequirementBinder, VCycleVerifier
  // =========================================================================
  describe("Item 10: Integration Bridges & Verification Harnesses", () => {
    it("should intersect lower and upper externalBounds across multiple requirements in MultiDomainVerificationCoordinator", () => {
      const md = new MultiDomainVerificationCoordinator();
      // Bus voltage is 0.96 p.u., requirement 1 requires >= 0.98 p.u., requirement 2 requires <= 1.04 p.u.
      // Because externalBounds are intersected ([0.98, 1.04]) rather than overwritten by [-Infinity, 1.04],
      // the 0.96 p.u. bus voltage must be detected as a violation!
      const report = md.verify(
        [
          { id: "REQ_V_MIN", variable: "voltage_pu", operator: ">=", limitValue: 0.98 },
          { id: "REQ_V_MAX", variable: "voltage_pu", operator: "<=", limitValue: 1.04 },
        ],
        {
          powerGrid: {
            busOverrides: [{ busId: 101, actualVm: 0.96, minVm: 0.95, maxVm: 1.05 }],
          },
        },
      );
      assert.strictEqual(
        report.isCertified,
        false,
        "Lower bound >= 0.98 must not be overwritten by upper bound <= 1.04",
      );
      assert.strictEqual(report.status, "CONTRACT_VIOLATION");

      // Subsequent run on the same instance with compliant bus voltage (1.00 p.u.) must succeed because reset() is called
      const report2 = md.verify(
        [
          { id: "REQ_V_MIN", variable: "voltage_pu", operator: ">=", limitValue: 0.98 },
          { id: "REQ_V_MAX", variable: "voltage_pu", operator: "<=", limitValue: 1.04 },
        ],
        {
          powerGrid: {
            busOverrides: [{ busId: 101, actualVm: 1.0, minVm: 0.95, maxVm: 1.05 }],
          },
        },
      );
      assert.strictEqual(report2.isCertified, true);
    });

    it("should route SysML requirements to Constraint & Entailment oracles in assertRequirementsToTheoryCoordinator", () => {
      const coordinator = new SemanticTheoryCoordinator();
      coordinator.registerOracle(new ConstraintTheoryOracle());
      coordinator.registerOracle(new EntailmentTheoryOracle());

      assertRequirementsToTheoryCoordinator(coordinator, [
        {
          id: "FlightCeilingReq",
          targetAttribute: "v_climb",
          operator: "<=",
          limitValue: 12.0,
        },
      ]);

      // Asserting v_climb == 15.0 must now trigger a conflict in ConstraintTheoryOracle
      coordinator.assertLiteral({
        predicate: "bound",
        args: ["v_climb", "==", 15.0],
        domain: "constraint",
      });

      const res = coordinator.checkSat();
      assert.strictEqual(res.isSat, false);
    });

    it("should report Violated when constrainedVariable is missing in VCycleVerifier and guard CongruenceClosure cycles", () => {
      const verdicts = VCycleVerifier.verifyRequirements(
        [
          {
            requirementId: "R_MISSING",
            name: "Missing State Check",
            constrainedVariable: "non_existent_var",
            operator: "<=",
            limitValue: 100,
          },
        ],
        {
          t: new Float64Array([0, 1]),
          y: new Float64Array([5, 5]),
          states: ["other_state"],
        } as any,
      );
      assert.strictEqual(verdicts[0]?.isSatisfied, false);
      assert.strictEqual(verdicts[0]?.status, "Violated");

      const cc = new CongruenceClosure();
      (cc as any).parent.set("a", "b");
      (cc as any).parent.set("b", "a");
      const root = cc.find("a");
      assert.ok(root === "a" || root === "b");
    });

    it("should lower pow/div AST nodes in MultiPoly and report conflict cores in NlsatSolver", () => {
      // x^2 / 2 <= 8 => polynomial x^2 * 0.5 - 8 <= 0
      const poly = MultiPoly.fromExprNode({
        kind: "div",
        left: { kind: "pow", left: { kind: "var", name: "x" }, right: { kind: "const", value: 2 } },
        right: { kind: "const", value: 2 },
      });
      assert.ok(poly !== null, "MultiPoly.fromExprNode must support pow and div-by-constant");
      assert.strictEqual(poly.degree("x"), 2);

      // Multi-variable exhausted CAD tree: x^2 == 4 (x = -2 or 2) AND x + y == 0 AND y >= 5 (UNSAT)
      const constraints = NlsatSolver.fromNonlinearConstraints([
        {
          expr: { kind: "pow", left: { kind: "var", name: "x" }, right: { kind: "const", value: 2 } },
          rel: "==",
          rhs: 4,
        },
        {
          expr: { kind: "add", left: { kind: "var", name: "x" }, right: { kind: "var", name: "y" } },
          rel: "==",
          rhs: 0,
        },
        {
          expr: { kind: "var", name: "y" },
          rel: ">=",
          rhs: 5,
        },
      ]);
      assert.ok(constraints !== null);
      const solver = new NlsatSolver(constraints);
      const res = solver.solve();
      assert.strictEqual(res.status, "UNSAT");
      assert.ok(res.conflictingConstraintIds && res.conflictingConstraintIds.length > 0);
    });

    it("should respect equality constraints at lower bound in PhysicsSimplexReconciler and reuse hypergraph slots in UnifiedVerifier", async () => {
      // Degenerate equality constraint at x == min (RHS == 0 in shifted coordinates x' = x - min)
      const reconcileRes = PhysicsSimplexReconciler.reconcile({
        name: "DegenerateLowerBoundTest",
        parameters: {
          mass: {
            name: "mass",
            unit: "kg",
            bounds: { min: 10, max: 50 },
            proposals: [
              { domain: "sysml2", value: 25, unit: "kg" },
              { domain: "cad", value: 30, unit: "kg" },
            ],
          },
        },
        constraints: [
          {
            name: "PinMassToLowerBound",
            type: "eq",
            coefficients: { mass: 1 },
            rhs: 10,
          },
        ],
      });
      assert.strictEqual(reconcileRes.status, "OPTIMAL");
      assert.strictEqual(reconcileRes.parameters["mass"]?.optimalValue, 10);

      // UnifiedVerifier.verify with updateHypergraph should reuse existing thread slot instead of creating unbound thread 1
      const hg = new DigitalThreadHypergraph();
      const s0 = hg.createThread(101);
      hg.bindDomainNode(s0, ThreadDomain.SysML2, 2001);
      assert.strictEqual(hg.getThreadCount(), 1);

      await UnifiedVerifier.verify(
        {
          sourceText: "package P {}",
          hypergraph: hg,
        },
        { updateHypergraph: true, all: false },
      );
      assert.strictEqual(hg.getThreadCount(), 1, "syncDigitalThread must reuse existing thread slot when present");
    });
  });
});
