import { createWasmParser } from "@modelscript/dsl/bindings";
import { modelicaActionHandlers } from "@modelscript/modelica";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const { initBltWasm } = await import("@modelscript/runtime");
  const wasmReleasePath = path.resolve("apps/ide/dist/extension/server/dist/release.wasm");
  await initBltWasm(wasmReleasePath);
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

  const queryEngine = createModelicaQueryEngine(wsIndex.toUnified(), {
    getText: (s, e) => validMo.substring(s, e),
    getNode: (s, e) => tree.rootNode.descendantForIndex(s, e),
  });

  const execContext: any = {
    uri,
    languageId: "modelica",
    documentText: validMo,
    queryEngine,
    notifyProgress: (msg: string) => console.log("[PROGRESS]", msg),
  };

  console.log("Calling modelicaActionHandlers.simulate...");
  const t0 = Date.now();
  const res = await modelicaActionHandlers.simulate(execContext, {});
  console.log(`Simulation finished in ${Date.now() - t0}ms!`);
  console.log("Result keys:", Object.keys(res));
  console.log("Steps:", res.t.length);
}

main().catch(console.error);
