import { createWasmParser } from "@modelscript/dsl/bindings";
import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const wasmPath = path.resolve("apps/ide/dist/extension/server/dist/tree-sitter-modelica.wasm");
  console.log("Loading wasm from:", wasmPath);
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser, facade } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
  });

  const validMo = `model BouncingBall "A bouncing ball"
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

  const invalidMo = validMo + "\nERROR";

  console.log("--- Parsing valid Modelica ---");
  const tree1 = parser.parse(validMo);
  console.log(
    "tree1 rootNode hasError:",
    typeof tree1.rootNode.hasError === "function" ? tree1.rootNode.hasError() : tree1.rootNode.hasError,
  );
  console.log("facade diags 1:", facade.getDiagnostics?.(tree1.rootNode.ptr || tree1.rootPtr || 0));

  console.log("--- Parsing invalid Modelica ---");
  const tree2 = parser.parse(invalidMo);
  console.log(
    "tree2 rootNode hasError:",
    typeof tree2.rootNode.hasError === "function" ? tree2.rootNode.hasError() : tree2.rootNode.hasError,
  );
  console.log("facade diags 2:", facade.getDiagnostics?.(tree2.rootNode.ptr || tree2.rootPtr || 0));
  console.log("tree2.rootNode.tree:", !!tree2.rootNode.tree);
  console.log("tree2.rootNode.tree.facade:", !!tree2.rootNode?.tree?.facade);
}

main().catch(console.error);
