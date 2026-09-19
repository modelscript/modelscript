import { createWasmParser } from "@modelscript/dsl/bindings";
import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import * as fs from "fs";
import * as path from "path";
import { computeTreeEdit } from "../../../packages/lsp/src/utils/astUtils.js";

async function main() {
  const wasmPath = path.resolve("apps/ide/dist/extension/server/dist/tree-sitter-modelica.wasm");
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

  console.log("--- First parse (valid) ---");
  const tree1 = parser.parse(validMo);
  console.log(
    "tree1 hasError:",
    typeof tree1.rootNode.hasError === "function" ? tree1.rootNode.hasError() : tree1.rootNode.hasError,
  );

  console.log("--- Incremental parse (invalid) ---");
  const edit = computeTreeEdit(validMo, invalidMo);
  console.log("edit:", edit);
  if (typeof tree1.edit === "function") {
    tree1.edit(edit);
  }
  const tree2 = parser.parse(invalidMo, tree1, edit.startIndex, edit.oldEndIndex, edit.newEndIndex);
  console.log(
    "tree2 hasError:",
    typeof tree2.rootNode.hasError === "function" ? tree2.rootNode.hasError() : tree2.rootNode.hasError,
  );
  console.log("facade diags 2:", facade.getDiagnostics?.(tree2.rootNode.ptr || tree2.rootPtr || 0));
  console.log("tree2.rootNode.tree.facade:", !!tree2.rootNode?.tree?.facade);
  const { TextDocument } = await import("vscode-languageserver-textdocument");
  const doc = TextDocument.create("memfs:/bouncing-ball/BouncingBall.mo", "modelica", 1, invalidMo);

  // Test collectSyntaxErrors logic
  const wasmDiags = facade.getDiagnostics(tree2.rootNode.ptr || tree2.rootPtr || 0);
  console.log("wasmDiags raw:", wasmDiags);
  const diagnostics: any[] = [];
  for (const d of wasmDiags) {
    if (d.severity === 1 || !d.code || d.code === "ERROR") {
      let range = d.range;
      if (d.startCharOffset !== undefined && d.endCharOffset !== undefined) {
        range = {
          start: doc.positionAt(d.startCharOffset),
          end: doc.positionAt(d.endCharOffset),
        };
      }
      diagnostics.push({
        severity: 1,
        range,
        message: d.message || "Syntax error",
        source: "modelscript",
      });
    }
  }
  console.log("diagnostics produced:", JSON.stringify(diagnostics, null, 2));
}

main().catch(console.error);
