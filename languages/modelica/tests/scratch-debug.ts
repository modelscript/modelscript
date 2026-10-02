// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "../src/node-fs.js";

async function run() {
  const modelicaWasmPath = path.resolve("./languages/modelica/dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasmPath);
  Context.registerParser(".mo", parser);

  const file = path.resolve(
    "./languages/modelica/testsuite/OpenModelica/flattening/modelica/records/RecordNonPublic.mo",
  );
  const content = fs.readFileSync(file, "utf-8");
  const context = new Context(new NodeFileSystem());
  context.load(content, file);

  const arena = context.flattenArena("RecordNonPublic", undefined, undefined, {
    omcCompatibility: true,
    isOldFrontend: true,
  });

  console.log("Variables in RecordNonPublic:");
  for (let i = 0; i < arena.varCount; i++) {
    console.log(i, arena.getVarName(i), "isProtected:", arena.isVarProtected(i));
  }
}

run().catch(console.error);
