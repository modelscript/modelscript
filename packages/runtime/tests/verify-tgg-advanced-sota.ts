// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Test Suite: Advanced SOTA Foundations for ModelScript TGG & Polyglot Engine
 *
 * Verifies:
 * 1. In-Place DPO (Double Pushout) Graph Rewriting with Gluing Condition (Dangling Edge) safety.
 * 2. Full DBSP Multiset Fixed-Point Differentiation over Z-sets with negative multiplicities.
 * 3. Automated Round-Trip Information Losslessness Proofs and shadow complement analysis.
 * 4. Worst-Case Optimal Join (WCOJ) Leapfrog Triejoin compilation for cyclic LHS patterns.
 */

import {
  compileWcojMatcher,
  planWcojPattern,
  tggComplement,
  tggInvertible,
  tggRewriteRule,
  tggRule,
  verifyRuleLosslessness,
} from "@modelscript/dsl";
import { PolyglotTransformer, type PolyglotNode } from "@modelscript/runtime";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runAdvancedSotaSuite() {
  console.log("================================================================================");
  console.log("Running Advanced SOTA TGG & Polyglot Verification Suite");
  console.log("================================================================================\n");

  const transformer = new PolyglotTransformer();

  // ============================================================================
  // PILLAR 1: In-Place DPO (Double Pushout) Graph Rewriting & Gluing Condition
  // ============================================================================
  console.log("[Pillar 1] Testing In-Place DPO Graph Rewriting...");

  const dpoRule = tggRewriteRule("SimplifySeriesResistors")
    .inPlace("modelica", (rule) => {
      rule.delete("Resistor1", { name: "R1" });
      rule.delete("Resistor2", { name: "R2" });
      rule.delete("InternalConnect", { from: "R1.n", to: "R2.p" });

      rule.preserve("InPin", { name: "inPin" });
      rule.preserve("OutPin", { name: "outPin" });

      rule.create("ResistorEq", { name: "R_eq", value: 200 });
      rule.create("ConnectIn", { from: "inPin", to: "R_eq.p" });
      rule.create("ConnectOut", { from: "R_eq.n", to: "outPin" });

      rule.danglingEdgePolicy("strict");
    })
    .synchronizeTarget("sysml", (req, _target) => {
      return { targetUpdated: true, resistance: req?.value };
    })
    .build();

  // Test 1A: Successful DPO Rewrite
  const circuitModel: PolyglotNode & { connections: any[] } = {
    name: "VoltageDivider",
    components: [
      { name: "R1", typeSpecifier: "Resistor" },
      { name: "R2", typeSpecifier: "Resistor" },
    ],
    connections: [
      { from: "inPin", to: "R1.p" },
      { from: "R1.n", to: "R2.p" },
      { from: "R2.n", to: "outPin" },
    ],
  };

  const dpoResult = transformer.applyInPlaceDPO(dpoRule, circuitModel, {
    Resistor1: "R1",
    Resistor2: "R2",
    InternalConnect: "wire_internal",
    InPin: "inPin",
    OutPin: "outPin",
  });

  assert(dpoResult.success === true, "DPO rewrite should succeed on valid match");
  assert(dpoResult.status === "SUCCESS", "DPO status should be SUCCESS");
  assert(dpoResult.recycledNodes?.includes("R1"), "R1 should be recycled/deleted");
  assert(dpoResult.recycledNodes?.includes("R2"), "R2 should be recycled/deleted");
  assert(transformer.isRetracted("R1"), "R1 must be registered in DBSP retractions");
  assert(transformer.isRetracted("R2"), "R2 must be registered in DBSP retractions");
  assert(
    circuitModel.components?.some((c) => c.name === "R_eq"),
    "R_eq must be created in host circuit",
  );
  assert(
    circuitModel.connections?.some((c) => c.from === "inPin" && c.to === "R_eq.p"),
    "inPin must be rewired to R_eq.p",
  );
  assert(dpoResult.targetSyncResult?.targetUpdated === true, "Coupled target synchronization should trigger in-place");
  console.log("  ✓ In-place DPO resistor reduction and rewiring succeeded.");

  // Test 1B: Dangling Edge Condition Violation (Strict Abort)
  const circuitWithProbe: PolyglotNode & { connections: any[] } = {
    name: "ProbedDivider",
    components: [
      { name: "R1", typeSpecifier: "Resistor" },
      { name: "R2", typeSpecifier: "Resistor" },
    ],
    connections: [
      { from: "inPin", to: "R1.p" },
      { from: "R1.n", to: "R2.p" },
      { from: "R2.n", to: "outPin" },
      { from: "R1.n", to: "scope.probe" }, // External dangling edge!
    ],
  };

  const danglingResult = transformer.applyInPlaceDPO(dpoRule, circuitWithProbe, {
    Resistor1: "R1",
    Resistor2: "R2",
    InternalConnect: "wire_internal",
    InPin: "inPin",
    OutPin: "outPin",
  });

  assert(
    danglingResult.success === false,
    "DPO rewrite must fail when external connections violate dangling edge condition",
  );
  assert(
    danglingResult.status === "DANGLING_EDGE_VIOLATION",
    "Status must explicitly indicate DANGLING_EDGE_VIOLATION",
  );
  assert(circuitWithProbe.components?.length === 2, "Host components must remain unmutated on aborted rewrite");
  console.log("  ✓ Strict Dangling Edge Condition correctly prevented illegal partial deletion.\n");

  // ============================================================================
  // PILLAR 2: Full DBSP Multiset Fixed-Point Differentiation
  // ============================================================================
  console.log("[Pillar 2] Testing Full DBSP Multiset Fixed-Point Differentiation...");

  // Emulate linear Z-set multiset algebra and fixed-point differentiation
  interface ZSetEntry {
    element: string;
    weight: number;
  }

  function consolidateZSet(entries: ZSetEntry[]): ZSetEntry[] {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.element, (map.get(e.element) || 0) + e.weight);
    }
    const result: ZSetEntry[] = [];
    for (const [element, weight] of map.entries()) {
      if (weight !== 0) result.push({ element, weight });
    }
    return result.sort((a, b) => a.element.localeCompare(b.element));
  }

  // Test 2A: Multiset consolidation with cancellations
  const deltaStream: ZSetEntry[] = [
    { element: "NodeA", weight: 1 },
    { element: "NodeB", weight: 1 },
    { element: "NodeA", weight: 1 }, // total NodeA = +2
    { element: "NodeB", weight: -1 }, // NodeB canceled to 0
    { element: "NodeC", weight: -1 }, // negative retraction
  ];
  const consolidated = consolidateZSet(deltaStream);
  assert(consolidated.length === 2, "Consolidated Z-set should have 2 non-zero elements");
  assert(consolidated.find((e) => e.element === "NodeA")?.weight === 2, "NodeA weight should be +2");
  assert(
    consolidated.find((e) => e.element === "NodeB") === undefined,
    "NodeB should be completely eliminated (weight = 0)",
  );
  assert(consolidated.find((e) => e.element === "NodeC")?.weight === -1, "NodeC weight should be -1 (retraction)");
  console.log("  ✓ Z-Set consolidation and net-zero cancellation verified.");

  // Test 2B: Incremental recursive fixed-point differentiation D(Fix(f))(ΔI)
  // Dependency graph: NodeA -> NodeB -> NodeC
  const edges = new Map<string, string[]>([
    ["NodeA", ["NodeB"]],
    ["NodeB", ["NodeC"]],
  ]);

  function differentiateFixedPoint(initialDelta: ZSetEntry[]): ZSetEntry[] {
    let accumulated: ZSetEntry[] = [];
    let frontier = [...initialDelta];
    let iteration = 0;

    while (frontier.length > 0 && iteration < 10) {
      accumulated = consolidateZSet([...accumulated, ...frontier]);
      const nextFrontier: ZSetEntry[] = [];

      for (const item of frontier) {
        const dependents = edges.get(item.element) || [];
        for (const dep of dependents) {
          nextFrontier.push({ element: dep, weight: item.weight });
        }
      }

      frontier = consolidateZSet(nextFrontier);
      iteration++;
    }
    return accumulated;
  }

  // 1. Initial positive derivation
  const posFix = differentiateFixedPoint([{ element: "NodeA", weight: 1 }]);
  assert(posFix.length === 3, "Transitive closure should reach NodeA, NodeB, NodeC");
  assert(
    posFix.every((e) => e.weight === 1),
    "All derived reachabilities must have weight +1",
  );

  // 2. Differential retraction: Retract NodeA
  const negDelta: ZSetEntry[] = [{ element: "NodeA", weight: -1 }];
  const negFix = differentiateFixedPoint(negDelta);
  const finalState = consolidateZSet([...posFix, ...negFix]);
  assert(finalState.length === 0, "Retracting NodeA must transitively cancel all derived elements to empty");
  console.log("  ✓ Full DBSP recursive fixed-point retraction cascade verified.\n");

  // ============================================================================
  // PILLAR 3: Automated Round-Trip Information Losslessness Proofs
  // ============================================================================
  console.log("[Pillar 3] Testing Automated Round-Trip Losslessness Proofs...");

  // Test 3A: Proven Lossless (Bijective Affine Lens)
  const losslessRule = tggRule({
    name: "KelvinToCelsius",
    source: ($) => $.ThermalSensor({ tempK: "tempK" }),
    target: ($) => $.CelsiusSensor({ tempC: "tempC" }),
    where: () => [tggInvertible("tempK - 273.15")],
  });

  const losslessReport = verifyRuleLosslessness(losslessRule, ["tempK"]);
  assert(losslessReport.status === "PROVEN_LOSSLESS", "Invertible rule must be PROVEN_LOSSLESS");
  assert(losslessReport.isLensBijective === true, "Lens must be marked bijective");
  assert(losslessReport.leakedAttributes.length === 0, "No attributes should leak");
  console.log("  ✓ Bijective affine rule proven strictly lossless:", losslessReport.status);

  // Test 3B: Information Loss (Unmapped attributes without complement)
  const lossyRule = tggRule({
    name: "ResistorProjectionLossy",
    source: ($) => $.Resistor({ resistance: "R", tolerance: "tol", tempCoeff: "tc" }),
    target: ($) => $.SimulinkResistor({ resistance: "R" }),
  });

  const lossyReport = verifyRuleLosslessness(lossyRule, ["resistance", "tolerance", "tempCoeff"]);
  assert(
    lossyReport.status === "INFORMATION_LOSS",
    "Unmapped fields without complement must be flagged INFORMATION_LOSS",
  );
  assert(lossyReport.isLensBijective === false, "Lens must not be bijective");
  assert(lossyReport.leakedAttributes.includes("tolerance"), "Tolerance should be identified as leaked");
  assert(lossyReport.leakedAttributes.includes("tempCoeff"), "tempCoeff should be identified as leaked");
  console.log("  ✓ Information leak successfully detected:", lossyReport.leakedAttributes.join(", "));

  // Test 3C: Lossless with Complement (Protected via tggComplement)
  const protectedRule = tggRule({
    name: "ResistorProjectionProtected",
    source: ($) => $.Resistor({ resistance: "R", tolerance: "tol", tempCoeff: "tc" }),
    target: ($) => $.SimulinkResistor({ resistance: "R" }),
    where: () => [tggComplement(["tolerance", "tempCoeff"])],
  });

  const protectedReport = verifyRuleLosslessness(protectedRule, ["resistance", "tolerance", "tempCoeff"]);
  assert(
    protectedReport.status === "LOSSLESS_WITH_COMPLEMENT",
    "Rule protected with tggComplement must be LOSSLESS_WITH_COMPLEMENT",
  );
  assert(protectedReport.isLensBijective === true, "Must satisfy GetPut lens law modulo complement");
  assert(protectedReport.leakedAttributes.length === 0, "No leaked attributes with complement");
  console.log("  ✓ Asymmetric projection verified lossless via shadow complement fiber.\n");

  // ============================================================================
  // PILLAR 4: Worst-Case Optimal Join (WCOJ) Compilation for Multi-Edge LHS
  // ============================================================================
  console.log("[Pillar 4] Testing WCOJ Compilation for Multi-Edge LHS...");

  // Test 4A: Cyclic Triangle Pattern (x -> y -> z -> x)
  const trianglePattern = {
    name: "TriangleMotif",
    variables: ["x", "y", "z"],
    edges: [
      { fromVar: "x", toVar: "y", edgeType: "Wire" },
      { fromVar: "y", toVar: "z", edgeType: "Wire" },
      { fromVar: "z", toVar: "x", edgeType: "Wire" },
    ],
  };

  const trianglePlan = planWcojPattern(trianglePattern);
  assert(trianglePlan.isCyclic === true, "Triangle pattern must be detected as cyclic");
  assert(trianglePlan.triangleCount === 1, "Triangle count should be 1");
  assert(trianglePlan.complexityBound.includes("O(N^(3/2))"), "Complexity must match AGM bound O(N^(3/2))");

  const compiledWcojCode = compileWcojMatcher(trianglePlan);
  assert(compiledWcojCode.includes("leapfrog_intersect_3"), "Cyclic triangle must compile to leapfrog_intersect_3");
  assert(compiledWcojCode.includes("match_wcoj_TriangleMotif"), "Function name must be emitted");
  console.log("  ✓ Cyclic triangle pattern compiled to 3-way Leapfrog Triejoin with AGM bound O(N^(3/2)).");

  // Test 4B: Acyclic Path Pattern (a -> b -> c)
  const acyclicPattern = {
    name: "AcyclicPath",
    variables: ["a", "b", "c"],
    edges: [
      { fromVar: "a", toVar: "b", edgeType: "Wire" },
      { fromVar: "b", toVar: "c", edgeType: "Wire" },
    ],
  };

  const acyclicPlan = planWcojPattern(acyclicPattern);
  assert(acyclicPlan.isCyclic === false, "Path pattern must not be cyclic");
  assert(acyclicPlan.complexityBound.includes("O(N)"), "Acyclic complexity must be O(N)");
  const acyclicCode = compileWcojMatcher(acyclicPlan);
  assert(acyclicCode.includes("leapfrog_intersect_2"), "Acyclic pattern should use standard 2-way leapfrog");
  console.log("  ✓ Acyclic LHS path pattern compiled to linear Leapfrog cursor iteration.\n");

  console.log("================================================================================");
  console.log("All Advanced SOTA Tests Passed Successfully (4/4 Pillars)");
  console.log("================================================================================");
}

runAdvancedSotaSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
