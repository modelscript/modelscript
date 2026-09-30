// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

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

console.log("=== Step 1: Parse RLC template ===");
let tree = parser.parse(rlcTemplate, null, 0, 0, 0, docUri);
let currentText = rlcTemplate;

// Step 2: Replace with model X without the equation body
let baseCode = `model X

  model A
    Integer x;
  end A;

  A a;
equation

  

end X;
`;

let edit = computeTreeEdit(currentText, baseCode);
tree = parser.parse(baseCode, tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, docUri);
currentText = baseCode;

let rPtr = (tree?.rootNode as any)?.id ?? (tree?.rootNode as any)?.ptr ?? 0;
let diags = facade.getDiagnostics(rPtr, 0, currentText.length);
console.log(`After replacing with baseCode: diags = ${diags.length}`);

// Step 3: Type into the equation section
const insertOffset = baseCode.indexOf("  \n\nend X;");
const typedString = "a.x = 1;";

for (let i = 0; i < typedString.length; i++) {
  const nextText = currentText.slice(0, insertOffset + i) + typedString[i] + currentText.slice(insertOffset + i);
  edit = computeTreeEdit(currentText, nextText);
  tree = parser.parse(nextText, tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, docUri);
  currentText = nextText;
  rPtr = (tree?.rootNode as any)?.id ?? (tree?.rootNode as any)?.ptr ?? 0;
  diags = facade.getDiagnostics(rPtr, 0, currentText.length);
  console.log(`After typing '${typedString.slice(0, i + 1)}': diags = ${diags.length}`);
  for (const d of diags) {
    console.log(`  Diag: ${d.message} [${d.startCharOffset}-${d.endCharOffset}]`);
  }
}
