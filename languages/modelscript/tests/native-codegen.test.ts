// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ModelScriptCompiler } from "../src/index.js";

test("Phase 6: Standalone Platform Native Binaries", async (t) => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const outBin = path.resolve("languages/modelscript/tests/native_math_app");

  await t.test("compiles ModelScript code directly to a standalone native Linux ELF binary", async () => {
    const code = `
      function calculate(a: i32, b: i32): i32 {
        return a * b + 2;
      }

      function main(): i32 {
        let x: i32 = 8;
        let y: i32 = 5;
        return calculate(x, y);
      }
    `;

    const generatedPath = await compiler.compileToNative(code, {
      outPath: outBin,
      entryFn: "main",
    });

    assert.equal(generatedPath, outBin);
    assert.ok(fs.existsSync(outBin), "Native executable binary must exist on disk");

    // Execute the standalone platform binary directly
    const stdout = execFileSync(outBin).toString();
    assert.ok(stdout.includes("Result: 42"), `Binary output must match calculation: ${stdout}`);

    // Cleanup
    if (fs.existsSync(outBin)) {
      fs.unlinkSync(outBin);
    }
  });
});
