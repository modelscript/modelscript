import { createWasmParser } from "@modelscript/dsl/bindings";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import * as fs from "fs";
import * as path from "path";
import { LSPBridge, PositionIndex } from "../../../packages/lsp/src/lsp-bridge.js";

async function main() {
  const wasmPath = path.resolve("apps/ide/dist/extension/server/dist/tree-sitter-modelica.wasm");
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
  });

  const uri = "memfs:/bouncing-ball/BouncingBall.mo";
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

  const tree = parser.parse(validMo);
  const wsIndex = createModelicaWorkspaceIndex();
  wsIndex.register(uri, () => tree.rootNode);
  wsIndex.getFileIndex(uri);

  const { UnifiedWorkspace } = await import("@modelscript/runtime");
  const unifiedWs = new UnifiedWorkspace();
  unifiedWs.registerWorkspace("modelica", wsIndex);
  const unified = unifiedWs.toUnifiedPartial();
  console.log("Unified symbols count:", unified.symbols.size);
  for (const [id, sym] of unified.symbols.entries()) {
    console.log(
      `Symbol ${id}: name=${sym.name}, kind=${sym.kind}, parentId=${sym.parentId}, resourceId=${sym.resourceId}`,
    );
  }

  const mockEngine = {
    toQueryDB() {
      return { index: unified };
    },
    index: unified,
  };

  const bridge = new LSPBridge(unified as any, mockEngine as any, new PositionIndex(validMo), uri);
  const docSymbols = bridge.documentSymbols();
  console.log("bridge.documentSymbols() count:", docSymbols.length);
  console.log("bridge.documentSymbols():", JSON.stringify(docSymbols, null, 2));
}

main().catch(console.error);
