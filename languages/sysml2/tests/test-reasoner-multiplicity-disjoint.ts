import { createWasmParser } from "@modelscript/dsl";
import { TableauReasoner } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "../src/factory.js";
import { emitAxioms } from "../src/reasoner-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  console.log("Testing SysML v2 Reasoner Bridge (Multiplicity & Disjointness)...");
  const { parser } = await createWasmParser(sysmlWasm);

  const model = `
    package VehicleModel {
      part def Wheel;
      part def Engine;

      #disjoint part def ElectricEngine :> Engine;
      #disjoint part def CombustionEngine :> Engine;

      part def Vehicle {
        part wheels : Wheel[4];
        part engines : Engine[1..2];
      }
    }
  `;

  const tree = parser.parse(model);
  assert.strictEqual(tree.rootNode.hasError(), false, "Model should parse cleanly");

  const workspaceIndex = createSysML2WorkspaceIndex();
  workspaceIndex.register("file:///vehicle.sysml", () => tree.rootNode as any);
  const unified = await workspaceIndex.toUnifiedAsync();
  const queryEngine = createSysML2QueryEngine(unified);
  const db = queryEngine.toQueryDB();

  const pkg = db.byName("VehicleModel")[0];
  assert.ok(pkg, "VehicleModel package should be indexed");

  const axioms = emitAxioms(db, pkg);
  console.log(`Emitted ${axioms.length} axioms:`);
  for (const ax of axioms) {
    console.log(" ", ax.type, ax);
  }

  // 1. Verify DisjointClasses axiom
  const disjoints = axioms.filter((a) => a.type === "DisjointClasses");
  assert.strictEqual(disjoints.length, 1, "Should emit 1 DisjointClasses axiom");
  const disj = disjoints[0] as any;
  assert.deepStrictEqual(disj.classIris.sort(), ["sysml:CombustionEngine", "sysml:ElectricEngine"]);
  console.log("✓ DisjointClasses correctly emitted for #disjoint siblings");

  // 2. Verify Multiplicity / QualifiedCardinality axioms
  const cardinalities = axioms.filter((a) => a.type === "QualifiedCardinality");
  assert.ok(cardinalities.length >= 3, `Expected at least 3 cardinality axioms, got ${cardinalities.length}`);

  const exactWheel = cardinalities.find(
    (a: any) => a.classIri === "sysml:Vehicle" && a.cardinalityType === "exact" && a.count === 4,
  );
  assert.ok(exactWheel, "Vehicle should have exact cardinality 4 for Wheel");

  const minEngine = cardinalities.find(
    (a: any) => a.classIri === "sysml:Vehicle" && a.cardinalityType === "min" && a.count === 1,
  );
  assert.ok(minEngine, "Vehicle should have min cardinality 1 for Engine");

  const maxEngine = cardinalities.find(
    (a: any) => a.classIri === "sysml:Vehicle" && a.cardinalityType === "max" && a.count === 2,
  );
  assert.ok(maxEngine, "Vehicle should have max cardinality 2 for Engine");
  console.log("✓ Multiplicity constraints (exact, min, max) correctly emitted");

  // 3. Verify TableauReasoner classification and consistency
  const reasoner = new TableauReasoner();
  reasoner.loadOntology(axioms);
  reasoner.classify();

  const consistency1 = reasoner.checkConsistency();
  assert.strictEqual(consistency1.isConsistent, true, "Vehicle model should be consistent");
  console.log("✓ Consistent model verified by TableauReasoner");

  // 4. Test inconsistency detection when contradictory hybrid engine is asserted
  const contradictoryAxioms = [
    ...axioms,
    { type: "ClassDeclaration", iri: "sysml:ContradictoryEngine" as const, sourceLang: "sysml2" },
    {
      type: "SubClassOf",
      subClassIri: "sysml:ContradictoryEngine",
      superClassIri: "sysml:ElectricEngine",
      sourceLang: "sysml2",
    },
    {
      type: "SubClassOf",
      subClassIri: "sysml:ContradictoryEngine",
      superClassIri: "sysml:CombustionEngine",
      sourceLang: "sysml2",
    },
  ];
  const badReasoner = new TableauReasoner();
  badReasoner.loadOntology(contradictoryAxioms as any);
  badReasoner.classify();
  const consistency2 = badReasoner.checkConsistency();
  assert.strictEqual(
    consistency2.isConsistent,
    false,
    "Contradictory engine specializing disjoint classes must be inconsistent",
  );
  console.log("✓ Inconsistency detected and caught by reasoner for disjoint violation!");

  // 5. Test lint__ontologicalInconsistency via QueryEngine
  const cleanLint = queryEngine.fetch("lint__ontologicalInconsistency", pkg.id);
  assert.strictEqual(cleanLint, null, "Consistent package should produce no ontological inconsistency lint");

  const badModel = `
    package InconsistentModel {
      part def Engine;
      #disjoint part def ElectricEngine :> Engine;
      #disjoint part def CombustionEngine :> Engine;
      part def HybridEngine :> ElectricEngine, CombustionEngine;
    }
  `;
  const badTree = parser.parse(badModel);
  const badWs = createSysML2WorkspaceIndex();
  badWs.register("file:///inconsistent.sysml", () => badTree.rootNode as any);
  const badUnified = await badWs.toUnifiedAsync();
  const badQE = createSysML2QueryEngine(badUnified);
  const badPkg = badQE.toQueryDB().byName("InconsistentModel")[0];
  const badLint: any = badQE.fetch("lint__ontologicalInconsistency", badPkg.id);
  assert.ok(badLint, "Inconsistent package must produce an ontological inconsistency lint");
  console.log("✓ lint__ontologicalInconsistency detected:", badLint.message);

  console.log("\nAll reasoner bridge tests passed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
