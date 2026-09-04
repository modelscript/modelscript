import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(wasmPath);

const source = fs.readFileSync(
  path.resolve(__dirname, "../testsuite/OpenModelica/flattening/modelica/equations/InOutBool.mo"),
  "utf-8",
);

const tree = parser.parse(source);

const eq = tree.rootNode.descendantsOfType("simple_equation")[0];
const rhs = eq.childForFieldName("rhs");
const cr = rhs.descendantsOfType("component_reference")[0];

console.log("cr:", cr.text);
console.log("cr.parent:", cr.parent?.type);
console.log("cr.nextSibling:", cr.nextSibling?.type, cr.nextSibling?.text);
console.log(
  "cr.parent.children:",
  cr.parent?.children.map((c) => ({ type: c.type, text: c.text })),
);
