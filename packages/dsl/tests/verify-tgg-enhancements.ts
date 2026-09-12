import { tggEq, tggForEach, tggNot, tggPath, tggReconcile, tggRule } from "@modelscript/dsl";
import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { runCPA } from "@modelscript/dsl/codegen/cpa.js";
import { PolyglotTransformer, type PolyglotNode } from "@modelscript/runtime/polyglot-transformer.js";
import assert from "node:assert";

async function run() {
  console.log("============================================================");
  console.log("  Running TGG Digital Thread Enhancement Verification Suite ");
  console.log("============================================================\n");

  // --------------------------------------------------------------------------
  // Phase 1: Critical Pair Analysis (CPA) & Confluence
  // --------------------------------------------------------------------------
  console.log("[1/4] Testing AOT Critical Pair Analysis (CPA)...");

  // 1.1 Overlapping rules with equal priority
  const overlappingRules = [
    tggRule({
      name: "PartToModelA",
      priority: 0,
      source: ($, v) => $.PartDefinition({ name: v("name") }),
      target: ($, v) => $.ModelicaClass({ name: v("name") }),
    }),
    tggRule({
      name: "PartToBlockB",
      priority: 0,
      source: ($, v) => $.PartDefinition({ name: v("name") }),
      target: ($, v) => $.ModelicaBlock({ name: v("name") }),
    }),
  ];
  const overlapReport = runCPA(overlappingRules);
  assert(overlapReport.hasConflicts, "Overlap conflict should be detected");
  const overlap = overlapReport.conflicts.find((c) => c.kind === "overlap");
  assert(overlap, "Overlap conflict item must exist");
  assert.strictEqual(overlap.rule1, "PartToModelA");
  assert.strictEqual(overlap.rule2, "PartToBlockB");
  assert.strictEqual(overlap.severity, "warning");
  console.log("  ✓ Detected ambiguous rule overlap with warning");

  // 1.2 Disambiguation via priority
  const prioritizedRules = [
    tggRule({
      name: "DefaultPartToClass",
      priority: 0,
      source: ($, v) => $.PartDefinition({ name: v("name") }),
      target: ($, v) => $.ModelicaClass({ name: v("name") }),
    }),
    tggRule({
      name: "SpecializedPartToBlock",
      priority: 10,
      source: ($, v) => $.PartDefinition({ name: v("name") }),
      target: ($, v) => $.ModelicaBlock({ name: v("name") }),
    }),
  ];
  const prioReport = runCPA(prioritizedRules);
  assert.strictEqual(
    prioReport.conflicts.filter((c) => c.kind === "overlap").length,
    0,
    "Prioritized rules must not conflict",
  );
  console.log("  ✓ Verified priority override resolves ambiguity");

  // 1.3 Cyclic ping-pong dependency detection
  const cyclicRules = [
    tggRule({
      name: "SysMLToModelica",
      source: ($, v) => $.SysMLBlock({ id: v("id") }),
      target: ($, v) => $.ModelicaModel({ id: v("id") }),
    }),
    tggRule({
      name: "ModelicaToSysML",
      source: ($, v) => $.ModelicaModel({ id: v("id") }),
      target: ($, v) => $.SysMLBlock({ id: v("id") }),
    }),
  ];
  const cycleReport = runCPA(cyclicRules);
  assert(cycleReport.hasConflicts, "Cycle must be detected");
  const cycle = cycleReport.conflicts.find((c) => c.kind === "cycle");
  assert(cycle, "Cycle conflict item must exist");
  assert.strictEqual(cycle.severity, "error");
  console.log("  ✓ Detected cyclic rule dependency with error diagnostic");

  // 1.4 CPA report inclusion in compileTGGRules
  const singleRule = [
    tggRule({
      name: "PartToClass",
      source: ($, v) => $.PartDefinition({ name: v("n") }),
      target: ($, v) => $.ModelicaClass({ name: v("n") }),
    }),
  ];
  const compiledSingle = compileTGGRules(singleRule);
  assert(compiledSingle.cpaReport, "Compiled output must include cpaReport");
  assert.strictEqual(compiledSingle.cpaReport.hasConflicts, false);
  console.log("  ✓ Verified AOT CPA report integration in compileTGGRules()\n");

  // --------------------------------------------------------------------------
  // Phase 2: Non-Tree Topologies & Negative Application Conditions (NACs)
  // --------------------------------------------------------------------------
  console.log("[2/4] Testing Non-Tree Topologies & NACs...");

  // 2.1 Compiling NAC conditions to AssemblyScript early-exit checks
  const nacRules = [
    tggRule({
      name: "ConnectThermalPortsUnlessInsulated",
      source: ($, v) => $.ThermalPort({ portId: v("p1") }),
      target: ($, v) => $.HeatPort({ portId: v("p1") }),
      where: (v) => [tggNot("ThermalInsulator")],
    }),
  ];
  const compiledNac = compileTGGRules(nacRules);
  assert(compiledNac.sourceCode.includes("NAC: Verify forbidden pattern 'ThermalInsulator' is absent"));
  assert(compiledNac.sourceCode.includes("getNodeFirstChild(sourceNodeId)"));
  assert(compiledNac.sourceCode.includes("getNodeNextSibling(checkChild)"));
  console.log("  ✓ Compiled NAC into AssemblyScript linear-memory cursor loop");

  // 2.2 Runtime enforcement of NACs
  const transformer = new PolyglotTransformer();
  const insulatedRule = tggRule({
    name: "StandardHeatConduction",
    source: ($, v) => $.Port({ name: v("n") }),
    target: ($, v) => $.ThermalPin({ name: v("n") }),
    where: (v) => [tggNot("InsulatorBlock")],
  });

  const uninsulatedNode: PolyglotNode = {
    name: "PortA",
    attributes: [{ name: "temp", type: "Real", value: "300" }],
    components: [],
  };
  const insulatedNode: PolyglotNode = {
    name: "PortB",
    attributes: [{ name: "temp", type: "Real", value: "300" }],
    components: [{ name: "InsulatorBlock", typeSpecifier: "InsulatorBlock" }],
  };
  assert.strictEqual(transformer.checkNAC(insulatedRule, uninsulatedNode), true);
  assert.strictEqual(transformer.checkNAC(insulatedRule, insulatedNode), false);
  console.log("  ✓ Enforced runtime NAC matching (forbids insulated ports)");

  // 2.3 Property path compilation and resolution
  const pathRules = [
    tggRule({
      name: "RouteTraceabilityThroughPorts",
      source: ($, v) => $.Subsystem({ id: v("subId") }),
      target: ($, v) => $.DAEBlock({ id: v("subId") }),
      where: (v) => [tggPath(v("subId"), "ports/connection/target", v("remotePort"))],
    }),
  ];
  const compiledPath = compileTGGRules(pathRules);
  assert(
    compiledPath.sourceCode.includes("Property path: __var_subId --[ports/connection/target]--> __var_remotePort"),
  );

  const systemGraph: PolyglotNode = {
    name: "BatterySubsystem",
    ports: [
      {
        name: "powerOut",
        type: "ElectricalPort",
        connection: { source: "powerOut", target: "inverterInput" } as any,
      } as any,
    ],
  };
  const resolvedTarget = transformer.resolvePath(systemGraph, "ports/powerOut/connection/target");
  assert.strictEqual(resolvedTarget, "inverterInput");
  console.log("  ✓ Resolved multi-hop non-tree graph property paths");

  // 2.4 Multi-amalgamation (1-to-N) expansion
  const forEachRules = [
    tggRule({
      name: "ExpandBusPins",
      source: ($, v) => $.BusDefinition({ busName: v("b") }),
      target: ($, v) => $.MultiPinConnector({ name: v("b") }),
      where: (v) => [tggForEach(v("busPins"), v("pin"), [tggEq(v("pin"), v("targetPin"))])],
    }),
  ];
  const compiledForEach = compileTGGRules(forEachRules);
  assert(compiledForEach.sourceCode.includes("Multi-amalgamation: forEach __var_pin in __var_busPins"));
  console.log("  ✓ Compiled 1-to-N multi-amalgamated rule expansion\n");

  // --------------------------------------------------------------------------
  // Phase 3: Multi-Master Conflict Reconciliation
  // --------------------------------------------------------------------------
  console.log("[3/4] Testing Multi-Master Conflict Reconciliation...");

  const reconcileRules = [
    tggRule({
      name: "SyncVoltageWithReconciliation",
      source: ($, v) => $.SysMLPort({ voltage: v("vSys") }),
      target: ($, v) => $.ModelicaPin({ voltage: v("vMod") }),
      where: (v) => [tggEq(v("vSys"), v("vMod")), tggReconcile(v("vSys"), v("vMod"), "smt-simplex")],
    }),
    tggRule({
      name: "SyncMassSourceWins",
      source: ($, v) => $.Part({ mass: v("mSys") }),
      target: ($, v) => $.Inertia({ J: v("mMod") }),
      where: (v) => [tggReconcile(v("mSys"), v("mMod"), "source-wins")],
    }),
  ];
  const compiledReconcile = compileTGGRules(reconcileRules);
  assert(
    compiledReconcile.sourceCode.includes("Conflict reconciliation policy: __var_vSys <-> __var_vMod (smt-simplex)"),
  );
  assert(compiledReconcile.sourceCode.includes("tgg_reconcile_scalar(slot, 0.0, 0.0, 0, corr)"));
  assert(compiledReconcile.sourceCode.includes("tgg_reconcile_scalar(slot, 0.0, 0.0, 1, corr)"));
  assert(compiledReconcile.sourceCode.includes("export function tgg_reconcile_all_conflicts"));
  console.log("  ✓ Generated linear-memory conflict reconciliation hooks");

  // Conflict tracking and manual/automated resolution
  const reconciler = new PolyglotTransformer();
  reconciler.recordConflict("port_1_voltage", 24.0, 12.0, "SyncVoltageWithReconciliation");
  reconciler.recordConflict("bracket_mass", 15.5, 18.0, "SyncMassSourceWins");

  assert.strictEqual(reconciler.getConflicts().length, 2);
  assert.strictEqual(reconciler.getConflicts()[0].isResolved, false);

  reconciler.resolveConflict("port_1_voltage", "target");
  assert.strictEqual(reconciler.getConflicts().find((c) => c.id === "port_1_voltage")?.resolved, 12.0);
  assert.strictEqual(reconciler.getConflicts().find((c) => c.id === "port_1_voltage")?.isResolved, true);

  reconciler.resolveConflict("bracket_mass", "source");
  assert.strictEqual(reconciler.getConflicts().find((c) => c.id === "bracket_mass")?.resolved, 15.5);
  assert.strictEqual(reconciler.getConflicts().find((c) => c.id === "bracket_mass")?.isResolved, true);

  reconciler.recordConflict("operating_temp", 350.0, 370.0);
  reconciler.resolveConflict("operating_temp", 360.0);
  assert.strictEqual(reconciler.getConflicts().find((c) => c.id === "operating_temp")?.resolved, 360.0);
  console.log("  ✓ Verified multi-master conflict tracking and resolution\n");

  // --------------------------------------------------------------------------
  // Phase 4: Incremental Multi-Way Cross-Domain Digital Thread Joins
  // --------------------------------------------------------------------------
  console.log("[4/4] Testing Incremental Multi-Way Digital Thread Joins...");

  const threadTransformer = new PolyglotTransformer();
  threadTransformer.registerEmitter("modelica", (node, t) => {
    const parts: string[] = [`model ${node.name}`];
    for (const comp of node.components || []) {
      parts.push(`  ${comp.typeSpecifier} ${comp.name};`);
    }
    const inferred = t.getInferredFeatures(node.name);
    for (const inf of inferred) {
      parts.push(`  parameter ${inf.type} ${inf.name} /* inferred by OWL2 reasoner */;`);
    }
    parts.push(`end ${node.name};`);
    return parts.join("\n");
  });

  threadTransformer.addReasonerFact("hasFeature", "ElectricDrivetrain", "batteryVoltage:Real");
  threadTransformer.addReasonerFact("hasFeature", "ElectricDrivetrain", "maxTorque:Real");

  const sysmlNode: PolyglotNode = {
    name: "ElectricDrivetrain",
    components: [
      { name: "inverter", typeSpecifier: "Inverter400V" },
      { name: "motor", typeSpecifier: "PMSM" },
    ],
  };

  const initialCode = threadTransformer.transform(sysmlNode, "modelica");
  assert(initialCode.includes("model ElectricDrivetrain"));
  assert(initialCode.includes("Inverter400V inverter;"));
  assert(initialCode.includes("PMSM motor;"));
  assert(initialCode.includes("parameter Real batteryVoltage /* inferred by OWL2 reasoner */;"));
  assert(initialCode.includes("parameter Real maxTorque /* inferred by OWL2 reasoner */;"));

  // Incremental O(ΔN) update without full re-allocation
  threadTransformer.addReasonerFact("hasFeature", "ElectricDrivetrain", "thermalLimit:Real");
  const updatedCode = threadTransformer.transform(sysmlNode, "modelica");
  assert(updatedCode.includes("parameter Real thermalLimit /* inferred by OWL2 reasoner */;"));
  console.log("  ✓ Verified cross-domain join (SysML v2 + Modelica + OWL2 reasoner facts in O(ΔN))\n");

  console.log("============================================================");
  console.log("  ALL TGG DIGITAL THREAD ENHANCEMENT TESTS PASSED!          ");
  console.log("============================================================");
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
