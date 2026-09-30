// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

const { parser, facade } = await createWasmParser(modelicaWasm);

const sourceNBSP =
  "model X\n\n  model A\n    Integer x;\n  end A;\n\n  A a;\nequation\n\n\u00a0\u00a0\u00a0\u00a0a.x = 1;\n\nend X;\n";
const treeNBSP = parser.parse(sourceNBSP);
const rootPtrNBSP = (treeNBSP.rootNode as any).id ?? (treeNBSP.rootNode as any).ptr ?? 0;
const diagsNBSP = facade.getDiagnostics(rootPtrNBSP, 0, sourceNBSP.length);
console.log("Diags for NBSP code:", diagsNBSP);
for (const d of diagsNBSP) {
  console.log(`  NBSP Diag: ${d.message} [range: ${d.startCharOffset}-${d.endCharOffset}]`);
}

function computeTreeEdit(oldText: string, newText: string) {
  const minLen = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefixLen && newSuffix > prefixLen && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }
  return { startIndex: prefixLen, oldEndIndex: oldSuffix, newEndIndex: newSuffix };
}

const docUri = "file:///RLC.mo";

// Scenario 1: Start with model X ... a; equation end X; and then type a.x = 1;
const initialText = `model X

  model A
    Integer x;
  end A;

  A a;
equation

  

end X;
`;

let currentTree = parser.parse(initialText, null, 0, 0, 0, docUri);
let currentText = initialText;

const fullTarget = `model X

  model A
    Integer x;
  end A;

  A a;
equation

  a.x = 1;

end X;
`;

// Try typing character by character or in chunks into the equation section
const insertPos = initialText.indexOf("  \n\nend X;");
console.log("insertPos:", insertPos);

const toType = "a.x = 1;";
let textSoFar = initialText.slice(0, insertPos) + initialText.slice(insertPos); // same as initial

const rlcTemplate = [
  'model RLC "RLC circuit with MSL components"',
  "  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)",
  "    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
  "  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)",
  "    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));",
  "  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)",
  "    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
  "  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)",
  "    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
  "  Modelica.Electrical.Analog.Basic.Ground ground",
  "    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));",
  "equation",
  "  connect(Vb.p, L.p)",
  "    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));",
  "  connect(L.n, C.p)",
  "    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));",
  "  connect(L.n, R.p)",
  "    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));",
  "  connect(R.n, Vb.n)",
  "    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
  "  connect(C.n, Vb.n)",
  "    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
  "  connect(Vb.n, ground.p)",
  "    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));",
  "end RLC;",
  "",
].join("\n");

console.log("=== Testing RLC template parse ===");
let tTree = parser.parse(rlcTemplate, null, 0, 0, 0, docUri);
console.log("RLC template tree:", tTree?.rootNode?.toString().slice(0, 200));
