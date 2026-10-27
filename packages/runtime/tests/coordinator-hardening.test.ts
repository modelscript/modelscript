// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { OctagonDBM } from "../src/analysis/octagon_dbm.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { TaylorModel } from "../src/analysis/wasm_taylor_model.js";
import { DAEBuilder, EqKind, VarType, Variability } from "../src/dae/wasm_dae.js";
import { GenericCFG } from "../src/formal/abstract_interpretation/cfg.js";
import { FixpointSolver } from "../src/formal/abstract_interpretation/fixpoint_solver.js";
import { IntervalEnvironment, NumericalInterval } from "../src/formal/abstract_interpretation/interval_domain.js";
import { ReducedProductState } from "../src/formal/abstract_interpretation/reduced_product.js";
import { TvpiState } from "../src/formal/abstract_interpretation/tvpi_domain.js";
import { CegarRefinementSynthesizer } from "../src/formal/candidate_filter.js";
import { CdclSatSolver, TseitinEncoder } from "../src/formal/cdcl_sat.js";
import { ChcLowering } from "../src/formal/chc/chc_lowering.js";
import { ChcSystem } from "../src/formal/chc/chc_system.js";
import { SpacerEngine } from "../src/formal/chc/spacer_engine.js";
import { CongruenceClosure } from "../src/formal/craig_interpolator.js";
import { AffineDomain } from "../src/formal/dae/affine_domain.js";
import { DaeBltReachabilityEngine } from "../src/formal/dae/dae_blt_reachability.js";
import { AffineForm } from "../src/formal/dae/dae_interval_evaluator.js";
import { TaylorDomain } from "../src/formal/dae/taylor_domain.js";
import { DpllTSolver } from "../src/formal/dpll_t_solver.js";
import { EventGrammarSolver } from "../src/formal/event_grammar.js";
import { Hc4Contractor } from "../src/formal/hc4_contractor.js";
import { IC3Engine } from "../src/formal/ic3_engine.js";
import { InductiveProver } from "../src/formal/inductive_prover.js";
import { MultiDomainVerificationCoordinator } from "../src/formal/multidomain_coordinator.js";
import { MultiPoly, NlsatSolver } from "../src/formal/nlsat_solver.js";
import {
  CaeContractOracle,
  CausalizationTheoryOracle,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  EntailmentTheoryOracle,
  FlowAlgebraOracle,
  MarineMooringTheoryOracle,
  OntologyTheoryOracle,
  PowerGridTheoryOracle,
  SafetyTheoryOracle,
  SpatialPhysicsOracle,
  ToleranceStackOracle,
  UqTheoryOracle,
} from "../src/formal/oracles/index.js";
import { extractExprVariables } from "../src/formal/region_decomposer.js";
import { RelationalVerifier } from "../src/formal/relational_verifier.js";
import { assertRequirementsToTheoryCoordinator } from "../src/formal/requirement_binder.js";
import { SimplificationWaterfall } from "../src/formal/simplification_waterfall.js";
import { StlMonitor } from "../src/formal/stl_monitor.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";
import { BlastRadiusRegressionRunner } from "../src/interop/blast_radius_runner.js";
import { BomSyncManager } from "../src/interop/bom_sync.js";
import { BrownfieldAlignmentEngine } from "../src/interop/brownfield_alignment.js";
import { OslcGateway } from "../src/interop/oslc_gateway.js";
import { PolyglotTransformer } from "../src/interop/polyglot-transformer.js";
import { ProvenanceGraph } from "../src/interop/provenance.js";
import { ReqIfParser } from "../src/interop/reqif.js";
import { PhysicsSimplexReconciler } from "../src/interop/simplex_reconciler.js";
import { DigitalThreadHypergraph, ThreadDomain } from "../src/interop/thread_hypergraph.js";
import { ThreadSerializer } from "../src/interop/thread_serializer.js";
import { TradeStudyEngine } from "../src/interop/trade_study.js";
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

    it("should detect negative-slope Lipschitz violations and tag unary/pow/call AST nodes across RelationalVerifier, RegionDecomposer, and InductiveProver", () => {
      const rv = new RelationalVerifier();
      // Transfer function: y = -10 * x => y + 10 * x == 0 (encoded using unary neg: y - (-10 * x) == 0)
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y" },
            right: {
              kind: "neg" as const,
              child: {
                kind: "mul" as const,
                left: { kind: "const" as const, value: 10 },
                right: { kind: "var" as const, name: "x" },
              },
            },
          },
          rel: "==" as const,
          rhs: 0,
        },
      ];
      // With targetL = 2, slope -10 violates |y1 - y2| <= 2 * |x1 - x2|
      const lipViolated = rv.verifyLipschitz("x", "y", transfer, 2, { min: 0, max: 10 });
      assert.strictEqual(lipViolated.status, "VIOLATED");

      // With targetL = 12, slope -10 satisfies |y1 - y2| <= 12 * |x1 - x2|
      const lipVerified = rv.verifyLipschitz("x", "y", transfer, 12, { min: 0, max: 10 });
      assert.strictEqual(lipVerified.status, "VERIFIED");

      // RegionDecomposer.extractExprVariables must extract variables inside pow and call nodes
      const extractedVars = new Set<string>();
      extractExprVariables(
        {
          kind: "add",
          left: {
            kind: "pow",
            left: { kind: "var", name: "alpha" },
            right: { kind: "const", value: 2 },
          },
          right: {
            kind: "call",
            fn: "hypot",
            args: [
              { kind: "var", name: "beta" },
              { kind: "var", name: "gamma" },
            ],
          },
        },
        extractedVars,
      );
      assert.ok(extractedVars.has("alpha"));
      assert.ok(extractedVars.has("beta"));
      assert.ok(extractedVars.has("gamma"));

      // InductiveProver.extractVariableStep must recognize subtraction (x' - (x - 2) == 0) and commutative addition (x' - (3 + x) == 0)
      const stepSub = (InductiveProver as any).extractVariableStep({
        expr: {
          kind: "sub",
          left: { kind: "var", name: "pos_prime" },
          right: {
            kind: "sub",
            left: { kind: "var", name: "pos" },
            right: { kind: "const", value: 2 },
          },
        },
        rel: "==",
        rhs: 0,
      });
      assert.deepStrictEqual(stepSub, { variable: "pos", delta: -2 });

      const stepCommAdd = (InductiveProver as any).extractVariableStep({
        expr: {
          kind: "sub",
          left: { kind: "var", name: "pos_prime" },
          right: {
            kind: "add",
            left: { kind: "const", value: 3 },
            right: { kind: "var", name: "pos" },
          },
        },
        rel: "==",
        rhs: 0,
      });
      assert.deepStrictEqual(stepCommAdd, { variable: "pos", delta: 3 });
    });

    it("should substitute unary sqr/sqrt nodes in SpacerEngine and enforce initiation & clause deduplication in IC3Engine", () => {
      // 1. SpacerEngine with unary sqr constraint: Init: x == 2 => Inv(x); Step: Inv(x) & x' == x => Inv(x'); Query: Inv(x) & sqr(x) >= 10 => false
      const chc = new ChcSystem();
      chc.addPredicate({ name: "Inv", arity: 1, varNames: ["x"], types: ["real"] });
      chc.addFact("Inv", ["x"], [{ expr: { kind: "var", name: "x" }, rel: "==", rhs: 2 }]);
      chc.addRule(
        { name: "Inv", args: ["x_next"] },
        [{ name: "Inv", args: ["x"] }],
        [
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "x_next" },
              right: { kind: "var", name: "x" },
            },
            rel: "==",
            rhs: 0,
          },
        ],
      );
      chc.addQuery(
        [{ name: "Inv", args: ["x"] }],
        [
          {
            expr: { kind: "sqr", child: { kind: "var", name: "x" } },
            rel: ">=",
            rhs: 10,
          },
        ],
      );

      const spacer = new SpacerEngine(chc, { maxDepth: 4 });
      // Seed inductive lemma x <= 2 in frame 1 to verify frame lemma consumption during step induction
      (spacer as any).addLemmaToFrame("Inv", 1, {
        expr: { kind: "var", name: "x" },
        rel: "<=",
        rhs: 2,
      });
      (spacer as any).addLemmaToFrame("Inv", 1, {
        expr: { kind: "var", name: "x" },
        rel: ">=",
        rhs: 2,
      });
      const spacerRes = spacer.check();
      assert.strictEqual(spacerRes.status, "SAFE");

      // 2. IC3Engine: 2-variable discrete system where v1=false, v2=false initially and stays false; safety: ~(v1 & v2)
      const ic3 = new IC3Engine({
        stateVars: [1, 2],
        nextStateVars: [3, 4],
        initClauses: [[-1], [-2]],
        transClauses: [
          [-1, 3],
          [1, -3],
          [-2, 4],
          [2, -4],
        ],
        propClauses: [[-1, -2]],
      });
      const ic3Res = ic3.verify(10);
      assert.strictEqual(ic3Res.isProvenInvariant, true);
      if (ic3Res.invariantClauses) {
        const serialized = ic3Res.invariantClauses.map((c) =>
          [...c].sort((a, b) => Math.abs(a) - Math.abs(b)).join(","),
        );
        assert.strictEqual(new Set(serialized).size, serialized.length, "invariantClauses must be deduplicated");
      }
    });

    it("should eliminate non-middle pivots in TvpiState.close and tighten non-octagon slopes in ReducedProductState.reduce", () => {
      // 1. TvpiState.close where pivot is lexicographically largest ("z") and variables inserted out of order:
      // x - z <= 2 (1*x - 1*z <= 2) and z + y <= 5 (1*y + 1*z <= 5) => x + y <= 7
      const tvpi = TvpiState.top();
      assert.strictEqual(tvpi.addInequality("z", "x", -1, 1, 2), true);
      assert.strictEqual(tvpi.addInequality("y", "z", 1, 1, 5), true);
      // Add contradiction x + y >= 10 (-x - y <= -10) -> must become bottom via transitive closure through pivot "z"!
      assert.strictEqual(tvpi.addInequality("x", "y", -1, -1, -10), false);
      assert.strictEqual(tvpi.isBottomState, true);

      // 2. ReducedProductState.reduce tightening Intervals via TVPI arbitrary slope: 2*x + 3*y <= 12 with x in [0, 100], y in [0, 100]
      const rpTop = ReducedProductState.top(8);
      const env = IntervalEnvironment.top()
        .set("x", new NumericalInterval(0, 100))
        .set("y", new NumericalInterval(0, 100));
      const tvpi2 = TvpiState.top();
      tvpi2.addInequality("x", "y", 2, 3, 12);
      const rp = new ReducedProductState(
        env,
        rpTop.octagon,
        rpTop.varIndices,
        rpTop.arraySegments,
        false,
        tvpi2,
      ).reduce();
      assert.strictEqual(rp.isBottom(), false);
      assert.ok(
        Math.abs(rp.intervals.get("x").high - 6) < 1e-5,
        `Expected x.high == 6, got ${rp.intervals.get("x").high}`,
      );
      assert.ok(
        Math.abs(rp.intervals.get("y").high - 4) < 1e-5,
        `Expected y.high == 4, got ${rp.intervals.get("y").high}`,
      );
    });

    it("should contract relational constraints order-independently in ConstraintTheoryOracle and synthesize lower-bound CEGAR cuts", () => {
      // 1. Assert hyperplane and nonlinear constraints BEFORE interval bounds in ConstraintTheoryOracle
      const oracle = new ConstraintTheoryOracle();
      oracle.assertLiteral({
        id: 1,
        predicate: "hyperplane",
        args: [
          {
            coeffs: { x: 1, y: 1 },
            op: "<=",
            rhs: 10,
          },
        ],
      });
      oracle.assertLiteral({
        id: 2,
        predicate: "interval",
        args: ["x", 8, 9],
      });
      oracle.assertLiteral({
        id: 3,
        predicate: "interval",
        args: ["y", 5, 6],
      });
      // Because x in [8, 9] and y in [5, 6], x + y in [13, 15] violates x + y <= 10!
      // Previously, asserting hyperplane before intervals left x and y uncontracted during checkSat().
      const satRes = oracle.checkSat();
      assert.strictEqual(satRes.isSat, false, "ConstraintTheoryOracle must re-contract hyperplane during checkSat()");

      // 2. CegarRefinementSynthesizer with lower-bound breach (actualValue < thresholdValue, e.g. safety_margin = 1.2 < 2.0)
      // Sensitivity d(margin)/d(thickness) = +0.5 => thickness must INCREASE to raise safety_margin >= 2.0
      const refinement = CegarRefinementSynthesizer.synthesizeRefinement({
        candidateId: "cand_low_margin",
        parameters: { thickness: 4.0 },
        failedProperty: "Req_MinSafetyMargin",
        actualValue: 1.2,
        thresholdValue: 2.0,
        sensitivityGradients: { thickness: 0.5 },
      });
      const suggestedThickness = refinement.suggestedBounds["thickness"];
      assert.ok(suggestedThickness !== undefined);
      assert.ok(
        suggestedThickness.min !== undefined && suggestedThickness.min > 4.0,
        `Lower-bound breach with positive sensitivity must raise lower bound on thickness (got min=${suggestedThickness.min})`,
      );
    });

    it("should reject out-of-domain NaN intervals and unbounded sin/cos loops in Hc4Contractor, normalize strict/negative constraints in SimplificationWaterfall, and check extra variables in OctagonDBM.isLeq", () => {
      // 1. Hc4Contractor: sqrt(x) <= 2 when x in [-5, -1] must return false (UNSAT) instead of true with [NaN, NaN]
      const boxNan = new Map<string, Interval>([["x", new Interval(-5, -1)]]);
      const sqrtOk = Hc4Contractor.revise(
        {
          expr: { kind: "sqrt", child: { kind: "var", name: "x" } },
          rel: "<=",
          rhs: 2,
        },
        boxNan,
      );
      assert.strictEqual(sqrtOk, false, "Out-of-domain sqrt([-5, -1]) must return false");

      // Unbounded sin(theta) <= 0.5 with theta in [-Infinity, Infinity] must terminate immediately without hanging
      const boxUnbounded = new Map<string, Interval>([["theta", new Interval(-Infinity, Infinity)]]);
      const sinOk = Hc4Contractor.revise(
        {
          expr: { kind: "sin", child: { kind: "var", name: "theta" } },
          rel: "<=",
          rhs: 0.5,
        },
        boxUnbounded,
      );
      assert.strictEqual(sinOk, true);

      // 2. SimplificationWaterfall: (-x) < 5 => x > -5, and (10 - 2*x) <= 4 => x >= 3
      const simpStrict = SimplificationWaterfall.simplifyConstraint({
        expr: { kind: "neg", child: { kind: "var", name: "x" } },
        rel: "<",
        rhs: 5,
      });
      assert.strictEqual(simpStrict.rel, ">");
      assert.strictEqual(simpStrict.rhs, -5);

      const simpNegMul = SimplificationWaterfall.simplifyConstraint({
        expr: {
          kind: "sub",
          left: { kind: "const", value: 10 },
          right: {
            kind: "mul",
            left: { kind: "const", value: 2 },
            right: { kind: "var", name: "x" },
          },
        },
        rel: "<=",
        rhs: 4,
      });
      assert.strictEqual(simpNegMul.rel, ">=");
      assert.strictEqual(simpNegMul.rhs, 3);

      // Power identity: (-x)^2 => sqr(x)
      const simpPow = SimplificationWaterfall.simplifyExpr({
        kind: "pow",
        left: { kind: "neg", child: { kind: "var", name: "x" } },
        right: { kind: "const", value: 2 },
      });
      assert.strictEqual(simpPow.kind, "sqr");
      assert.strictEqual((simpPow as any).child.kind, "var");

      // 3. OctagonDBM.isLeq with differing numVars
      const dbm1 = new OctagonDBM(1);
      const dbm2 = new OctagonDBM(2);
      dbm2.assumeInterval(1, 0, 10); // Constrain var 1 in dbm2
      assert.strictEqual(
        dbm1.isLeq(dbm2),
        false,
        "dbm1 (unconstrained on var 1) must not be <= dbm2 (constrained on var 1)",
      );
    });

    it("should rank maximize objectives in TradeStudyEngine.evolve, scale BOM mass by density ratio in BomSyncManager, and clamp STL until at trace horizon", async () => {
      // 1. TradeStudyEngine.evolve with a maximize objective (maximize efficiency = x, minimize mass = 10 - x)
      const ts = new TradeStudyEngine("WingTrade", [
        { name: "efficiency", sense: "maximize" },
        { name: "mass", sense: "minimize" },
      ]);
      const tsRes = await ts.evolve({
        variables: [{ name: "x", min: 1, max: 9 }],
        populationSize: 10,
        generations: 3,
        evaluate: (p) => ({
          efficiency: p["x"]!,
          mass: 10 - p["x"]!,
        }),
      });
      // Since efficiency = x (maximize) and mass = 10 - x (minimize) both improve as x increases,
      // the single optimum is near x = 9 and the Pareto front must prefer high x (not inverted!)
      assert.ok(tsRes.kneePoint.objectives["efficiency"]! > 5.0);

      // 2. BomSyncManager.updateItemMaterial without volumeM3 must scale massKg by density ratio
      const bom = new BomSyncManager();
      bom.registerItem({
        id: "PART_BRKT",
        sysmlPart: "Bracket",
        description: "Mounting bracket",
        quantity: 2,
        material: "Aluminum 6061",
        massKg: 2.7, // 0.001 m^3 at 2700 kg/m^3
      });
      const delta = bom.updateItemMaterial("PART_BRKT", "Titanium-Ti6Al4V");
      // Titanium density (4430) > Aluminum 6061 density (2700) => deltaMass must be positive!
      assert.ok(delta.deltaMass > 3.0, `Expected positive deltaMass when switching Al -> Ti, got ${delta.deltaMass}`);

      // 3. StlMonitor: strict inequality boundary violation (x > 5 when x == 5) and until horizon clamping
      const trace = {
        time: new Float64Array([0, 1, 2]),
        signals: {
          x: new Float64Array([5, 6, 7]),
          y: new Float64Array([1, 2, 3]),
        },
      };
      const strictRes = StlMonitor.evaluate(StlMonitor.predicate("x", ">", 5), trace);
      assert.strictEqual(strictRes.isSatisfied, false);
      assert.ok(strictRes.diagnosticExplanation?.includes("strict inequality boundary violated"));

      const untilRes = StlMonitor.evaluate(
        {
          kind: "until",
          interval: [0.5, 1.5],
          left: StlMonitor.predicate("x", ">=", 4),
          right: StlMonitor.predicate("y", ">=", 2),
        },
        trace,
      );
      assert.strictEqual(untilRes.isSatisfied, true);
      assert.ok(Number.isFinite(untilRes.robustnessTrajectory[2]!), "Until robustness at trace horizon must be finite");
    });

    it("should enforce loop minRep & prefix-closure in EventGrammarSolver, reject missing lineage in ProvenanceGraph, import all 16 domains in OslcGateway, and parse signed/scientific ReqIF limits", () => {
      // 1. EventGrammarSolver: loop with minRep=2, maxRep=3 must have exactly 2 traces (2 reps or 3 reps, prefix-closed)
      // and respect "follows" / "includes" coordinations
      const egRes = EventGrammarSolver.explore(
        {
          name: "LoopAndCoordModel",
          actors: {
            Controller: {
              kind: "loop",
              name: "RetryLoop",
              minRep: 2,
              maxRep: 3,
              children: [{ kind: "atomic", name: "Ping" }],
            },
            Monitor: {
              kind: "optional",
              name: "OptMon",
              children: [{ kind: "atomic", name: "Ack" }],
            },
          },
          coordinations: [
            {
              sourceActor: "Monitor",
              sourceEvent: "Ack",
              targetActor: "Controller",
              targetEvent: "Ping",
              relation: "includes",
            },
            {
              sourceActor: "Monitor",
              sourceEvent: "Ack",
              targetActor: "Controller",
              targetEvent: "Ping",
              relation: "follows",
            },
          ],
        },
        { scope: 3 },
      );
      // Every trace must have at least 2 Ping occurrences, prefix-closed (occurrence 1 & 2, or 1, 2, & 3),
      // and because Ack includes Ping and Ack follows Ping, Ack must be active and ordered after all Pings
      assert.strictEqual(egRes.totalTracesFound, 2);
      for (const tr of egRes.traces) {
        const pings = tr.events.filter((e) => e.eventName === "Ping");
        assert.ok(pings.length >= 2, `Expected at least minRep=2 Ping events, got ${pings.length}`);
        // Prefix-closure: occurrences must be [1, 2] or [1, 2, 3]
        const occs = pings.map((p) => p.occurrence).sort((a, b) => a - b);
        for (let i = 0; i < occs.length; i++) {
          assert.strictEqual(occs[i], i + 1);
        }
        const ack = tr.events.find((e) => e.eventName === "Ack");
        assert.ok(ack, "Expected Ack to be included whenever Ping is active");
      }

      // 2. ProvenanceGraph: verifyLineage must reject non-existent root or dangling wasDerivedFrom parent
      const prov = new ProvenanceGraph();
      assert.strictEqual(prov.verifyLineage("NON_EXISTENT").isValid, false);
      prov.addEntity({
        id: "ENT_CHILD",
        type: "SimulationTrace",
        domain: "Modelica",
        version: "1.0",
        timestamp: new Date().toISOString(),
        wasDerivedFrom: ["MISSING_PARENT"],
      });
      assert.strictEqual(prov.verifyLineage("ENT_CHILD").isValid, false);
      prov.addEntity({
        id: "MISSING_PARENT",
        type: "Requirement",
        domain: "SysMLv2",
        version: "1.0",
        timestamp: new Date().toISOString(),
      });
      const validLin = prov.verifyLineage("ENT_CHILD");
      assert.strictEqual(validLin.isValid, true);
      assert.deepStrictEqual(validLin.rootEntities, ["MISSING_PARENT"]);

      // 3. OslcGateway.importHypergraph: must import nodes across all 16 domains (including Safety=10 and Software=15)
      const hg = new DigitalThreadHypergraph();
      const slot = hg.createThread(1);
      hg.bindDomainNode(slot, ThreadDomain.SysML2, 101);
      hg.bindDomainNode(slot, ThreadDomain.Safety, 202);
      hg.bindDomainNode(slot, ThreadDomain.Software, 303);
      const gateway = new OslcGateway("https://oslc.example.com");
      gateway.importHypergraph(hg);
      assert.strictEqual(gateway.getAllArchitectureElements().length, 3);

      // 4. ReqIfParser: signed negative and scientific notation limitValue in both parse() and fromSysML2()
      const sysml = `
        requirement def <REQ_COLD> ColdStartReq {
          doc /* Cold start temperature >= -40.5 */
          attribute limitValue : Real = -40.5;
          attribute comparator : String = ">=";
        }
        requirement def <REQ_LEAK> LeakRateReq {
          doc /* Leak rate <= 1.5e-4 */
          attribute limitValue : Real = 1.5e-4;
          attribute comparator : String = "<=";
        }
      `;
      const parsedFromSysml = ReqIfParser.fromSysML2(sysml);
      assert.strictEqual(parsedFromSysml.requirements.length, 2);
      assert.strictEqual(parsedFromSysml.requirements[0]!.limitValue, -40.5);
      assert.strictEqual(parsedFromSysml.requirements[1]!.limitValue, 1.5e-4);

      const xml = ReqIfParser.emit({
        id: "S1",
        title: "ThermalSpec",
        requirements: [
          {
            id: "REQ_MIN_TEMP",
            name: "MinOperatingTemp",
            text: "Operating temperature minimum -55.0 degC",
            attributes: {},
          },
        ],
      });
      const parsedFromXml = ReqIfParser.parse(xml);
      assert.strictEqual(parsedFromXml.requirements[0]!.limitValue, -55.0);
      assert.strictEqual(parsedFromXml.requirements[0]!.comparator, ">=");
    });

    it("should include assumptions in ChcLowering initial facts, preserve stateEnclosures on BLT cache hits, avoid double-counting AffineForm.mul remainder, and compute 16-domain blast radius", () => {
      // 1. ChcLowering.fromContract: initial fact must include assumptions so step-0 guarantees on inputs hold
      const contractChc = ChcLowering.fromContract({
        name: "VoltageRegulator",
        inputs: ["u"],
        states: ["x"],
        outputs: ["y"],
        init: [
          { expr: { kind: "var", name: "x" }, rel: "==", rhs: 0 },
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "y" },
              right: { kind: "var", name: "u" },
            },
            rel: "==",
            rhs: 0,
          },
        ],
        assumptions: [
          { expr: { kind: "var", name: "u" }, rel: ">=", rhs: 10 },
          { expr: { kind: "var", name: "u" }, rel: "<=", rhs: 12 },
          { expr: { kind: "var", name: "u_prime" }, rel: ">=", rhs: 10 },
          { expr: { kind: "var", name: "u_prime" }, rel: "<=", rhs: 12 },
        ],
        transition: [
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "x_prime" },
              right: { kind: "var", name: "x" },
            },
            rel: "==",
            rhs: 0,
          },
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "y_prime" },
              right: { kind: "var", name: "u_prime" },
            },
            rel: "==",
            rhs: 0,
          },
        ],
        guarantees: [{ expr: { kind: "var", name: "y" }, rel: ">=", rhs: 10 }],
      });
      const spacerRes = new SpacerEngine(contractChc, { maxDepth: 3 }).check();
      assert.strictEqual(spacerRes.status, "SAFE");

      // 2. DaeBltReachabilityEngine: RHS der(x) (`2.0 = der(x)`) and stateEnclosures preserved on second cached verify()
      const arena = new DAEBuilder();
      const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
      const xExpr = arena.addNameExpr("x");
      const derXExpr = arena.addDerExpr(xExpr);
      const twoExpr = arena.addRealLiteral(2.0);
      // Equation: 2.0 = der(x) (der(x) on RHS)
      arena.addEquation(EqKind.Simple, twoExpr, derXExpr);

      const bltEngine = new DaeBltReachabilityEngine(arena, {
        timeHorizon: 1.0,
        initialBounds: new Map([[xIdx, new NumericalInterval(1, 3)]]),
      });
      const bltLayout = {
        blocks: [{ eqIdxs: [0], vars: [xIdx] }],
      } as any;
      const run1 = bltEngine.verify(bltLayout);
      assert.strictEqual(run1.recomputedBlocks, 1);
      assert.ok(run1.stateEnclosures.has(xIdx), "First run must compute stateEnclosures for RHS der(x)");
      const run2 = bltEngine.verify(bltLayout);
      assert.strictEqual(run2.cachedBlocks, 1);
      assert.ok(run2.stateEnclosures.has(xIdx), "Cached second run must preserve stateEnclosures");
      assert.ok(Math.abs(run2.stateEnclosures.get(xIdx)!.low - 1) < 1e-9);
      assert.ok(Math.abs(run2.stateEnclosures.get(xIdx)!.high - 5) < 1e-9);

      // 3. AffineForm.mul: should not double-count this.r * other.r when multiplying forms with remainder
      const affA = new AffineForm(2, new Map(), 1); // 2 +/- 1 -> [1, 3]
      const affB = new AffineForm(3, new Map(), 2); // 3 +/- 2 -> [1, 5]
      const affProd = affA.mul(affB);
      // Exact remainder: |2|*2 + |3|*1 + (0 + 1)*(0 + 2) = 4 + 3 + 2 = 9 (not 9 + 1*2 = 11!)
      assert.strictEqual(affProd.c0, 6);
      assert.strictEqual(affProd.r, 9);

      // 4. BlastRadiusRegressionRunner: 16-domain skippedJobsCount and .reqif / .fmu extension support
      const hg = new DigitalThreadHypergraph();
      const runner = new BlastRadiusRegressionRunner();
      const slot = hg.createThread(1);
      const reqPath = "specs/safety.reqif";
      runner.registerMapping(reqPath, ThreadDomain.Requirements, 501, "SafetySpec");
      hg.bindDomainNode(slot, ThreadDomain.Requirements, 501);
      hg.bindDomainNode(slot, ThreadDomain.Verification, 601);
      const plan = runner.plan(hg, [{ path: reqPath, changeType: "modified" }]);
      assert.strictEqual(plan.staleDomains.length, 2);
      assert.strictEqual(plan.skippedJobsCount, 14); // 16 total domains - 2 stale domains = 14
    });

    it("should seed all 16 domains and avoid alphanumeric nodeId collisions in BrownfieldAlignmentEngine, and track multi-arg Call / IfElse dependencies in DaeBltReachabilityEngine", () => {
      // 1. BrownfieldAlignmentEngine: 16-domain seeding (Safety, Software) and distinct nodeIds for "Motor_01" vs "Pump_01" and "Mtr_00" > 0
      const aligner = new BrownfieldAlignmentEngine({ minConfidence: 0.5 });
      const hg = new DigitalThreadHypergraph();
      const seedRes = aligner.applySeeds(
        [
          {
            sourceId: "Motor_01",
            sourceName: "TractionMotor",
            sourceDomain: "SysML2",
            targetId: "Mtr_00",
            targetName: "TractionMotorSafetyMonitor",
            targetDomain: "Safety",
            confidence: 0.92,
            breakdown: { tokenScore: 0.9, trigramScore: 0.9, structuralScore: 1, acronymBonus: 0.1 },
            reasoning: "Seed alignment",
          },
          {
            sourceId: "Pump_01",
            sourceName: "CoolantPump",
            sourceDomain: "SysML2",
            targetId: "Sw_PumpCtrl_01",
            targetName: "CoolantPumpSoftware",
            targetDomain: "Software",
            confidence: 0.91,
            breakdown: { tokenScore: 0.9, trigramScore: 0.9, structuralScore: 1, acronymBonus: 0.1 },
            reasoning: "Seed alignment",
          },
        ],
        hg,
      );
      // Because "Motor_01" and "Pump_01" must NOT collide onto nodeId=1, 2 distinct threads must be created!
      assert.strictEqual(seedRes.seededCount, 2);
      assert.strictEqual(seedRes.threadsCreated, 2);
      // And "Mtr_00" in Safety (domain 10) and "Sw_PumpCtrl_01" in Software (domain 15) must be bound (> 0)
      assert.ok(hg.getDomainNode(0, ThreadDomain.Safety) > 0, "Expected non-zero Safety nodeId for 'Mtr_00'");
      assert.ok(
        hg.getDomainNode(1, ThreadDomain.Software) > 0,
        "Expected non-zero Software nodeId for 'Sw_PumpCtrl_01'",
      );

      // 2. DaeBltReachabilityEngine: block fingerprint must track variables inside IfElse and multi-arg Call expressions
      const arena = new DAEBuilder();
      const uIdx = arena.addVariable("u", VarType.Real, Variability.Continuous);
      const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);
      const uExpr = arena.addNameExpr("u");
      const yExpr = arena.addNameExpr("y");
      const condExpr = arena.addBoolLiteral(true);
      const zeroExpr = arena.addRealLiteral(0.0);
      // Equation 0: u = 2.0
      arena.addEquation(EqKind.Simple, uExpr, arena.addRealLiteral(2.0));
      // Equation 1: y = if true then u else 0.0 (u is inside IfElse true-branch, left child)
      const ifElseExpr = arena.addIfElseExpr(condExpr, uExpr, zeroExpr);
      arena.addEquation(EqKind.Simple, yExpr, ifElseExpr);

      const bltEngine = new DaeBltReachabilityEngine(arena);
      const layout1 = {
        blocks: [{ eqIdxs: [1], vars: [yIdx] }],
      } as any;

      // First run with u in [1, 2] -> recomputes block 0
      bltEngine.evaluator.setVarBound(uIdx, new NumericalInterval(1, 2));
      const res1 = bltEngine.verify(layout1);
      assert.strictEqual(res1.recomputedBlocks, 1);

      // Second run with identical u in [1, 2] -> hits cache
      const res2 = bltEngine.verify(layout1);
      assert.strictEqual(res2.cachedBlocks, 1);

      // Third run after changing u's bound to [5, 6] -> must invalidate cache for block 0 because y's IfElse depends on u!
      bltEngine.evaluator.setVarBound(uIdx, new NumericalInterval(5, 6));
      const res3 = bltEngine.verify(layout1);
      assert.strictEqual(
        res3.recomputedBlocks,
        1,
        "Changing bound of variable inside IfElse must invalidate BLT block cache",
      );
    });

    it("should compute ISO 26262-5 LFM & exact VOTING_K_OF_N DP in SafetyTheoryOracle, preserve parallel circuits in PowerGridTheoryOracle, check damaged/uplift limits in MarineMooringTheoryOracle, evaluate point-mass bounds in UqTheoryOracle, and avoid alphanumeric collisions in ThreadSerializer", () => {
      // 1. SafetyTheoryOracle: high-coverage single-point fault (dc = 0.995) + covered dual-point faults (dc = 0.95)
      // must achieve actualLfm >= 0.90 (not 1 - 0.995 = 0.005!) and pass ASIL_D
      const safety = new SafetyTheoryOracle(1000);
      safety.registerFailureMode({
        id: "FM_MCU",
        componentName: "MCU",
        modeName: "CoreLockstepFault",
        failureRatePerHour: 1e-9, // 1 FIT
        safetyMechanism: "DualCoreLockstep",
        diagnosticCoverage: 0.995,
      });
      safety.registerFailureMode({
        id: "FM_SENS_A",
        componentName: "SensorA",
        modeName: "Drift",
        failureRatePerHour: 5e-9,
        safetyMechanism: "PlausibilityCheck",
        diagnosticCoverage: 0.95,
      });
      safety.registerFailureMode({
        id: "FM_SENS_B",
        componentName: "SensorB",
        modeName: "Drift",
        failureRatePerHour: 5e-9,
        safetyMechanism: "PlausibilityCheck",
        diagnosticCoverage: 0.95,
      });
      safety.registerFtaNode({
        id: "N_MCU",
        name: "MCU_Fault",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "FM_MCU",
      });
      safety.registerFtaNode({
        id: "N_SA",
        name: "SA_Fault",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "FM_SENS_A",
      });
      safety.registerFtaNode({
        id: "N_SB",
        name: "SB_Fault",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "FM_SENS_B",
      });
      safety.registerFtaNode({
        id: "N_VOTE",
        name: "SensorDualFault",
        gateType: "VOTING_K_OF_N",
        k: 2,
        children: ["N_SA", "N_SB"],
      });
      safety.registerFtaNode({
        id: "N_TOP",
        name: "TopHazard",
        gateType: "OR",
        children: ["N_MCU", "N_VOTE"],
      });
      safety.registerHazard({
        id: "H1",
        name: "UnintendedAcceleration",
        asilLevel: "ASIL_D",
        targetPmhfFit: 10,
        targetSpfm: 0.99,
        targetLfm: 0.9,
        rootNodeId: "N_TOP",
      });
      const safetySat = safety.checkSat();
      assert.strictEqual(safetySat.isSat, true, `Expected ASIL-D compliance, got: ${safetySat.conflict?.explanation}`);

      // Exact VOTING_K_OF_N (2-of-2) where one child has lambda=0 (Q=0) and one has lambda=1 (Q~1): Q_vote must be 0!
      safety.registerFailureMode({
        id: "FM_ZERO",
        componentName: "IdealRef",
        modeName: "NeverFails",
        failureRatePerHour: 0,
      });
      safety.registerFtaNode({
        id: "N_ZERO",
        name: "ZeroEvt",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "FM_ZERO",
      });
      safety.registerFtaNode({
        id: "N_VOTE_HETERO",
        name: "HeteroVote2of2",
        gateType: "VOTING_K_OF_N",
        k: 2,
        children: ["N_SA", "N_ZERO"],
      });
      assert.strictEqual(safety.evaluateNodeUnreliability("N_VOTE_HETERO", 1000), 0);

      // 2. PowerGridTheoryOracle: parallel circuits between bus 1 and bus 2 must not overwrite each other
      const grid = new PowerGridTheoryOracle();
      grid.assertBranchLoading({
        fromBus: 1,
        toBus: 2,
        circuitId: "1",
        actualMva: 120,
        rateMva: 100,
        loadingPercent: 120,
      });
      grid.assertBranchLoading({
        fromBus: 1,
        toBus: 2,
        circuitId: "2",
        actualMva: 60,
        rateMva: 100,
        loadingPercent: 60,
      });
      assert.strictEqual(grid.checkSat().isSat, false, "Overloaded circuit 1 must not be overwritten by circuit 2");

      // 3. MarineMooringTheoryOracle: damaged SF violation without explicit passedDamaged=false
      const mooring = new MarineMooringTheoryOracle();
      mooring.assertMooringLine({
        lineId: "L1",
        mbl: 10000,
        tensionIntact: 5000,
        safetyFactorIntact: 2.0,
        passedIntact: true,
        safetyFactorDamaged: 1.05, // < 1.25 required for Class 2
        consequenceClass: 2,
      });
      assert.strictEqual(mooring.checkSat().isSat, false, "Damaged line SF 1.05 < 1.25 must fail checkSat()");

      // 4. UqTheoryOracle: point-mass normal distribution (stdDev = 0) at threshold must evaluate P(X >= 45) = 1.0
      const uq = new UqTheoryOracle();
      uq.assertLiteral({
        id: 1,
        predicate: "distribution",
        args: ["temp", "normal", 45.0, 0.0],
      });
      uq.assertLiteral({
        id: 2,
        predicate: "probBound",
        args: ["temp", ">=", 45.0, 0.01],
      });
      assert.strictEqual(uq.checkSat().isSat, false, "Point mass at 45.0 has P(temp >= 45.0) = 1.0 > 0.01");

      // 5. DigitalThreadHypergraph & ThreadSerializer: markConflict clears isSynced, and alphanumeric threadIds don't collide
      const hg = new DigitalThreadHypergraph();
      const s0 = hg.createThread(10);
      assert.strictEqual(hg.isSynced(s0), true);
      hg.markConflict(s0);
      assert.strictEqual(hg.isSynced(s0), false);
      assert.strictEqual(hg.getRecord(s0)!.isSynced, false);

      const deserialized = ThreadSerializer.deserialize(
        JSON.stringify({
          "@context": {},
          "@type": "ms:DigitalThreadCollection",
          version: "1.0",
          generatedAt: new Date().toISOString(),
          threads: [
            { threadId: "Thread_A1", revision: 1, status: "synced", domains: { sysml2: "Block_A1", safety: "Haz_00" } },
            {
              threadId: "Thread_B1",
              revision: 1,
              status: "synced",
              domains: { sysml2: "Block_B1", software: "Sw_00" },
            },
          ],
        }),
      );
      assert.strictEqual(
        deserialized.getThreadCount(),
        2,
        "'Thread_A1' and 'Thread_B1' must not collide onto threadId=1",
      );
      assert.ok(deserialized.getDomainNode(0, ThreadDomain.Safety) > 0);
      assert.ok(deserialized.getDomainNode(1, ThreadDomain.Software) > 0);
    });

    it("should handle decision backjumps below assumptionLevel in CdclSatSolver, avoid TseitinEncoder cardinality var collisions, widen FixpointSolver loops at entryBlockId, and evaluate negative powInt in AffineDomain/TaylorDomain", () => {
      // 1. CdclSatSolver: conflict at decision level > assumptionLevel whose learned clause has backtrackLevel < assumptionLevel
      const sat = new CdclSatSolver();
      // Clauses (-2 | 3) and (-2 | -3) force 2 = false via conflict when 2 = true is branched on.
      // Variable 1 is unconstrained by these clauses.
      sat.addClause([-2, 3]);
      sat.addClause([-2, -3]);
      const resUnderAssump = sat.solve([1, 4]);
      assert.strictEqual(resUnderAssump.status, "SAT", "Formula under assumptions [1, 4] must be SAT with 2 = false");
      assert.strictEqual(resUnderAssump.model?.get(1), true);
      assert.strictEqual(resUnderAssump.model?.get(4), true);
      assert.strictEqual(resUnderAssump.model?.get(2), false);

      // 2. TseitinEncoder: encodeAtMostK([1, 2, 3], 1) on a fresh encoder must not collide counter vars with 1, 2, 3
      const enc = new TseitinEncoder();
      const atMost1Clauses = enc.encodeAtMostK([1, 2, 3], 1);
      const cardSat = new CdclSatSolver();
      for (const cl of atMost1Clauses) {
        cardSat.addClause(cl);
      }
      assert.strictEqual(
        cardSat.solve([1, 3]).status,
        "UNSAT",
        "Having both 1 and 3 true must violate AtMost1([1, 2, 3])",
      );
      assert.strictEqual(
        cardSat.solve([1, -2, -3]).status,
        "SAT",
        "Having only 1 true must satisfy AtMost1([1, 2, 3])",
      );

      // 3. GenericCFG.computeRPO & FixpointSolver: unreachable blocks must follow entryBlockId, and loop header at entryBlockId must widen back-edges
      const cfg = new GenericCFG(0);
      const b0 = cfg.createBlock("loop_header_entry");
      const b1 = cfg.createBlock("loop_body");
      const b2 = cfg.createBlock("loop_exit");
      const bDead = cfg.createBlock("unreachable_block");
      assert.strictEqual(b0.id, 0);
      assert.strictEqual(bDead.id, 3);
      b1.instructions.push({
        id: 1,
        opcode: "assign",
        targetVar: "i",
        operands: ["i", "+", 1],
      });
      cfg.addEdge(b0.id, b1.id, "true_branch", "i < 5");
      cfg.addEdge(b0.id, b2.id, "false_branch", "i >= 5");
      cfg.addEdge(b1.id, b0.id, "loop_back");

      const rpo = cfg.computeRPO();
      assert.strictEqual(rpo[0], 0, "Entry block 0 must be first in RPO even when unreachable blocks exist");
      assert.strictEqual(rpo[rpo.length - 1], bDead.id, "Unreachable block must be placed at the end of RPO");

      const initState = ReducedProductState.top();
      initState.intervals.set("i", new NumericalInterval(0, 0));

      const fpSolver = new FixpointSolver(
        cfg,
        (inst, state) => {
          const next = state.clone();
          if (inst.opcode === "assign" && inst.targetVar === "i") {
            const cur = next.intervals.get("i");
            next.intervals.set("i", new NumericalInterval(cur.low + 1, cur.high + 1));
          }
          return next;
        },
        [0, 5, 10],
        20,
        (edge, state) => {
          const next = state.clone();
          const cur = next.intervals.get("i");
          if (edge.conditionExpr === "i < 5") {
            const hi = Math.min(cur.high, 4);
            if (cur.low > hi) return ReducedProductState.bottom();
            next.intervals.set("i", new NumericalInterval(cur.low, hi));
          } else if (edge.conditionExpr === "i >= 5") {
            const lo = Math.max(cur.low, 5);
            if (lo > cur.high) return ReducedProductState.bottom();
            next.intervals.set("i", new NumericalInterval(lo, cur.high));
          }
          return next;
        },
      );
      const fpSummary = fpSolver.solve(initState);
      const headerIn = fpSummary.blockEntryStates.get(b0.id)!.intervals.get("i");
      assert.ok(
        headerIn.low <= 0 && headerIn.high >= 5,
        `Entry loop header must join/widen back-edge up to >= 5, got [${headerIn.low}, ${headerIn.high}]`,
      );
      const exitIn = fpSummary.blockEntryStates.get(b2.id)!.intervals.get("i");
      assert.strictEqual(
        exitIn.isBottom(),
        false,
        "Loop exit block must be reachable after widening entry loop header",
      );

      // 4. AffineDomain.powInt and TaylorDomain.powInt for negative integer exponent n = -2
      const affDom = new AffineDomain();
      const xAff = affDom.fromInterval(new Interval(2, 4));
      const invSqAff = affDom.toInterval(affDom.powInt(xAff, -2));
      assert.ok(
        invSqAff.lo <= 1 / 16 && invSqAff.hi >= 1 / 4,
        `Affine powInt([2, 4], -2) must enclose [0.0625, 0.25], got [${invSqAff.lo}, ${invSqAff.hi}]`,
      );

      const boxes = [new Interval(2, 4)];
      const tmDom = new TaylorDomain(boxes, 3);
      const xTm = TaylorModel.variable(0, 1, boxes, 3);
      const invSqTm = tmDom.toInterval(tmDom.powInt(xTm, -2));
      assert.ok(
        invSqTm.lo <= 1 / 16 && invSqTm.hi >= 1 / 4,
        `Taylor powInt([2, 4], -2) must enclose [0.0625, 0.25], got [${invSqTm.lo}, ${invSqTm.hi}]`,
      );
    });
  });
});
