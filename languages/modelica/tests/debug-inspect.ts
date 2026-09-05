import fs from "node:fs";
import path from "node:path";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { ModelicaFlattener } from "../src/flattener.js";

async function main() {
  const wasmPath = path.resolve(import.meta.dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(wasmPath);
  Context.registerParser(".mo", parser);

  const testFile = path.resolve(
    import.meta.dirname,
    "../testsuite/OpenModelica/flattening/modelica/modification/modifyOuter.mo",
  );
  const source = fs.readFileSync(testFile, "utf-8");
  const context = new Context();
  context.load(source, testFile);

  const queryDB = context.queryEngine.toQueryDB();
  const flattener = new ModelicaFlattener(queryDB, { omcCompatibility: true });

  const rootClassId = queryDB.byName("inn")[0].id;
  const dae = flattener.flattenClass(rootClassId);
  const { ArenaDAEPrinter } = await import("@modelscript/language/compiler");
  console.log("Printed output:\n" + ArenaDAEPrinter.print(dae));
}

main().catch(console.error);
