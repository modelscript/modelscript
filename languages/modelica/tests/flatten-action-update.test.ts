// SPDX-License-Identifier: AGPL-3.0-or-later

import { modelicaActionHandlers } from "@modelscript/modelica";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);

describe("Modelica Flatten Action Real-Time Updates", async () => {
  it("reflects document edits in flattened text output", async () => {
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

    const unified = wsIndex.toUnified();
    const queryEngine = createModelicaQueryEngine(unified, {
      getText: (s, e) => oldMo.substring(s, e),
      getNode: (s, e) => tree.rootNode.descendantForIndex(s, e),
    });

    const execContext: any = {
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

    const res1 = await modelicaActionHandlers.flatten(execContext, { name: "BouncingBall", documentText: oldMo });
    assert.ok(res1.text.includes("BouncingBall"));
    assert.ok(res1.text.includes("parameter Real e = 0.8"));

    // Update document
    const newMo = `model BouncingBall "A bouncing ball"
  model A Integer x; end A;
  A x;
end BouncingBall;`;
    const newTree = parser.parse(newMo);
    wsIndex.indexDocument(uri, () => newTree.rootNode);

    const unified2 = wsIndex.toUnified();
    const queryEngine2 = createModelicaQueryEngine(unified2, {
      getText: (s, e) => newMo.substring(s, e),
      getNode: (s, e) => newTree.rootNode.descendantForIndex(s, e),
    });

    execContext.documentText = newMo;
    execContext.queryEngine = queryEngine2;

    const res2 = await modelicaActionHandlers.flatten(execContext, { name: "BouncingBall", documentText: newMo });
    assert.ok(res2.text.includes("Integer x.x;"));
  });
});
