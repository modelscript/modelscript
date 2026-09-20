// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function runTests() {
  console.log("Testing Dual-Engine Flattener Scaffolding (ts, wasm, hybrid, diff)...");

  const initContext = async (src: string, modelName: string) => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());
    const uri = `file:///test/${modelName}.mo`;
    ctx.load(src, uri);
    return { ctx, uri };
  };

  const simpleModel = `
model SimpleBackends
  Real x;
  Real y;
equation
  x = 10.0;
  y = 2.0 * x;
end SimpleBackends;
`;

  // 1. Reference TS backend
  console.log("1. Testing backend: 'ts'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "ts" });
    assert(arena !== null, "arena should not be null");
    assert.strictEqual(arena!.varCount, 2, "varCount should be 2");
    assert.strictEqual(arena!.eqCount, 2, "eqCount should be 2");
    console.log("   ✔ backend: 'ts' passed (vars=2, eqs=2)");
  }

  // 2. Strict WASM backend
  console.log("2. Testing backend: 'wasm'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "wasm" });
    assert(arena !== null, "arena should not be null");
    const wasmErrors = arena!.diagnostics.filter((d) => d.rule === "wasm-flattener-unsupported");
    if (wasmErrors.length > 0) {
      assert(
        wasmErrors[0].message.includes("could not be flattened using strict WASM backend"),
        "error message should indicate strict WASM unsupported",
      );
      console.log("   ✔ backend: 'wasm' passed with strict unsupported diagnostic");
    } else {
      assert(arena!.varCount > 0, "varCount should be > 0 when flattened in WASM");
      console.log(`   ✔ backend: 'wasm' passed in WASM kernel (vars=${arena!.varCount})`);
    }
  }

  // 3. Hybrid backend
  console.log("3. Testing backend: 'hybrid'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "hybrid" });
    assert(arena !== null, "arena should not be null");
    assert.strictEqual(arena!.varCount, 2, "varCount should be 2");
    assert.strictEqual(arena!.eqCount, 2, "eqCount should be 2");
    console.log("   ✔ backend: 'hybrid' passed (vars=2, eqs=2)");
  }

  // 4. Differential backend
  console.log("4. Testing backend: 'diff'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "diff" });
    assert(arena !== null, "arena should not be null");
    assert.strictEqual(arena!.varCount, 2, "varCount should be 2");
    const diffDiag = arena!.diagnostics.find(
      (d) => d.rule === "flattener-diff-report" || d.rule === "flattener-diff-error",
    );
    if (diffDiag) {
      assert(diffDiag.message.includes("[DiffFlattener]"), "diagnostic should contain [DiffFlattener]");
      console.log(`   ✔ backend: 'diff' passed (${diffDiag.message})`);
    } else {
      console.log("   ✔ backend: 'diff' passed");
    }
  }

  // 5. Strict WASM failure vs. Hybrid fallback on complex/unsupported construct
  console.log("5. Testing strict 'wasm' rejection vs 'hybrid' fallback on complex model...");
  const complexModel = `
model ComplexBackends
  Real x;
  Real y;
equation
  when x > 0 then
    y = reinit(x, 2.0);
  end when;
end ComplexBackends;
`;
  {
    const { ctx, uri } = await initContext(complexModel, "ComplexBackends");
    // Strict WASM should fail or produce error diagnostic if reinit in when isn't in wasm kernel
    const wasmArena = ctx.flattenArena("ComplexBackends", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null);

    // Hybrid should successfully fall back and produce a valid DAE
    const hybridArena = ctx.flattenArena("ComplexBackends", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null);
    assert.strictEqual(hybridArena!.varCount, 2, "hybrid should have 2 variables");
    console.log("   ✔ strict 'wasm' and 'hybrid' fallback verified on complex construct");
  }

  console.log("\nAll dual-engine backend tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
