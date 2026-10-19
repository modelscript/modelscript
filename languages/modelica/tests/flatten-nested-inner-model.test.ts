// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { modelicaActionHandlers } from "../src/actions.js";
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
      getText: (startOffset: number, endOffset: number, entry?: any): string | null => {
        const u = entry?.resourceId ?? uri;
        const dt = docTrees.get(u);
        return dt ? dt.text.substring(startOffset, endOffset) : null;
      },
      getNode: (startOffset: number, endOffset: number, entry?: any): any | null => {
        const u = entry?.resourceId ?? uri;
        const dt = docTrees.get(u);
        if (!dt) return null;
        return dt.tree.rootNode.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
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

  it("correctly resolves 1-char modification bindings after '=' and outputs all continuous variables in simulate action", async () => {
    const { parser } = await createWasmParser(modelicaWasmPath);
    const uri = "memfs:/rlc/MiniRLC.mo";
    const code = `package MiniLib
  model Sine
    parameter Real amplitude = 1;
    parameter Real f = 1;
    output Real y;
  equation
    y = amplitude * sin(6.283185307179586 * f * time);
  end Sine;

  model VoltageSource
    replaceable Sine signalSource;
    Real v;
  equation
    v = signalSource.y;
  end VoltageSource;

  model SineVoltage
    parameter Real V = 1;
    parameter Real f = 1;
    extends VoltageSource(redeclare Sine signalSource(final amplitude=V, final f=f));
  end SineVoltage;
end MiniLib;

model MiniRLC
  MiniLib.SineVoltage Vb(V = 10, f = 50);
  Real i(start = 0, fixed = true);
  Real v_c(start = 0, fixed = true);
equation
  0.5 * der(i) = Vb.v - v_c;
  1e-4 * der(v_c) = i - v_c / 100.0;
end MiniRLC;`;

    const tree = parser.parse(code);
    const ws = createModelicaWorkspaceIndex();
    ws.indexDocument(uri, () => tree.rootNode);
    const unified = ws.toUnified();
    const queryEngine = createModelicaQueryEngine(unified, {
      getText: (s, e) => code.substring(s, e),
      getNode: (s, e) => tree.rootNode.descendantForIndex(s, Math.max(s, e)),
    });

    const execContext: any = {
      uri,
      languageId: "modelica",
      documentText: code,
      queryEngine,
    };

    const flatRes = await modelicaActionHandlers.flatten!(execContext, { name: "MiniRLC", documentText: code });
    assert.ok(
      !flatRes.text.includes("Vb.="),
      `Should not produce Vb.= from 1-char binding after '=', got:\n${flatRes.text}`,
    );
    assert.ok(
      flatRes.text.includes("Vb.signalSource.amplitude = 10.0"),
      `Expected Vb.signalSource.amplitude = 10.0 in flattened DAE, got:\n${flatRes.text}`,
    );
    assert.ok(
      flatRes.text.includes("Vb.signalSource.f = 50.0"),
      `Expected Vb.signalSource.f = 50.0 in flattened DAE, got:\n${flatRes.text}`,
    );

    const simRes = await modelicaActionHandlers.simulate!(execContext, { name: "MiniRLC", documentText: code });
    assert.strictEqual(simRes.experiment?.stopTime, 1.0, "Expected OMEdit-compliant default StopTime = 1.0");
    assert.ok(simRes.states.includes("i"), "Expected state 'i' in simulated states");
    assert.ok(simRes.states.includes("v_c"), "Expected state 'v_c' in simulated states");
    assert.ok(simRes.states.includes("der(i)"), "Expected state derivative 'der(i)' in simulated states");
    assert.ok(simRes.states.includes("der(v_c)"), "Expected state derivative 'der(v_c)' in simulated states");
    assert.ok(simRes.states.includes("Vb.v"), "Expected algebraic variable 'Vb.v' in simulated states");
    assert.ok(
      simRes.states.includes("Vb.signalSource.y"),
      "Expected algebraic variable 'Vb.signalSource.y' in simulated states",
    );

    const vbIdx = simRes.states.indexOf("Vb.v");
    const iIdx = simRes.states.indexOf("i");
    const derIIdx = simRes.states.indexOf("der(i)");
    const hasNonZeroVb = simRes.y.some((row: number[]) => Math.abs(row[vbIdx] ?? 0) > 1.0);
    const hasNonZeroI = simRes.y.some((row: number[]) => Math.abs(row[iIdx] ?? 0) > 1e-4);
    const hasNonZeroDerI = simRes.y.some((row: number[]) => Math.abs(row[derIIdx] ?? 0) > 1e-2);
    assert.ok(hasNonZeroVb, "Expected Vb.v trajectory to be non-zero");
    assert.ok(hasNonZeroI, "Expected inductor current i trajectory to be non-zero");
    assert.ok(hasNonZeroDerI, "Expected der(i) trajectory to be non-zero");
  });
});
