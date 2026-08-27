import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import assert from "node:assert";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createWasmParser } from "@modelscript/language";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../../../languages/sysml2/dist/parser.wasm");
const { parser } = await createWasmParser(wasmPath);

test("SysML2 verification requirement constraints evaluation", async () => {
  const sourceText = `
    package TestPackage {
      requirement def ReqDef {
        attribute maxLimit : Real = 8.0;
        doc /* Maximum speed limit */
        
        require constraint {
          10.0 <= maxLimit
        }
      }
      
      requirement req1 : ReqDef {
        attribute redefine maxLimit = 5.0;
      }
    }
  `;

  const tree = parser.parse(sourceText);
  const uri = "file:///test.sysml";

  console.log("Root type:", tree.rootNode.type);
  console.log("Root children count:", tree.rootNode.children.length);
  console.log(
    "Root children types:",
    tree.rootNode.children.map((c) => c.type),
  );

  const index = createSysML2WorkspaceIndex();
  index.register(uri, () => tree.rootNode);
  await index.toUnifiedAsync();
  const sysmlUnified = index.toTreeIndex();

  console.log("SysML symbols count:", sysmlUnified.symbols.size);
  for (const [id, sym] of sysmlUnified.symbols.entries()) {
    console.log(`Symbol ${id}: name=${sym.name}, kind=${sym.kind}`);
  }

  const engine = createSysML2QueryEngine(sysmlUnified, () => tree.rootNode);
  const db = engine.toQueryDB();

  // Find the requirement req1
  const req1s = db.byName("req1");
  assert.strictEqual(req1s.length > 0, true, "req1 should be found");

  const req1 = req1s[0];

  // Now evaluate the lint rule lint__requirementConstraintViolated
  const result = db.query("lint__requirementConstraintViolated", req1.id);

  // Because 10.0 <= 5.0 is false, it should return an error diagnostic
  assert.ok(result, "Requirement should have violated constraints");
  if (result) {
    assert.match((result as Record<string, unknown>).message as string, /constraint\(s\) that evaluate to false/);
  }
});
