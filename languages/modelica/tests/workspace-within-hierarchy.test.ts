// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { printArenaDAE } from "@modelscript/runtime";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { modelicaActionHandlers } from "../src/actions.js";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "../src/factory.js";
import { ModelicaFlattener } from "../src/flattener.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("WorkspaceIndex automatic within-clause resolution and flattening", async () => {
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);

  const ws = createModelicaWorkspaceIndex();

  const pkgCode = `package MyPackage
  model Sibling
    parameter Real x = 10.0;
  end Sibling;
end MyPackage;`;
  const pkgTree = parser.parse(pkgCode);
  ws.indexDocument("file:///MyPackage/package.mo", () => pkgTree.rootNode);

  // Register child with 'within MyPackage;' without passing parentFQN
  const childCode = `within MyPackage;
model Child
  Sibling s;
end Child;`;
  const childTree = parser.parse(childCode);
  ws.indexDocument("file:///MyPackage/Child.mo", () => childTree.rootNode);

  const childSym = Array.from(ws.unifiedIndex.symbols.values()).find((s) => s.name === "Child");
  assert.ok(childSym, "Child symbol should be indexed");
  assert.strictEqual(childSym.parentId, 1, "Child should have parentId pointing to MyPackage");
  assert.ok(
    ws.unifiedIndex.byName.get("MyPackage.Child")?.includes(childSym.id),
    "MyPackage.Child FQN should be indexed",
  );

  const qe = createModelicaQueryEngine(ws.toUnified());
  const qdb = qe.toQueryDB();

  const resolveSimple = qdb.query("resolveSimpleName", childSym.id) as (name: string) => any;
  const resolvedSibling = resolveSimple ? resolveSimple("Sibling") : null;
  assert.ok(resolvedSibling, "Sibling should be resolved from within Child scope");
  assert.strictEqual(resolvedSibling.name, "Sibling");

  const flattener = new ModelicaFlattener(qdb);
  const arena = flattener.flatten(childSym.id);
  const daeText = printArenaDAE(arena);
  assert.ok(daeText.includes("Real s;"), "Flattened DAE should include resolved Sibling component");

  // Verify reindexing upon editor changes maintains within hierarchy
  const updatedChildCode = `within MyPackage;
model Child
  Sibling s;
  parameter Real y = 20.0;
end Child;`;
  const updatedTree = parser.parse(updatedChildCode);
  ws.reindexDocument("file:///MyPackage/Child.mo", () => updatedTree.rootNode);

  const reindexedChild = Array.from(ws.unifiedIndex.symbols.values()).find((s) => s.name === "Child");
  assert.strictEqual(reindexedChild?.parentId, 1, "Reindexed Child should keep parentId pointing to MyPackage");
});

test("Action handlers flatten and simulate resolve within-clause model when called with simple name or omitted name", async () => {
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);

  const ws = createModelicaWorkspaceIndex();

  const pkgCode = `package Physics
  model Base
    parameter Real c = 3.0;
    Real x;
  equation
    der(x) = -c * x;
  end Base;
end Physics;`;
  const pkgTree = parser.parse(pkgCode);
  ws.indexDocument("file:///Physics/package.mo", () => pkgTree.rootNode);

  const childCode = `within Physics;
model ChildSim
  extends Base;
end ChildSim;`;
  const childTree = parser.parse(childCode);
  ws.indexDocument("file:///Physics/ChildSim.mo", () => childTree.rootNode);

  const qe = createModelicaQueryEngine(ws.toUnified());

  const docTrees = new Map();
  docTrees.set("file:///Physics/package.mo", { text: pkgCode, tree: pkgTree });
  docTrees.set("file:///Physics/ChildSim.mo", { text: childCode, tree: childTree });

  const execContext: any = {
    uri: "file:///Physics/ChildSim.mo",
    languageId: "modelica",
    documentText: childCode,
    queryEngine: qe,
    documentManager: { documentTrees: docTrees },
    workspaceManager: {
      globalWorkspaceIndex: ws,
      getWorkspaceIndex: () => ws,
    },
    parserService: {
      parser,
      getParser: () => parser,
    },
    notifyProgress: () => {},
  };

  // 1. Flatten with unqualified name "ChildSim"
  const flatRes1 = await modelicaActionHandlers.flatten(execContext, { name: "ChildSim" });
  assert.ok(flatRes1.text.includes("ChildSim"), "DAE should include ChildSim");
  assert.ok(flatRes1.text.includes("der(x) = (-c) * x"), "DAE should resolve inherited Base equation");

  // 2. Flatten with omitted name (extracts from documentText + within)
  const flatRes2 = await modelicaActionHandlers.flatten(execContext, {});
  assert.ok(flatRes2.text.includes("ChildSim"));

  // 3. Simulate with unqualified name
  const simRes = await modelicaActionHandlers.simulate(execContext, { name: "ChildSim", stopTime: 1.0 });
  assert.ok(simRes.t.length > 0, "Simulation should produce time points");
  assert.ok(simRes.states.includes("x"), "Simulation should have state x");

  // 4. Simulate with CVODE solver (if SUNDIALS wasm binary is present)
  const sundialsWasmCandidate = path.resolve(__dirname, "../../../packages/simulate/src/wasm/sundials.wasm");
  if (fs.existsSync(sundialsWasmCandidate)) {
    const simResCvode = await modelicaActionHandlers.simulate(execContext, {
      name: "ChildSim",
      stopTime: 1.0,
      solver: "cvode",
    });
    assert.ok(simResCvode.t.length > 0, "CVODE simulation should produce time points");
    assert.ok(simResCvode.states.includes("x"), "CVODE simulation should have state x");
  }
});
