import assert from "node:assert";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "../src/compiler/sysml2/sysml2-bridge.js";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");

// Global initialization
await Parser.init();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../../languages/sysml2/tree-sitter-sysml2.wasm");
const SysML2 = await Parser.Language.load(fs.readFileSync(wasmPath));
const parser = new Parser();
parser.setLanguage(SysML2);

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

  const index = createSysML2WorkspaceIndex();
  index.register(uri, () => tree.rootNode);
  await index.toUnifiedAsync();
  const sysmlUnified = index.toTreeIndex();

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
