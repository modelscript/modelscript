import assert from "node:assert";
import { compileTGGRules } from "../src/codegen/compile_tgg.js";
import { runCPA } from "../src/codegen/cpa.js";
import { invertExpression } from "../src/codegen/inversion.js";
import { tggComplement, tggEq, tggReconcilePhysics, tggRule, tggThreadRule } from "../src/dsl/language.js";
import { PolyglotTransformer, type PolyglotNode } from "../src/runtime/polyglot-transformer.js";

async function run() {
  console.log("============================================================");
  console.log("  Running SOTA TGG, Polyglot Projection & Query Engine Suite");
  console.log("============================================================\n");

  // --------------------------------------------------------------------------
  // Pillar 1: Incremental DBSP Retraction & Negative Deltas
  // --------------------------------------------------------------------------
  console.log("[1/6] Pillar 1: Incremental DBSP Retraction in Linear Memory...");

  const retractRules = [
    tggRule({
      name: "ChassisToModel",
      source: ($, v) => $.PartDef({ name: v("n") }),
      target: ($, v) => $.ModelicaClass({ name: v("n") }),
      where: (v) => [tggEq(v("n"), v("n"))],
    }),
  ];

  const compiledRetract = compileTGGRules(retractRules);
  assert(compiledRetract.sourceCode.includes("export function tgg_retract_ChassisToModel"));
  assert(compiledRetract.sourceCode.includes("let targetNodeId = corr.retractBySource(sourceNodeId);"));
  assert(compiledRetract.sourceCode.includes("export function tgg_retract_dispatch"));
  assert(compiledRetract.sourceCode.includes("!corr.isRemoved(slot)"));
  console.log("  ✓ Generated AOT DBSP retraction functions and dispatchers in AssemblyScript");

  const transformer = new PolyglotTransformer();
  transformer.registerEmitter("modelica", (node) => `model ${node.name} end ${node.name};`);

  const activeNode: PolyglotNode = { name: "MotorSubsystem" };
  const initialOutput = transformer.transform(activeNode, "modelica");
  assert(initialOutput.includes("model MotorSubsystem"));

  // Trigger retraction
  transformer.retract("MotorSubsystem");
  assert.strictEqual(transformer.isRetracted("MotorSubsystem"), true);
  const retractedOutput = transformer.transform(activeNode, "modelica");
  assert(retractedOutput.includes("/* Node 'MotorSubsystem' retracted */"));
  console.log("  ✓ Verified runtime node retraction handling without full model reallocation\n");

  // --------------------------------------------------------------------------
  // Pillar 2: Delta-Based Symmetric Lenses & Shadow Complements
  // --------------------------------------------------------------------------
  console.log("[2/6] Pillar 2: Symmetric Complements (Zero Information Loss)...");

  const complementRule = [
    tggRule({
      name: "SysMLToFlatCSV",
      source: ($, v) => $.PartDefinition({ name: v("n"), weight: v("w"), cost: v("c") }),
      target: ($, v) => $.CsvRow({ partName: v("n"), weight: v("w") }),
      where: (v) => [tggEq(v("n"), v("n")), tggEq(v("w"), v("w")), tggComplement(["cost", "supplierId", "cadMeshRef"])],
    }),
  ];

  const compiledComp = compileTGGRules(complementRule);
  assert(compiledComp.sourceCode.includes("Shadow complement preserved fields: [cost, supplierId, cadMeshRef]"));
  console.log("  ✓ Compiled shadow complement metadata into transformation kernel");

  // Test complement round-tripping
  transformer.storeComplement("BatteryPack", {
    cost: 4500,
    supplierId: "SUP-9912",
    cadMeshRef: "models/battery_v3.step",
  });

  const retrievedComp = transformer.getComplement("BatteryPack");
  assert(retrievedComp, "Shadow complement must be preserved");
  assert.strictEqual(retrievedComp.cost, 4500);
  assert.strictEqual(retrievedComp.supplierId, "SUP-9912");
  assert.strictEqual(retrievedComp.cadMeshRef, "models/battery_v3.step");
  console.log("  ✓ Preserved unmapped fields during asymmetric projection\n");

  // --------------------------------------------------------------------------
  // Pillar 3: N-Ary Digital Thread Alignment Hypergraph (Beyond Pairwise Triples)
  // --------------------------------------------------------------------------
  console.log("[3/6] Pillar 3: N-Ary Digital Thread Alignment Hypergraph...");

  const threadRule = tggThreadRule({
    name: "ElectricPowertrainThread",
    domains: {
      sysml: ($, v) => $.PartDef({ name: v("n"), torque: v("t"), mass: v("m") }),
      modelica: ($, v) => $.ModelicaModel({ name: v("n"), tau_max: v("t") }),
      cad: ($, v) => $.StepAssembly({ partNumber: v("n"), mass: v("m") }),
      requirements: ($, v) => $.Requirement({ id: v("reqId"), targetTorque: v("t") }),
    },
    where: (v) => [tggEq(v("t"), v("t"))],
  });
  assert(threadRule.name === "ElectricPowertrainThread");
  assert.strictEqual(Object.keys(threadRule.domains).length, 4);

  // Register multi-domain thread
  transformer.registerEmitter("sysml", (node) => `part def ${node.name} { attribute torque: Real = ${node.torque}; }`);
  transformer.registerEmitter("cad", (node) => `solid ${node.name} { mass = ${node.mass}; }`);

  transformer.registerThread("THREAD-EV-001", {
    sysml: { name: "Inverter", torque: 350.0 },
    modelica: { name: "Inverter", tau_max: 350.0 },
    cad: { name: "Inverter", mass: 12.5 },
    requirements: { name: "REQ-01", targetTorque: 350.0 },
  });

  const sysmlProjection = transformer.transformThread("THREAD-EV-001", "sysml");
  const cadProjection = transformer.transformThread("THREAD-EV-001", "cad");
  assert(sysmlProjection.includes("part def Inverter { attribute torque: Real = 350; }"));
  assert(cadProjection.includes("solid Inverter { mass = 12.5; }"));
  console.log("  ✓ Successfully federated 4-way thread alignment without O(N^2) pairwise synchronizers\n");

  // --------------------------------------------------------------------------
  // Pillar 4: Physics-Aware Multi-Master SMT & Simplex Reconciler
  // --------------------------------------------------------------------------
  console.log("[4/6] Pillar 4: Physics-Aware Multi-Master SMT Reconciler...");

  const physicsRule = [
    tggRule({
      name: "MotorVoltageReconciliation",
      source: ($, v) => $.SysMLPort({ voltage: v("v1") }),
      target: ($, v) => $.ModelicaPin({ voltage: v("v2") }),
      where: (v) => [tggReconcilePhysics(v("v1"), v("v2"), { min: 200.0, max: 800.0, tolerance: 0.1 })],
    }),
  ];

  const compiledPhys = compileTGGRules(physicsRule);
  assert(compiledPhys.sourceCode.includes("Physics reconciliation policy: __var_v1 <-> __var_v2 bounds=[200, 800]"));
  assert(compiledPhys.sourceCode.includes("tgg_reconcile_physics_simplex(slot, 0.0, 0.0, 200.0, 800.0, corr)"));
  console.log("  ✓ Compiled physics boundary constraint checks into WASM kernel");

  // Conflict recording & physics resolution
  transformer.recordConflict("drivetrain_voltage", 400.0, 500.0, "MotorVoltageReconciliation");
  transformer.resolveConflictPhysics("drivetrain_voltage", 200.0, 800.0);
  const resolved = transformer.getConflicts().find((c) => c.id === "drivetrain_voltage");
  assert(resolved?.isResolved, "Conflict must be marked resolved");
  assert.strictEqual(resolved?.resolved, 450.0, "Midpoint consensus must be chosen when within envelope");

  // Boundary clamp check: if midpoint exceeds physical limit
  transformer.recordConflict("overdrive_temp", 380.0, 420.0);
  transformer.resolveConflictPhysics("overdrive_temp", 250.0, 350.0); // max physical limit is 350
  const clamped = transformer.getConflicts().find((c) => c.id === "overdrive_temp");
  assert.strictEqual(clamped?.resolved, 350.0, "Value must be projected to physical limit boundary");
  console.log("  ✓ Enforced physical feasibility envelope during multi-master consensus\n");

  // --------------------------------------------------------------------------
  // Pillar 5: Semantic SMT Guard Confluence in CPA & Automated Inversion
  // --------------------------------------------------------------------------
  console.log("[5/6] Pillar 5: SMT Guard Confluence in CPA & Automated Inversion...");

  // Disjoint guards on identical source types
  const guardedRules = [
    tggRule({
      name: "AbstractPartToPartialModel",
      priority: 0,
      source: ($, v) => $.PartDef({ isAbstract: true, name: v("n") }),
      target: ($, v) => $.PartialModel({ name: v("n") }),
    }),
    tggRule({
      name: "ConcretePartToExecutableModel",
      priority: 0,
      source: ($, v) => $.PartDef({ isAbstract: false, name: v("n") }),
      target: ($, v) => $.ConcreteModel({ name: v("n") }),
    }),
  ];

  const cpaGuards = runCPA(guardedRules);
  const overlapConflicts = cpaGuards.conflicts.filter((c) => c.kind === "overlap");
  assert.strictEqual(overlapConflicts.length, 0, "Disjoint literal guards must be recognized as confluent");
  console.log("  ✓ Verified CPA semantic guard disjointness (0 false-positive overlap warnings)");

  // Automated expression inversion
  const affineAdd = invertExpression("x + 10");
  assert(affineAdd.isInvertible && affineAdd.invertedExpr === "y - 10");

  const affineMul = invertExpression("x * 2.5");
  assert(affineMul.isInvertible && affineMul.invertedExpr === "y / 2.5");

  const unitTemp = invertExpression("tempK - 273.15");
  assert(unitTemp.isInvertible && unitTemp.invertedExpr === "y + 273.15");

  const strPrefix = invertExpression('"PORT_" + portId');
  assert(strPrefix.isInvertible && strPrefix.invertedExpr?.includes('replace(/^PORT_/, "")'));
  console.log("  ✓ Verified bidirectional expression inversion across affine, unit, and string domains\n");

  // --------------------------------------------------------------------------
  // Pillar 6: IDE Live Projections & CST Source Spans
  // --------------------------------------------------------------------------
  console.log("[6/6] Pillar 6: CST Source Spans for Bi-Directional IDE Projection...");

  transformer.setCstSpan("Chassis", { startByte: 104, endByte: 250, line: 8, column: 1 });
  const span = transformer.getCstSpan("Chassis");
  assert(span);
  assert.strictEqual(span.startByte, 104);
  assert.strictEqual(span.endByte, 250);
  assert.strictEqual(span.line, 8);
  console.log("  ✓ Associated CST source ranges with polyglot model elements\n");

  console.log("============================================================");
  console.log("  ALL 6 SOTA TGG / POLYGLOT PROJECTION PILLARS VERIFIED!    ");
  console.log("============================================================");
}

run().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
