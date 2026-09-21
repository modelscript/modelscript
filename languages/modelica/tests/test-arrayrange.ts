import { readFileSync } from "fs";
import { resolve } from "path";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { ModelicaFlattener } from "../src/flattener.js";

async function main() {
  const moPath = resolve("testsuite/OpenModelica/flattening/modelica/arrays/ArrayRange.mo");
  const source = readFileSync(moPath, "utf-8");

  const wasmPath = resolve("dist/parser.wasm");
  const { parser } = await createWasmParser(wasmPath);
  Context.registerParser(".mo", parser);

  const ctx = new Context({ parserWasmPath: wasmPath });
  const flattener = new ModelicaFlattener(ctx);

  process.env.FLATTENER_BACKEND = "wasm";
  const res = await flattener.flatten(source, { modelName: "ArrayRange" });
  console.log("Result:", res ? res.modelText : "NULL");
  if (res && res.diagnostics) {
    console.log("Diagnostics:", res.diagnostics);
  }
}

main().catch(console.error);
