// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "../src/factory.js";
import { modelicaActionHandlers } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  const { parser } = await createWasmParser(modelicaWasmPath);
  const uri = "memfs:/bouncing-ball/BouncingBall.mo";
  const docTrees = new Map<string, any>();

  // ---------------------------------------------------------------------------
  // Test Scenario 1: Single-language workspace index with initial stale state
  // ---------------------------------------------------------------------------
  console.log("Scenario 1: Incremental edit over initial BouncingBall model");
  const initialText = `model BouncingBall
  Real h;
end BouncingBall;`;

  const initialTree = parser.parse(initialText);
  docTrees.set(uri, { text: initialText, tree: initialTree });

  const ws = createModelicaWorkspaceIndex();
  ws.indexDocument(uri, () => initialTree.rootNode);
  const unified = ws.toUnified();

  const cstWrapper = {
    getText: (startByte: number, endByte: number, entry?: any): string | null => {
      const u = entry?.resourceId ?? uri;
      const dt = docTrees.get(u);
      return dt ? dt.text.substring(startByte, endByte) : null;
    },
    getNode: (startByte: number, endByte: number, entry?: any): any | null => {
      const u = entry?.resourceId ?? uri;
      const dt = docTrees.get(u);
      if (!dt) return null;
      return dt.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
    },
  };

  const queryEngine = createModelicaQueryEngine(unified, cstWrapper);

  const ballId = unified.byName.get("BouncingBall")?.[0];
  assert.ok(ballId !== undefined, "Initial model BouncingBall should be indexed");
  const qdb1 = queryEngine.toQueryDB();
  const initElements = qdb1.query("instantiate", ballId);
  assert.ok(Array.isArray(initElements) && initElements.length > 0, "BouncingBall should instantiate elements");

  const newText = `model X
  model Y
    Integer x;
  end Y;
  Y x;
end X;`;

  const newTree = parser.parse(newText);
  docTrees.set(uri, { text: newText, tree: newTree });

  const execContext1: any = {
    uri,
    languageId: "modelica",
    documentText: newText,
    queryEngine,
    workspaceManager: {
      globalWorkspaceIndex: ws,
      getWorkspaceIndex: () => ws,
      documentManager: { documentTrees: docTrees },
    },
    documentManager: { documentTrees: docTrees },
    parserService: {
      parser,
      getParser: () => parser,
      getSharedCstTreeWrapper: () => cstWrapper,
    },
    notifyProgress: () => {},
  };

  const res1 = await modelicaActionHandlers.flatten(execContext1, { name: "X", documentText: newText });
  assert.ok(res1.text, "Flatten result should not be empty");
  assert.ok(res1.text.includes("model X"), "Flatten result should define model X");
  assert.ok(res1.text.includes("Integer x.x;"), "Flatten result should lower nested component to 'Integer x.x;'");
  assert.ok(!res1.text.trim().endsWith("model X\nend X;"), "Flatten result must not be an empty model declaration");

  // ---------------------------------------------------------------------------
  // Test Scenario 2: Successive edit updating inner class fields
  // ---------------------------------------------------------------------------
  console.log("Scenario 2: Successive edit modifying inner model definition");
  const updatedText = `model X
  model Y
    Real a;
    Real b;
  end Y;
  Y x;
end X;`;

  const updatedTree = parser.parse(updatedText);
  docTrees.set(uri, { text: updatedText, tree: updatedTree });

  const execContext2: any = {
    ...execContext1,
    documentText: updatedText,
  };

  const res2 = await modelicaActionHandlers.flatten(execContext2, { name: "X", documentText: updatedText });
  assert.ok(res2.text.includes("Real x.a;"), "Updated inner model field 'a' should be reflected");
  assert.ok(res2.text.includes("Real x.b;"), "Updated inner model field 'b' should be reflected");
  assert.ok(!res2.text.includes("Integer x.x;"), "Old field from previous edit must be invalidated");

  // ---------------------------------------------------------------------------
  // Test Scenario 3: Multi-language UnifiedWorkspace synchronization
  // ---------------------------------------------------------------------------
  console.log("Scenario 3: Multi-language UnifiedWorkspace integration");
  const unifiedWs = new UnifiedWorkspace();
  const moWs = createModelicaWorkspaceIndex();
  unifiedWs.registerWorkspace("modelica", moWs);

  const uwsEngine = createModelicaQueryEngine(unifiedWs.toUnifiedPartial(), cstWrapper);

  const execContext3: any = {
    uri,
    languageId: "modelica",
    documentText: newText,
    queryEngine: uwsEngine,
    workspaceManager: {
      globalWorkspaceIndex: moWs,
      getWorkspaceIndex: () => moWs,
      unifiedWorkspace: unifiedWs,
      documentManager: { documentTrees: docTrees },
    },
    documentManager: { documentTrees: docTrees },
    parserService: {
      parser,
      getParser: () => parser,
      getSharedCstTreeWrapper: () => cstWrapper,
    },
    notifyProgress: () => {},
  };

  const res3 = await modelicaActionHandlers.flatten(execContext3, { name: "X", documentText: newText });
  assert.ok(res3.text.includes("model X"), "Unified workspace flatten should define model X");
  assert.ok(
    res3.text.includes("Integer x.x;"),
    "Unified workspace flatten should resolve inner class Y and component x",
  );

  console.log("All scenarios passed successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
