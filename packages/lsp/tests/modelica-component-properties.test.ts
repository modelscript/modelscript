// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { FIELD_NAMES, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildComponentProperties } from "../../../languages/modelica/dist/src/diagram/data.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

test("buildComponentProperties extracts parameters and strips HTML envelopes from MSL components", async () => {
  const wasmPath = resolve(repoRoot, "languages/modelica/dist/parser.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: FIELD_NAMES,
  });
  const prevParser = (globalThis as any).modelicaParser;
  const prevSharedFs = (globalThis as any).sharedFs;

  try {
    (globalThis as any).modelicaParser = parser;

    const docManager = new DocumentManager();
    const wm = new WorkspaceManager(docManager);

    const resistorPath = resolve(
      repoRoot,
      "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo",
    );
    const resistorText = readFileSync(resistorPath, "utf-8");

    const rlcText = `model RLC
  Modelica.Electrical.Analog.Basic.Resistor R(R = 100);
end RLC;`;

    (globalThis as any).sharedFs = {
      exists: () => true,
      read: (p: string) => {
        if (p.includes("RLC.mo")) return rlcText;
        return resistorText;
      },
    };

    const tree = parser.parse(resistorText);
    wm.globalWorkspaceIndex.indexDocument(
      "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
      () => tree.rootNode,
      "Modelica.Electrical.Analog.Basic",
    );
    wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo");
    wm.unifiedWorkspace.ensureChildrenIndexed("Modelica.Electrical.Analog.Basic");

    const rlcTree = parser.parse(rlcText);
    wm.globalWorkspaceIndex.indexDocument("file:///workspace/RLC.mo", () => rlcTree.rootNode);
    wm.globalWorkspaceIndex.ensureIndexed("file:///workspace/RLC.mo");

    const rlcCls = wm.resolveModelicaClassInstance("file:///workspace/RLC.mo", "RLC");
    assert.ok(rlcCls, "RLC class instance must resolve");

    const props = buildComponentProperties(rlcCls, "R");
    assert.ok(props, "Properties for R must not be null");

    // 1. Parameters check
    assert.ok(props.parameters && props.parameters.length >= 3, "Must extract at least R, T_ref, and alpha");
    const rParam = props.parameters.find((p) => p.name === "R");
    assert.ok(rParam, "Parameter 'R' must be found");
    assert.strictEqual(rParam.value, "100", "Caller override R=100 must be captured");
    assert.strictEqual(rParam.unit, "Ω", "Unit Ω must be assigned");
    assert.strictEqual(rParam.description, "Resistance at temperature T_ref");

    const tRefParam = props.parameters.find((p) => p.name === "T_ref");
    assert.ok(tRefParam, "Parameter 'T_ref' must be found");
    assert.strictEqual(tRefParam.value, "300.15", "Default value 300.15 must be captured");

    // 2. Tabs check
    assert.ok(props.schema?.tabs && props.schema.tabs.length >= 2, "Must have General and Documentation tabs");
    const genTab = props.schema.tabs.find((t) => t.id === "general");
    assert.ok(genTab, "General tab must exist");

    const docTab = props.schema.tabs.find((t) => t.id === "documentation");
    assert.ok(docTab, "Documentation tab must exist");

    // 3. HTML doc check (stripping outer <html> tag and using kind: "html")
    const infoField = docTab.groups.find((g) => g.id === "info")?.fields.find((f) => f.key === "docInfo");
    assert.ok(infoField, "docInfo field must exist");
    assert.strictEqual(infoField.kind, "html", "Documentation field must have kind: 'html'");
    assert.ok(!infoField.defaultValue.startsWith("<html>"), "Outer <html> tag must be stripped");
    assert.ok(infoField.defaultValue.includes("<p>The linear resistor"), "Inner <p> markup must be preserved");

    const revField = docTab.groups.find((g) => g.id === "revisions")?.fields.find((f) => f.key === "docRevisions");
    assert.ok(revField, "docRevisions field must exist");
    assert.strictEqual(revField.kind, "html", "Revisions field must have kind: 'html'");
    assert.ok(!revField.defaultValue.startsWith("<html>"), "Outer <html> tag must be stripped");
    assert.ok(revField.defaultValue.includes("<ul>"), "Inner <ul> markup must be preserved");
  } finally {
    if (prevSharedFs !== undefined) {
      (globalThis as any).sharedFs = prevSharedFs;
    } else {
      delete (globalThis as any).sharedFs;
    }
    if (prevParser !== undefined) {
      (globalThis as any).modelicaParser = prevParser;
    } else {
      delete (globalThis as any).modelicaParser;
    }
  }
});
