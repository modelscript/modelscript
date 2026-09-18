// SPDX-License-Identifier: AGPL-3.0-or-later
import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function runTests() {
  console.log("Running SysML v2 import and stdlib tests...");

  const { parser } = await createWasmParser(sysmlWasm);
  const workspaceIndex = createSysML2WorkspaceIndex();

  // 1. Load embedded KerML stdlib
  const stdlibUri = loadEmbeddedKerMLStdlib(workspaceIndex, parser);
  assert.ok(stdlibUri, "loadEmbeddedKerMLStdlib should successfully load KerML.sysml");
  assert.strictEqual(stdlibUri, "sysml2://stdlib/KerML.sysml");

  // 2. Register user model that imports from ScalarValues and ISQ
  const userModelCode = `
    package VehicleModel {
      import ScalarValues::*;
      import ISQ::Time;
      import SIBaseUnits::Second;
      import SIDerivedUnits::Newton;
      import Collections::List;

      part def Engine {
        attribute power : Real;
        attribute duration : Time;
        attribute timeout : Second;
        attribute force : Newton;
        item partsList : List;
      }
    }
  `;

  const userUri = "file:///workspace/VehicleModel.sysml";
  workspaceIndex.register(userUri, () => {
    const tree = parser.parse(userModelCode);
    return tree ? (tree.rootNode as any) : null;
  });

  const unified = await workspaceIndex.toUnifiedAsync();
  const queryEngine = createSysML2QueryEngine(unified);
  const db = queryEngine.toQueryDB();

  // Check that KerML definitions were indexed
  const realDefs = db.byName("Real");
  assert.ok(realDefs.length > 0, "ScalarValues::Real should be present in the index");

  const timeDefs = db.byName("Time");
  assert.ok(timeDefs.length > 0, "ISQ::Time should be present in the index");

  const secondDefs = db.byName("Second");
  assert.ok(secondDefs.length > 0, "SIBaseUnits::Second should be present in the index");

  const newtonDefs = db.byName("Newton");
  assert.ok(newtonDefs.length > 0, "SIDerivedUnits::Newton should be present in the index");

  const listDefs = db.byName("List");
  assert.ok(listDefs.length > 0, "Collections::List should be present in the index");

  // Check that VehicleModel definitions were indexed
  const vehiclePkgs = db.byName("VehicleModel");
  assert.ok(vehiclePkgs.length > 0, "VehicleModel should be in index");

  const engineDefs = db.byName("Engine");
  assert.ok(engineDefs.length > 0, "Engine should be present in the index");
  const engine = engineDefs[0];

  // Find attribute power
  const engineChildren = db.childrenOf(engine.id);
  const powerAttr = engineChildren.find((c: any) => c.name === "power");
  assert.ok(powerAttr, "power attribute should be indexed");

  // Verify type resolution of power -> Real (via namespace import ScalarValues::*)
  const powerType = queryEngine.fetch("resolvedType", powerAttr.id);
  assert.ok(powerType, "power attribute type should resolve");
  assert.strictEqual((powerType as any).name, "Real", "power attribute type should resolve to Real");

  // Find attribute duration
  const durationAttr = engineChildren.find((c: any) => c.name === "duration");
  assert.ok(durationAttr, "duration attribute should be indexed");

  // Verify type resolution of duration -> Time (via membership import ISQ::Time)
  const durationType = queryEngine.fetch("resolvedType", durationAttr.id);
  assert.ok(durationType, "duration attribute type should resolve");
  assert.strictEqual((durationType as any).name, "Time", "duration attribute type should resolve to Time");

  // Verify type resolution of timeout -> Second
  const timeoutAttr = engineChildren.find((c: any) => c.name === "timeout");
  assert.ok(timeoutAttr, "timeout attribute should be indexed");
  const timeoutType = queryEngine.fetch("resolvedType", timeoutAttr.id);
  assert.ok(timeoutType, "timeout attribute type should resolve");
  assert.strictEqual((timeoutType as any).name, "Second", "timeout attribute type should resolve to Second");

  // Verify type resolution of force -> Newton
  const forceAttr = engineChildren.find((c: any) => c.name === "force");
  assert.ok(forceAttr, "force attribute should be indexed");
  const forceType = queryEngine.fetch("resolvedType", forceAttr.id);
  assert.ok(forceType, "force attribute type should resolve");
  assert.strictEqual((forceType as any).name, "Newton", "force attribute type should resolve to Newton");

  // Verify type resolution of partsList -> List
  const listAttr = engineChildren.find((c: any) => c.name === "partsList");
  assert.ok(listAttr, "partsList item should be indexed");
  const listType = queryEngine.fetch("resolvedType", listAttr.id);
  assert.ok(listType, "partsList type should resolve");
  assert.strictEqual((listType as any).name, "List", "partsList type should resolve to List");

  console.log("✓ SysML v2 namespace and membership import resolution passed");
  console.log("✓ Embedded KerML stdlib auto-resolution passed");
  console.log("✓ Hydrated SIBaseUnits, SIDerivedUnits, and Collections resolution passed");
  console.log("\nAll SysML v2 library tests passed successfully!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
