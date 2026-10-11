// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { ModelicaFlattener } from "../src/flattener/class-flattener.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  console.log("=== Modelica WASM Flattener Fallback Profiler (Step 3.1) ===");
  const { parser } = await createWasmParser(modelicaWasmPath);
  Context.registerParser(".mo", parser);

  const nfs = new NodeFileSystem();
  const context = new Context(nfs);

  const pkgArg = process.argv[2] || "Electrical/Analog";
  const targetDir = path.resolve(__dirname, "../../../data/libraries/Modelica/4.1.0/extracted/Modelica", pkgArg);

  console.log(`Adding library: ${targetDir}`);
  await context.addLibrary(targetDir);

  const index = context.queryEngine.index;
  console.log(`Indexed symbols count: ${index.symbols.size}`);

  const queryDB = (context as any).queryEngine.toQueryDB();
  const flattener = new ModelicaFlattener(queryDB, {
    backend: "hybrid",
    useWasmKernel: true,
  });

  const histogram = new Map<string, number>();
  let totalModels = 0;
  let supportedModels = 0;
  let unsupportedModels = 0;

  for (const [id, sym] of index.symbols.entries()) {
    if (sym.kind === "Class" || sym.kind === "Model" || sym.kind === "Block") {
      const prefixes = String(sym.metadata?.classPrefixes ?? sym.metadata?.classKind ?? "");
      if (prefixes.includes("package")) continue;
      totalModels++;
      const reasons = flattener.getUnsupportedWasmReasons(id);
      if (reasons.length === 0) {
        supportedModels++;
      } else {
        unsupportedModels++;
        console.log(`[FALLBACK] ${sym.name}: ${reasons.join(", ")}`);
        for (const r of reasons) {
          // Normalize reason prefix (e.g. extends:X(...) -> extends:unsupported)
          const key = r.startsWith("extends:")
            ? "extends:unsupported"
            : r.startsWith("child-component:")
              ? "child-component:unsupported"
              : r.startsWith("nested-class:")
                ? "nested-class"
                : r.startsWith("component-causality:")
                  ? "component-causality"
                  : r.startsWith("duplicate-name:")
                    ? "duplicate-name"
                    : r;
          histogram.set(key, (histogram.get(key) ?? 0) + 1);
        }
      }
    }
  }

  console.log("\n============================================================");
  console.log(`Total Classes/Models Inspected: ${totalModels}`);
  console.log(
    `WASM-Eligible (0 Fallback Reasons): ${supportedModels} (${((supportedModels / totalModels) * 100).toFixed(1)}%)`,
  );
  console.log(`Falling back to TS: ${unsupportedModels} (${((unsupportedModels / totalModels) * 100).toFixed(1)}%)`);
  console.log("============================================================\n");

  console.log("Fallback Reasons Histogram (sorted by frequency):");
  const sorted = Array.from(histogram.entries()).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    const pct = ((count / unsupportedModels) * 100).toFixed(1);
    console.log(`  - ${reason.padEnd(30)} : ${count.toString().padStart(4)} models (${pct}%)`);
  }
}

main().catch(console.error);
