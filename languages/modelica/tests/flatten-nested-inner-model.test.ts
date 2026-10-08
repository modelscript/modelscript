// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "../src/factory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica Nested & Inner Model Incremental Flattening", async () => {
  it("indexes and flattens nested inner models through successive document edits", async () => {
    const { parser } = await createWasmParser(modelicaWasmPath);
    const uri = "memfs:/bouncing-ball/BouncingBall.mo";
    const docTrees = new Map<string, any>();

    // Initial model
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
    assert.ok(ballId !== undefined);

    const qdb1 = queryEngine.toQueryDB();
    const initElements = qdb1.query("instantiate", ballId);
    assert.ok(Array.isArray(initElements) && initElements.length > 0);

    // Edit 1: Introduce nested model
    const newText = `model X
  model Y
    Integer x;
  end Y;
  Y y;
end X;`;

    const newTree = parser.parse(newText);
    docTrees.set(uri, { text: newText, tree: newTree });
    ws.indexDocument(uri, () => newTree.rootNode);

    const unified2 = ws.toUnified();
    const xId = unified2.byName.get("X")?.[0];
    assert.ok(xId !== undefined, "Model X should be indexed");

    const queryEngine2 = createModelicaQueryEngine(unified2, cstWrapper);
    const qdb2 = queryEngine2.toQueryDB();
    const xElements = qdb2.query("instantiate", xId);
    assert.ok(Array.isArray(xElements) && xElements.length > 0);
  });
});
