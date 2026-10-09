// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateFmu } from "@modelscript/exchange/fmu";
import { DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { generateSimulationC } from "../src/commands/sim-c-codegen.js";

describe("Chunked C Codegen and Full -O3 Compilation", () => {
  test("generates standard inline functions for small models (<= 100 equations)", () => {
    const dae = new DAEBuilder();
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
    const derX = dae.addVariable("der(x)", VarType.Real, Variability.Continuous, 0, 0.0);

    // der(x) = -x
    const xExpr = dae.addNameExpr("x");
    const negX = dae.addUnaryExpr(dae.interner.intern("-"), xExpr);
    const derXExpr = dae.addNameExpr("der(x)");
    dae.addEquation(EqKind.Simple, derXExpr, negX);

    const fmuResult = generateFmu(dae, { modelIdentifier: "SmallTest", generationTool: "ModelScript CLI" });
    const cSource = generateSimulationC(dae, fmuResult, {
      modelIdentifier: "SmallTest",
      startTime: 0,
      stopTime: 1,
      stepSize: 0.1,
    });

    assert.ok(cSource.includes("static void model_get_derivatives(void) {"), "Must contain model_get_derivatives");
    assert.ok(!cSource.includes("model_get_derivatives_chunk_"), "Small model should not be chunked");
    assert.ok(cSource.includes("const double * __restrict__ s"), "Must include __restrict__ on state sync");
  });

  test("generates chunked static subroutines for large models (> 100 equations) and compiles with -O3", () => {
    const N = 250; // 250 equations
    const dae = new DAEBuilder();

    for (let i = 0; i < N; i++) {
      const vName = `x_${i}`;
      const derName = `der(x_${i})`;
      dae.addVariable(vName, VarType.Real, Variability.Continuous, 0, 1.0 + i * 0.01);
      dae.addVariable(derName, VarType.Real, Variability.Continuous, 0, 0.0);

      const xExpr = dae.addNameExpr(vName);
      const negX = dae.addUnaryExpr(dae.interner.intern("-"), xExpr);
      const derExpr = dae.addNameExpr(derName);
      dae.addEquation(EqKind.Simple, derExpr, negX);
    }

    const fmuResult = generateFmu(dae, { modelIdentifier: "LargeChunkedTest", generationTool: "ModelScript CLI" });
    const cSource = generateSimulationC(dae, fmuResult, {
      modelIdentifier: "LargeChunkedTest",
      startTime: 0,
      stopTime: 1,
      stepSize: 0.01,
    });

    // Check chunking
    assert.ok(cSource.includes("static inline void model_get_derivatives_chunk_0(void)"), "Must emit chunk 0");
    assert.ok(cSource.includes("static inline void model_get_derivatives_chunk_1(void)"), "Must emit chunk 1");
    assert.ok(cSource.includes("static inline void model_get_derivatives_chunk_2(void)"), "Must emit chunk 2");
    assert.ok(cSource.includes("model_get_derivatives_chunk_0();"), "Main function must call chunk 0");
    assert.ok(cSource.includes("model_get_derivatives_chunk_1();"), "Main function must call chunk 1");
    assert.ok(cSource.includes("model_get_derivatives_chunk_2();"), "Main function must call chunk 2");

    // Verify chunking in initialization
    assert.ok(cSource.includes("static inline void model_initialize_chunk_0(void)"), "Must emit init chunk 0");
    assert.ok(cSource.includes("model_initialize_chunk_0();"), "model_initialize must call chunk 0");

    // Test compiling with gcc -O3 -fno-math-errno
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-chunk-test-"));
    const cFile = path.join(tmpDir, "LargeChunkedTest.c");
    const binFile = path.join(tmpDir, "LargeChunkedTest");
    fs.writeFileSync(cFile, cSource);

    const cc = process.env.CC ?? "gcc";
    execSync(`${cc} -O3 -fno-math-errno -w "${cFile}" -o "${binFile}" -lm`, {
      stdio: "pipe",
      timeout: 30000,
    });

    assert.ok(fs.existsSync(binFile), "Compiled binary must exist");

    // Execute binary and verify simulation completes
    const output = execSync(`"${binFile}"`, { stdio: "pipe", timeout: 10000 }).toString("utf-8");
    assert.ok(output.includes("time,"), "Output must contain CSV header");
    assert.ok(output.split("\n").length > 10, "Output must contain multiple time steps");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("  ✔ Chunked C codegen successfully compiled with -O3 -fno-math-errno and executed cleanly");
  });
});
