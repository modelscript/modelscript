// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(
  __dirname,
  "../../../apps/ide/dist/static/static/devextensions/server/dist/modelica.wasm",
);
const { parser, facade } = await createWasmParser(modelicaWasm);

const modelCode = `model X

  model A
    Integer x;
  end A;

  A a;

equation

  a.x = 1;

end X;
`;

console.log("=== Cold parse ===");
let tree = parser.parse(modelCode);
let rPtr = (tree?.rootNode as any)?.id ?? (tree?.rootNode as any)?.ptr ?? 0;
let diags = facade.getDiagnostics(rPtr, 0, modelCode.length);
console.log(`Cold parse diags: ${diags.length}`);

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

const rlcTemplate = `model RLC "RLC circuit with MSL components"
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50);
  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5);
  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4);
  Modelica.Electrical.Analog.Basic.Resistor R(R = 100);
  Modelica.Electrical.Analog.Basic.Ground ground;
equation
  connect(Vb.p, L.p);
  connect(L.n, C.p);
  connect(L.n, R.p);
  connect(R.n, Vb.n);
  connect(C.n, Vb.n);
  connect(Vb.n, ground.p);
end RLC;
`;

console.log("\n=== Sequence 2: Replace RLC with modelCode directly ===");
let tree2 = parser.parse(rlcTemplate, null, 0, 0, 0, "file:///RLC.mo");
let edit2 = computeTreeEdit(rlcTemplate, modelCode);
tree2 = parser.parse(modelCode, tree2, edit2.startIndex, edit2.oldEndIndex, edit2.newEndIndex, "file:///RLC.mo");
rPtr = (tree2?.rootNode as any)?.id ?? (tree2?.rootNode as any)?.ptr ?? 0;
diags = facade.getDiagnostics(rPtr, 0, modelCode.length);
console.log(`Sequence 2 diags: ${diags.length}`);
for (const d of diags) console.log(`  ${d.message} [range: ${d.startCharOffset}-${d.endCharOffset}]`);

console.log("\n=== Sequence 3: Type into equation section ===");
const codeBeforeEquation = `model X

  model A
    Integer x;
  end A;

  A a;

equation

  

end X;
`;
let tree3 = parser.parse(codeBeforeEquation, null, 0, 0, 0, "file:///RLC.mo");
// Now insert "a"
let text3_1 = codeBeforeEquation.replace("  \n\nend X;", "  a\n\nend X;");
let e1 = computeTreeEdit(codeBeforeEquation, text3_1);
tree3 = parser.parse(text3_1, tree3, e1.startIndex, e1.oldEndIndex, e1.newEndIndex, "file:///RLC.mo");

// Now insert "." -> "a."
let text3_2 = text3_1.replace("  a\n\nend X;", "  a.\n\nend X;");
let e2 = computeTreeEdit(text3_1, text3_2);
tree3 = parser.parse(text3_2, tree3, e2.startIndex, e2.oldEndIndex, e2.newEndIndex, "file:///RLC.mo");

// Now insert "x" -> "a.x"
let text3_3 = text3_2.replace("  a.\n\nend X;", "  a.x\n\nend X;");
let e3 = computeTreeEdit(text3_2, text3_3);
tree3 = parser.parse(text3_3, tree3, e3.startIndex, e3.oldEndIndex, e3.newEndIndex, "file:///RLC.mo");

// Now insert " = 1;" -> "a.x = 1;"
let text3_4 = text3_3.replace("  a.x\n\nend X;", "  a.x = 1;\n\nend X;");
let e4 = computeTreeEdit(text3_3, text3_4);
tree3 = parser.parse(text3_4, tree3, e4.startIndex, e4.oldEndIndex, e4.newEndIndex, "file:///RLC.mo");
rPtr = (tree3?.rootNode as any)?.id ?? (tree3?.rootNode as any)?.ptr ?? 0;
diags = facade.getDiagnostics(rPtr, 0, text3_4.length);
console.log(`Sequence 3 diags after 'a.x = 1;': ${diags.length}`);
for (const d of diags) console.log(`  ${d.message} [range: ${d.startCharOffset}-${d.endCharOffset}]`);
