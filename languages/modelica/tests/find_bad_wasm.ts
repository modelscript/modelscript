// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const wasmCandidates = [
  "languages/modelica/dist/parser.wasm",
  "languages/modelica/.cache/parser.wasm",
  "apps/ide/dist/extension/server/dist/modelica.wasm",
  "apps/ide/dist/extension/server/dist/tree-sitter-modelica.wasm",
  "apps/ide/dist/static/static/devextensions/server/dist/modelica.wasm",
  "apps/web/dist/lsp/server/dist/parser.wasm",
];

const rlcCode = [
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

for (const relPath of wasmCandidates) {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) continue;
  console.log(`\n=== Testing ${relPath} ===`);
  try {
    const { parser, facade } = await createWasmParser(fullPath);
    const tree = parser.parse(rlcCode);
    const rPtr = (tree?.rootNode as any)?.id ?? (tree?.rootNode as any)?.ptr ?? 0;
    const diags = facade.getDiagnostics(rPtr);
    console.log(`  Diags count: ${diags.length}`);
    for (const d of diags) {
      console.log(`    ${d.message} [code: ${d.code}, range: ${d.startCharOffset}-${d.endCharOffset}]`);
    }
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }
}
