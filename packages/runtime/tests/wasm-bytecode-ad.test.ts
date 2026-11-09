// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { differentiateWasmModule } from "../src/autodiff/wasm-adjoint-synthesizer.js";
import {
  decodeWasmModule,
  encodeWasmModule,
  OP_BLOCK,
  OP_BR,
  OP_BR_IF,
  OP_CALL,
  OP_ELSE,
  OP_END,
  OP_F64_ABS,
  OP_F64_ADD,
  OP_F64_CONST,
  OP_F64_DIV,
  OP_F64_GT,
  OP_F64_LOAD,
  OP_F64_MUL,
  OP_F64_NEG,
  OP_F64_STORE,
  OP_F64_SUB,
  OP_I32_ADD,
  OP_I32_CONST,
  OP_I32_GE_S,
  OP_IF,
  OP_LOCAL_GET,
  OP_LOCAL_SET,
  OP_LOOP,
  OP_SELECT,
  TYPE_F64,
  TYPE_I32,
  TYPE_VOID,
  type WasmModule,
} from "../src/autodiff/wasm-cfg.js";

describe("WASM-Bytecode Reverse-Mode Automatic Differentiation Engine", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Decoder / Encoder Round-Trip Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe("Binary Round-Trip Validation", () => {
    it("decodes and re-encodes a WASM binary preserving executable semantics", async () => {
      const module: WasmModule = {
        types: [{ params: [TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "double", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_CONST, imm: 2.0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const encoded = encodeWasmModule(module);
      assert.ok(WebAssembly.validate(encoded));

      const decoded = decodeWasmModule(encoded);
      assert.equal(decoded.exports.length, 1);
      assert.equal(decoded.exports[0]!.name, "double");

      const reEncoded = encodeWasmModule(decoded);
      const instance = (await WebAssembly.instantiate(reEncoded)).instance;
      const fn = instance.exports.double as (x: number) => number;
      assert.equal(fn(7.5), 15.0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Single-Variable Polynomial: f(x) = 3*x^2 + 5*x - 2 -> f'(x) = 6*x + 5
  // ───────────────────────────────────────────────────────────────────────────
  describe("Single-Variable Polynomial Differentiation", () => {
    it("synthesizes exact adjoint for f(x) = 3*x^2 + 5*x - 2", async () => {
      const module: WasmModule = {
        types: [{ params: [TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "poly", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL }, // x^2
              { opcode: OP_F64_CONST, imm: 3.0 },
              { opcode: OP_F64_MUL }, // 3*x^2
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_CONST, imm: 5.0 },
              { opcode: OP_F64_MUL }, // 5*x
              { opcode: OP_F64_ADD }, // 3*x^2 + 5*x
              { opcode: OP_F64_CONST, imm: 2.0 },
              { opcode: OP_F64_SUB }, // 3*x^2 + 5*x - 2
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes, adjointExportName } = differentiateWasmModule(rawBytes, "poly");
      assert.equal(adjointExportName, "poly_adjoint");

      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      // Test at several points
      const testPoints = [-2.0, 0.0, 2.5, 4.0];
      for (const x of testPoints) {
        const expectedF = 3.0 * x * x + 5.0 * x - 2.0;
        const expectedDf = 6.0 * x + 5.0;

        const actualF = exp.poly(x);
        const actualDf = exp.poly_adjoint(x, 1.0);

        assert.equal(actualF, expectedF, `f(${x}) mismatch`);
        assert.equal(actualDf, expectedDf, `f'(${x}) mismatch`);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Multi-Variable Function: f(x, y) = x^2 * y + 2 * x * y
  // ───────────────────────────────────────────────────────────────────────────
  describe("Multi-Variable Function Differentiation", () => {
    it("synthesizes exact multi-value adjoint for f(x, y) = x^2 * y + 2 * x * y", async () => {
      const module: WasmModule = {
        types: [{ params: [TYPE_F64, TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "multivar", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL }, // x^2
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL }, // x^2 * y
              { opcode: OP_F64_CONST, imm: 2.0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL }, // 2 * x
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL }, // 2 * x * y
              { opcode: OP_F64_ADD }, // x^2 * y + 2 * x * y
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "multivar");
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      const x = 3.0;
      const y = 4.0;
      // df/dx = 2*x*y + 2*y = 2*3*4 + 2*4 = 24 + 8 = 32.0
      // df/dy = x^2 + 2*x = 9 + 6 = 15.0
      const grads = exp.multivar_adjoint(x, y, 1.0);
      assert.ok(Array.isArray(grads), "Multi-value adjoint returns an array in JS API");
      assert.equal(grads.length, 2);
      assert.equal(grads[0], 32.0, "df/dx mismatch");
      assert.equal(grads[1], 15.0, "df/dy mismatch");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Rational Function with Division: f(x) = (x - 1) / (x + 2)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Rational Function with Division", () => {
    it("synthesizes exact adjoint for f(x) = (x - 1) / (x + 2)", async () => {
      const module: WasmModule = {
        types: [{ params: [TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "rational", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_CONST, imm: 1.0 },
              { opcode: OP_F64_SUB }, // x - 1
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_CONST, imm: 2.0 },
              { opcode: OP_F64_ADD }, // x + 2
              { opcode: OP_F64_DIV }, // (x - 1) / (x + 2)
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "rational");
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      const x = 4.0;
      // f'(x) = 3 / (x + 2)^2. At x = 4, f'(4) = 3 / 36 = 1/12
      const actualDf = exp.rational_adjoint(x, 1.0);
      const expectedDf = 3.0 / 36.0;

      assert.ok(
        Math.abs(actualDf - expectedDf) < 1e-12,
        `Rational adjoint mismatch: got ${actualDf}, expected ${expectedDf}`,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Unary Negation: f(x) = -(x * x) - 4 * x
  // ───────────────────────────────────────────────────────────────────────────
  describe("Unary Negation Differentiation", () => {
    it("synthesizes adjoint for f(x) = -(x * x) - 4 * x", async () => {
      const module: WasmModule = {
        types: [{ params: [TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "negquad", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_F64_NEG }, // -(x^2)
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_CONST, imm: 4.0 },
              { opcode: OP_F64_MUL }, // 4*x
              { opcode: OP_F64_SUB }, // -(x^2) - 4*x
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "negquad");
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      const x = 1.0;
      // f'(x) = -2*x - 4. At x = 1, f'(1) = -6.0
      const actualDf = exp.negquad_adjoint(x, 1.0);
      assert.equal(actualDf, -6.0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Piecewise Branchless OP_SELECT & OP_F64_ABS Differentiation
  // ───────────────────────────────────────────────────────────────────────────
  describe("Piecewise OP_SELECT and OP_F64_ABS Differentiation", () => {
    it("synthesizes exact adjoint for select(x^2, 0.25*x, x > 0) and |x|*x", async () => {
      const module: WasmModule = {
        types: [{ params: [TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "piecewise", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              // val1 = x * x
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              // val2 = 0.25 * |x|
              { opcode: OP_F64_CONST, imm: 0.25 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_ABS },
              { opcode: OP_F64_MUL },
              // cond = x > 0.0
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_CONST, imm: 0.0 },
              { opcode: OP_F64_GT },
              // select(val1, val2, cond)
              { opcode: OP_SELECT },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "piecewise");
      assert.ok(WebAssembly.validate(wasmBytes));
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      // For x = 3.0 > 0: f(x) = x^2 = 9.0, f'(x) = 2*x = 6.0
      assert.equal(exp.piecewise(3.0), 9.0);
      assert.equal(exp.piecewise_adjoint(3.0, 1.0), 6.0);

      // For x = -4.0 <= 0: f(x) = 0.25 * |-4| = 1.0, f'(x) = -0.25
      assert.equal(exp.piecewise(-4.0), 1.0);
      assert.equal(exp.piecewise_adjoint(-4.0, 1.0), -0.25);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Structured Control Flow: OP_IF / OP_ELSE / OP_END
  // ───────────────────────────────────────────────────────────────────────────
  describe("Structured Branching (if / else / end) Differentiation", () => {
    it("synthesizes exact adjoint across both branches of structured if/else", async () => {
      // f(x, y): if (x > y) { return x * x * y; } else { return x + y * y; }
      const module: WasmModule = {
        types: [{ params: [TYPE_F64, TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        exports: [{ name: "branch_fn", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [{ count: 1, type: TYPE_F64 }], // local 2: result acc
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_GT },
              { opcode: OP_IF, imm: TYPE_VOID },
              // then: local 2 = x * x * y
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_SET, imm: 2 },
              { opcode: OP_ELSE },
              // else: local 2 = x + y * y
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL },
              { opcode: OP_F64_ADD },
              { opcode: OP_LOCAL_SET, imm: 2 },
              { opcode: OP_END },
              { opcode: OP_LOCAL_GET, imm: 2 },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "branch_fn");
      assert.ok(WebAssembly.validate(wasmBytes));
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      // Branch 1: x = 3.0 > y = 2.0 -> f = x^2 * y = 18, df/dx = 2*x*y = 12, df/dy = x^2 = 9
      assert.equal(exp.branch_fn(3.0, 2.0), 18.0);
      assert.deepEqual(exp.branch_fn_adjoint(3.0, 2.0, 1.0), [12.0, 9.0]);

      // Branch 2: x = 1.0 <= y = 4.0 -> f = x + y^2 = 17, df/dx = 1, df/dy = 2*y = 8
      assert.equal(exp.branch_fn(1.0, 4.0), 17.0);
      assert.deepEqual(exp.branch_fn_adjoint(1.0, 4.0, 1.0), [1.0, 8.0]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Loop Taping: Counted Loop OP_BLOCK / OP_LOOP / OP_BR_IF
  // ───────────────────────────────────────────────────────────────────────────
  describe("Counted Loop Forward-Value Taping & Reverse Adjoint Loop", () => {
    it("synthesizes exact adjoint for iterative power loop f(x, n) = x^n", async () => {
      // params: (x: f64, n: i32) -> f64
      // locals: acc: f64 (local 2), i: i32 (local 3)
      const module: WasmModule = {
        types: [{ params: [TYPE_F64, TYPE_I32], results: [TYPE_F64] }],
        functions: [0],
        memories: [{ min: 1 }],
        exports: [{ name: "pow_loop", kind: 0, index: 0 }],
        code: [
          {
            typeIdx: 0,
            locals: [
              { count: 1, type: TYPE_F64 }, // local 2: acc
              { count: 1, type: TYPE_I32 }, // local 3: i
            ],
            instructions: [
              // acc = 1.0
              { opcode: OP_F64_CONST, imm: 1.0 },
              { opcode: OP_LOCAL_SET, imm: 2 },
              // i = 0
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_LOCAL_SET, imm: 3 },
              // block { loop { if (i >= n) br 1; acc = acc * x; i = i + 1; br 0 } }
              { opcode: OP_BLOCK, imm: TYPE_VOID },
              { opcode: OP_LOOP, imm: TYPE_VOID },
              { opcode: OP_LOCAL_GET, imm: 3 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_I32_GE_S },
              { opcode: OP_BR_IF, imm: 1 },
              // acc = acc * x
              { opcode: OP_LOCAL_GET, imm: 2 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_SET, imm: 2 },
              // i = i + 1
              { opcode: OP_LOCAL_GET, imm: 3 },
              { opcode: OP_I32_CONST, imm: 1 },
              { opcode: OP_I32_ADD },
              { opcode: OP_LOCAL_SET, imm: 3 },
              { opcode: OP_BR, imm: 0 },
              { opcode: OP_END },
              { opcode: OP_END },
              // return acc
              { opcode: OP_LOCAL_GET, imm: 2 },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "pow_loop");
      assert.ok(WebAssembly.validate(wasmBytes));
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      // Test n = 0, 1, 3, 4 at x = 2.5
      const x = 2.5;
      assert.equal(exp.pow_loop(x, 0), 1.0);
      assert.equal(exp.pow_loop_adjoint(x, 0, 1.0), 0.0);

      assert.equal(exp.pow_loop(x, 1), 2.5);
      assert.equal(exp.pow_loop_adjoint(x, 1, 1.0), 1.0);

      // n = 3: f(x) = x^3 = 15.625, f'(x) = 3 * x^2 = 18.75
      assert.equal(exp.pow_loop(x, 3), 15.625);
      assert.equal(exp.pow_loop_adjoint(x, 3, 1.0), 18.75);

      // n = 4: f(x) = x^4 = 39.0625, f'(x) = 4 * x^3 = 62.5
      assert.equal(exp.pow_loop(x, 4), 39.0625);
      assert.equal(exp.pow_loop_adjoint(x, 4, 1.0), 62.5);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Linear Memory Shadowing: OP_F64_LOAD & OP_F64_STORE
  // ───────────────────────────────────────────────────────────────────────────
  describe("Linear Memory Shadowing (f64.load / f64.store)", () => {
    it("accumulates exact gradients into shadow linear memory for load/store kernels", async () => {
      // Kernel: reads a = mem[0], b = mem[8], stores tmp = a * a at mem[16], returns mem[16] * b = a^2 * b
      const module: WasmModule = {
        types: [{ params: [TYPE_F64], results: [TYPE_F64] }],
        functions: [0],
        memories: [{ min: 1 }],
        exports: [
          { name: "mem_kernel", kind: 0, index: 0 },
          { name: "memory", kind: 2, index: 0 },
        ],
        code: [
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              // mem[16] = mem[0] * mem[0]
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_F64_LOAD, imm: { align: 3, offset: 0 } },
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_F64_LOAD, imm: { align: 3, offset: 0 } },
              { opcode: OP_F64_MUL },
              { opcode: OP_F64_STORE, imm: { align: 3, offset: 16 } },
              // return mem[16] * mem[8] + x
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_F64_LOAD, imm: { align: 3, offset: 16 } },
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_F64_LOAD, imm: { align: 3, offset: 8 } },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_ADD },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const shadowOffset = 4096;
      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "mem_kernel", {
        shadowMemoryOffset: shadowOffset,
      });
      assert.ok(WebAssembly.validate(wasmBytes));
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;
      const memF64 = new Float64Array((exp.memory as WebAssembly.Memory).buffer);

      // Set a = mem[0] = 3.0, b = mem[8] = 5.0
      memF64[0] = 3.0;
      memF64[1] = 5.0;
      // Clear shadow memory at shadowOffset / 8
      const shadowBaseIdx = shadowOffset / 8;
      memF64[shadowBaseIdx + 0] = 0.0;
      memF64[shadowBaseIdx + 1] = 0.0;
      memF64[shadowBaseIdx + 2] = 0.0;

      // Forward check: a^2 * b + x = 9 * 5 + 2 = 47
      assert.equal(exp.mem_kernel(2.0), 47.0);

      // Adjoint check with seed bar_y = 1.0:
      // df/dx = 1.0
      // df/da (shadow mem[0]) = 2 * a * b = 2 * 3 * 5 = 30.0
      // df/db (shadow mem[8]) = a^2 = 9.0
      const dfDx = exp.mem_kernel_adjoint(2.0, 1.0);
      assert.equal(dfDx, 1.0);
      assert.equal(memF64[shadowBaseIdx + 0], 30.0, "shadow gradient d/d(mem[0]) mismatch");
      assert.equal(memF64[shadowBaseIdx + 1], 9.0, "shadow gradient d/d(mem[8]) mismatch");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Inter-Procedural Function Calls (OP_CALL) Across WASM Function Table
  // ───────────────────────────────────────────────────────────────────────────
  describe("Inter-Procedural Function Calls (OP_CALL)", () => {
    it("recursively synthesizes helper adjoints across a 3-function call graph", async () => {
      // fn 0: h(w: f64) -> f64 = w * w * w
      // fn 1: g(u: f64, v: f64) -> f64 = u * u * v + h(v)
      // fn 2: f(x: f64, y: f64) -> f64 = g(x + y, x * y) + h(x)
      const module: WasmModule = {
        types: [
          { params: [TYPE_F64], results: [TYPE_F64] },
          { params: [TYPE_F64, TYPE_F64], results: [TYPE_F64] },
        ],
        functions: [0, 1, 1],
        exports: [{ name: "call_graph_f", kind: 0, index: 2 }],
        code: [
          // fn 0: h(w) = w^3
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_END },
            ],
          },
          // fn 1: g(u, v) = u^2 * v + h(v)
          {
            typeIdx: 1,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_CALL, imm: 0 },
              { opcode: OP_F64_ADD },
              { opcode: OP_END },
            ],
          },
          // fn 2: f(x, y) = g(x + y, x * y) + h(x)
          {
            typeIdx: 1,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_ADD },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL },
              { opcode: OP_CALL, imm: 1 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_CALL, imm: 0 },
              { opcode: OP_F64_ADD },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "call_graph_f");
      assert.ok(WebAssembly.validate(wasmBytes));
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      const x = 1.5;
      const y = 2.0;
      const u = x + y; // 3.5
      const v = x * y; // 3.0
      const expectedVal = u * u * v + v * v * v + x * x * x;
      assert.ok(Math.abs(exp.call_graph_f(x, y) - expectedVal) < 1e-12);

      // Analytical partials:
      // dg/du = 2 * u * v
      // dg/dv = u^2 + 3 * v^2
      // df/dx = dg/du * 1 + dg/dv * y + 3 * x^2
      // df/dy = dg/du * 1 + dg/dv * x
      const dgDu = 2 * u * v;
      const dgDv = u * u + 3 * v * v;
      const expectedDx = dgDu + dgDv * y + 3 * x * x;
      const expectedDy = dgDu + dgDv * x;

      const [dfDx, dfDy] = exp.call_graph_f_adjoint(x, y, 1.0);
      assert.ok(Math.abs(dfDx - expectedDx) < 1e-12, `df/dx=${dfDx} vs expected=${expectedDx}`);
      assert.ok(Math.abs(dfDy - expectedDy) < 1e-12, `df/dy=${dfDy} vs expected=${expectedDy}`);
    });

    it("differentiates OP_CALL invoked inside a counted loop with automatic argument taping", async () => {
      // fn 0: step(acc: f64, x: f64) -> f64 = acc * x + x * x
      // fn 1: loop_call(x: f64, n: i32) -> f64
      const module: WasmModule = {
        types: [
          { params: [TYPE_F64, TYPE_F64], results: [TYPE_F64] },
          { params: [TYPE_F64, TYPE_I32], results: [TYPE_F64] },
        ],
        functions: [0, 1],
        exports: [{ name: "loop_call", kind: 0, index: 1 }],
        code: [
          // fn 0: step(acc, x) = acc * x + x * x
          {
            typeIdx: 0,
            locals: [],
            instructions: [
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_F64_MUL },
              { opcode: OP_F64_ADD },
              { opcode: OP_END },
            ],
          },
          // fn 1: loop_call(x, n)
          {
            typeIdx: 1,
            locals: [
              { count: 1, type: TYPE_F64 }, // local 2: acc
              { count: 1, type: TYPE_I32 }, // local 3: i
            ],
            instructions: [
              { opcode: OP_F64_CONST, imm: 1.0 },
              { opcode: OP_LOCAL_SET, imm: 2 },
              { opcode: OP_I32_CONST, imm: 0 },
              { opcode: OP_LOCAL_SET, imm: 3 },
              { opcode: OP_BLOCK, imm: TYPE_VOID },
              { opcode: OP_LOOP, imm: TYPE_VOID },
              { opcode: OP_LOCAL_GET, imm: 3 },
              { opcode: OP_LOCAL_GET, imm: 1 },
              { opcode: OP_I32_GE_S },
              { opcode: OP_BR_IF, imm: 1 },
              // acc = step(acc, x)
              { opcode: OP_LOCAL_GET, imm: 2 },
              { opcode: OP_LOCAL_GET, imm: 0 },
              { opcode: OP_CALL, imm: 0 },
              { opcode: OP_LOCAL_SET, imm: 2 },
              // i += 1
              { opcode: OP_LOCAL_GET, imm: 3 },
              { opcode: OP_I32_CONST, imm: 1 },
              { opcode: OP_I32_ADD },
              { opcode: OP_LOCAL_SET, imm: 3 },
              { opcode: OP_BR, imm: 0 },
              { opcode: OP_END },
              { opcode: OP_END },
              { opcode: OP_LOCAL_GET, imm: 2 },
              { opcode: OP_END },
            ],
          },
        ],
        rawSections: [],
      };

      const rawBytes = encodeWasmModule(module);
      const { wasmBytes } = differentiateWasmModule(rawBytes, "loop_call");
      assert.ok(WebAssembly.validate(wasmBytes));
      const compiled = await WebAssembly.instantiate(wasmBytes);
      const exp = compiled.instance.exports as any;

      // For n = 3 iterations starting from acc_0 = 1:
      // acc_1 = x + x^2
      // acc_2 = (x + x^2)*x + x^2 = 2*x^2 + x^3
      // acc_3 = (2*x^2 + x^3)*x + x^2 = x^2 + 2*x^3 + x^4
      // d(acc_3)/dx = 2*x + 6*x^2 + 4*x^3
      const x = 2.0;
      const expectedVal = x * x + 2 * x ** 3 + x ** 4; // 4 + 16 + 16 = 36
      const expectedGrad = 2 * x + 6 * x * x + 4 * x ** 3; // 4 + 24 + 32 = 60
      assert.equal(exp.loop_call(x, 3), expectedVal);
      assert.equal(exp.loop_call_adjoint(x, 3, 1.0), expectedGrad);
    });
  });
});
