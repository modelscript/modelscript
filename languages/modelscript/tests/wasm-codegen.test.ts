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

  await t.test(
    "compiles and executes struct instantiation, field access, and array indexing in WebAssembly",
    async () => {
      const code = `
      @unmanaged
      struct Vector2D {
        x: f64;
        y: f64;
        tag: i32;
      }

      function computeStructAndArray(): f64 {
        let v = new Vector2D(3.0, 4.0, 7);
        let weights = [10, 20, 30];
        let magSq: f64 = (v.x * v.x) + (v.y * v.y);
        let bonus: i32 = v.tag + weights[1] + weights.length;
        return magSq + bonus;
      }
    `;

      const wasmResult = await compiler.executeWasm(code, "computeStructAndArray", []);
      // magSq = 9 + 16 = 25; bonus = 7 + 20 + 3 = 30; total = 55
      assert.equal(wasmResult, 55);
    },
  );

  await t.test(
    "compiles and executes STRING literals, ObjectLiterals, and FLWORExpressions in WebAssembly",
    async () => {
      const code = `
      function evaluateAdvanced(): i32 {
        let greeting = "ModelScript";
        let cfg = { base: 100, scale: 3 };
        let nums = [1, 2, 3, 4, 5];
        let filtered =
          for x in nums
          where x > 2
          return x * cfg.scale;
        return greeting.length + cfg.base + filtered.length + filtered[0] + filtered[2];
      }
    `;

      const wat = compiler.compileToWat(code);
      assert.ok(wat.includes("(data (i32.const"), "WAT should emit static data segment for interned strings");
      assert.ok(wat.includes("memory.grow"), "WAT should emit $__alloc with memory.grow bounds check");

      const wasmResult = await compiler.executeWasm(code, "evaluateAdvanced", []);
      // greeting.length = 11 ("ModelScript")
      // cfg.base = 100
      // filtered = [9, 12, 15], length = 3, filtered[0] = 9, filtered[2] = 15
      // total = 11 + 100 + 3 + 9 + 15 = 138
      assert.equal(wasmResult, 138);
    },
  );

  await t.test(
    "emits type-accurate u32 unsigned opcodes (i32.div_u, i32.lt_u, i32.gt_u) and f32 instructions",
    async () => {
      const code = `
      function unsignedMath(a: u32, b: u32): u32 {
        if (a > b && b < a) {
          return a / b;
        }
        return 0;
      }

      function float32Math(x: f32, y: f32): f32 {
        let z: f32 = (x * y) + x;
        return z / y;
      }
    `;

      const wat = compiler.compileToWat(code);
      assert.ok(wat.includes("i32.gt_u"), "Expected i32.gt_u for u32 > comparison");
      assert.ok(wat.includes("i32.lt_u"), "Expected i32.lt_u for u32 < comparison");
      assert.ok(wat.includes("i32.div_u"), "Expected i32.div_u for u32 division");
      assert.ok(wat.includes("f32.mul"), "Expected f32.mul for f32 multiplication");
      assert.ok(wat.includes("f32.add"), "Expected f32.add for f32 addition");
      assert.ok(wat.includes("f32.div"), "Expected f32.div for f32 division");

      // 0x80000000 (2147483648 as unsigned u32, negative in signed i32) / 2 = 1073741824
      const uRes = await compiler.executeWasm(code, "unsignedMath", [0x80000000 | 0, 2]);
      assert.equal(uRes >>> 0, 1073741824);

      // (4.0 * 2.0 + 4.0) / 2.0 = 6.0
      const fRes = await compiler.executeWasm(code, "float32Math", [4.0, 2.0]);
      assert.ok(Math.abs(fRes - 6.0) < 1e-5);
    },
  );

  await t.test("compiles and executes multi-for relational joins and order by sorting in FLWORExpression", async () => {
    const code = `
      function relationalJoinAndSort(): i32 {
        let sensors = [1, 2, 3, 4];
        let actuators = [2, 4, 6];
        let joined =
          for s in sensors
          for a in actuators
          where s == (a / 2)
          order by (s * 100 + a) descending
          return s * 100 + a;
        return joined.length * 10000 + joined[0] * 10 + joined[2];
      }
    `;

    const wasmResult = await compiler.executeWasm(code, "relationalJoinAndSort", []);
    // Matching pairs (s, a) where s == a / 2:
    // (1, 2) -> 102
    // (2, 4) -> 204
    // (3, 6) -> 306
    // Sorted descending: [306, 204, 102], length = 3
    // Result: 3 * 10000 + 306 * 10 + 102 = 30000 + 3060 + 102 = 33162
    assert.equal(wasmResult, 33162);
  });
});
