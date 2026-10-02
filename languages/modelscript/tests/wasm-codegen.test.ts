// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler } from "../src/index.js";

test("Phase 5: WebAssembly Emitter & Linear Memory IR", async (t) => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  await t.test("emits valid WebAssembly text (WAT) for arithmetic", () => {
    const code = `
      function add(a: i32, b: i32): i32 {
        return a + b;
      }
    `;

    const wat = compiler.compileToWat(code);
    assert.ok(wat.includes("(module"), "WAT should declare module");
    assert.ok(wat.includes("(func $add (param $a i32) (param $b i32) (result i32)"), "Function signature matches");
    assert.ok(wat.includes("i32.add"), "Uses i32.add instruction");
  });

  await t.test("executes compiled WASM module and matches JS evaluation for arithmetic", async () => {
    const code = `
      function multiply(x: i32, y: i32): i32 {
        return x * y;
      }
    `;

    const wasmResult = await compiler.executeWasm(code, "multiply", [6, 7]);
    assert.equal(wasmResult, 42);

    const jsResult = compiler.executeJs(`${code}\nreturn multiply(6, 7);`);
    assert.equal(jsResult, wasmResult);
  });

  await t.test("executes iterative Fibonacci in WebAssembly and verifies numeric parity with JS", async () => {
    const code = `
      function fibonacci(n: i32): i32 {
        if (n <= 1) return n;
        let a: i32 = 0;
        let b: i32 = 1;
        let i: i32 = 2;
        while (i <= n) {
          let next: i32 = a + b;
          a = b;
          b = next;
          i = i + 1;
        }
        return b;
      }
    `;

    const n = 10;
    const wasmFib10 = await compiler.executeWasm(code, "fibonacci", [n]);
    assert.equal(wasmFib10, 55);

    const jsFib10 = compiler.executeJs(`${code}\nreturn fibonacci(${n});`);
    assert.equal(jsFib10, wasmFib10);
  });

  await t.test("compiles and executes floating point arithmetic in WebAssembly", async () => {
    const code = `
      function calculateArea(radius: f64): f64 {
        let pi: f64 = 3.141592653589793;
        return pi * radius * radius;
      }
    `;

    const wasmArea = await compiler.executeWasm(code, "calculateArea", [2.5]);
    const expected = 3.141592653589793 * 2.5 * 2.5;
    assert.ok(Math.abs(wasmArea - expected) < 1e-9);
  });
});
