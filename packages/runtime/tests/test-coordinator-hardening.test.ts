import assert from "node:assert";
import { describe, it } from "node:test";
import { ConstraintTheoryOracle, FlowAlgebraOracle, OntologyTheoryOracle } from "../src/formal/oracles/index.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";
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
});
