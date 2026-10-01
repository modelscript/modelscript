// SPDX-License-Identifier: AGPL-3.0-or-later

import { modelicaActionHandlers } from "@modelscript/modelica";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function testFlattenUpdate() {
  const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasmPath);

  const uri = "memfs:/bouncing-ball/BouncingBall.mo";
  const oldMo = `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity";
  Real h(start = 1.0) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -9.81;
  when h < 0.0 then
    reinit(v, (-e) * pre(v));
  end when;
end BouncingBall;`;

  const tree = parser.parse(oldMo);
  const wsIndex = createModelicaWorkspaceIndex();
  wsIndex.indexDocument(uri, () => tree.rootNode);
  wsIndex.getFileIndex(uri);

  const unified = wsIndex.toUnified();
  console.log("Unified symbols count:", unified.symbols.size);
  console.log("Unified byName:", Array.from(unified.byName.keys()));

  const queryEngine = createModelicaQueryEngine(unified, {
    getText: (s, e) => oldMo.substring(s, e),
    getNode: (s, e) => tree.rootNode.descendantForIndex(s, e),
  });

  const execContext1: any = {
    uri,
    languageId: "modelica",
    documentText: oldMo,
    queryEngine,
    workspaceManager: {
      globalWorkspaceIndex: wsIndex,
      getWorkspaceIndex: () => wsIndex,
    },
    parserService: {
      parser,
      getParser: () => parser,
    },
    notifyProgress: () => {},
  };

  const res1 = await modelicaActionHandlers.flatten(execContext1, { name: "BouncingBall", documentText: oldMo });
  console.log("Flatten 1 (Old) Output:\n", res1.text);
  assert.ok(res1.text.includes("parameter Real e = 0.8"), "Should contain e in initial model");

  // Now change the document to the new BouncingBall from the screenshot:
  const newMo = `model BouncingBall "A bouncing ball"
  model A Integer x; end A;
  A x;
end BouncingBall;`;

  const execContext2: any = {
    uri,
    languageId: "modelica",
    documentText: newMo,
    queryEngine,
    workspaceManager: {
      globalWorkspaceIndex: wsIndex,
      getWorkspaceIndex: () => wsIndex,
    },
    parserService: {
      parser,
      getParser: () => parser,
    },
    notifyProgress: () => {},
  };

  const res2 = await modelicaActionHandlers.flatten(execContext2, { name: "BouncingBall", documentText: newMo });
  console.log("Flatten 2 (New) Output:\n", res2.text);

  assert.ok(!res2.text.includes("parameter Real e"), "Flatten 2 should not contain old parameters");
  assert.ok(res2.text.includes("x.x"), "Flatten 2 should contain new component x.x");
  console.log("✓ Flatten action successfully reflects updated document content!");
}

testFlattenUpdate().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
