// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * End-to-End Modelica Source Parsing and Flattening Benchmark (100k, 1M, 10M Array Elements).
 */

import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  console.log("=========================================================================================");
  console.log(" End-to-End Modelica Source Code Parsing & Flattening (Array-Preserving Mode)");
  console.log("=========================================================================================\n");

  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const scales = [100_000, 1_000_000, 10_000_000];

  for (const n of scales) {
    const modelSource = `model LargeVectorODE
  parameter Integer N = ${n};
  Real x[N];
equation
  der(x) = -x;
end LargeVectorODE;
`;

    const ctx = new Context(new NodeFileSystem());
    const uri = `file:///LargeVectorODE_${n}.mo`;

    const tParse0 = performance.now();
    ctx.load(modelSource, uri);
    const parseTimeMs = performance.now() - tParse0;

    const tFlat0 = performance.now();
    const dae = ctx.flattenArena("LargeVectorODE", undefined, uri, { arrayMode: "preserve" });
    const flattenTimeMs = performance.now() - tFlat0;

    const totalElements = dae ? dae.getVarTotalScalarElements() : 0;
    const totalTimeMs = parseTimeMs + flattenTimeMs;

    console.log(
      `Scale N = ${n.toLocaleString().padStart(10)}: ` +
        `Parse: ${parseTimeMs.toFixed(2)}ms | ` +
        `Flatten: ${flattenTimeMs.toFixed(2)}ms | ` +
        `Total: ${totalTimeMs.toFixed(2)}ms | ` +
        `Reported Elements: ${totalElements.toLocaleString()}`,
    );
  }

  console.log("\n=========================================================================================");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
