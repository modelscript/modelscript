import path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  const { parser, facade } = await createWasmParser(wasmPath);
  const code = `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity";
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
ERROR`;

  const tree = parser.parse(code);
  console.log("tree:", !!tree);
  console.log("hasError:", tree.rootNode.hasError());
  console.log("type:", tree.rootNode.type);
  const diags = facade.getDiagnostics(tree.rootPtr);
  console.log("diags:", JSON.stringify(diags, null, 2));

  // Let's also test without ERROR
  const cleanCode = `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity";
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;`;
  const cleanTree = parser.parse(cleanCode);
  console.log("clean hasError:", cleanTree.rootNode.hasError());
  const cleanDiags = facade.getDiagnostics(cleanTree.rootPtr);
  console.log("cleanDiags:", JSON.stringify(cleanDiags, null, 2));
}

main().catch(console.error);
