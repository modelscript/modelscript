import { createWasmParser } from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  console.log("Initializing WASM parser...");
  const { parser } = await createWasmParser(modelicaWasmPath);
  Context.registerParser(".mo", parser);

  const filePath = path.resolve(
    __dirname,
    "../../../data/libraries/Modelica/4.1.0/extracted/Modelica/Blocks/package.mo",
  );
  console.log("Loading Blocks/package.mo:", filePath);
  const source = fs.readFileSync(filePath, "utf-8");
  console.log(`Source length: ${source.length} bytes, ${source.split("\n").length} lines`);

  const nfs = new NodeFileSystem();
  const context = new Context(nfs);

  const t0 = performance.now();
  const tree = context.parse(".mo", source);
  const t1 = performance.now();
  console.log(`context.parse took ${(t1 - t0).toFixed(2)} ms`);

  console.log(`Root node: type=${tree.rootNode.type}, byteLength=${tree.rootNode.endIndex - tree.rootNode.startIndex}`);
  console.log(`Root namedChildren count: ${tree.rootNode.namedChildren.length}`);

  const blocksDir = path.dirname(filePath);
  console.log("Adding library:", blocksDir);
  await context.addLibrary(blocksDir);

  const symbols = context.queryEngine.index;
  console.log(`Indexed symbols count: ${symbols.symbols.size}`);

  console.log("Searching for Blocks classes in index:");
  let found = 0;
  for (const [id, sym] of symbols.symbols.entries()) {
    if (sym.name?.includes("Filter") || sym.name?.includes("PID") || sym.name?.includes("Continuous")) {
      console.log(`  - [${id}] kind=${sym.kind} name=${sym.name} resourceId=${sym.resourceId}`);
      if (++found >= 10) break;
    }
  }
}

main().catch(console.error);
