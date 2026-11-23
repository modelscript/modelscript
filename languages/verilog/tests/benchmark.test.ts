// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getVerilogStdLibWasmBytes } from "../src/catalog/verilog-std-lib-data.js";
import { parseVerilog } from "../src/parser/index.js";
import { VerilogSimulator } from "../src/solver/index.js";

describe("Verilog 4-State Event-Driven RTL Simulator Benchmarks", () => {
  it("Benchmark 1: 4-bit ALU (ADD, SUB, AND, OR, XOR, NOT, SHL, SHR + zero flag)", () => {
    const design = parseVerilog(`
      module alu4 (
        input [3:0] a,
        input [3:0] b,
        input [2:0] op,
        output reg [3:0] y,
        output wire zero
      );
        assign zero = (y == 4'b0000);
        always @(*) begin
          case (op)
            3'b000: y = a + b;
            3'b001: y = a - b;
            3'b010: y = a & b;
            3'b011: y = a | b;
            3'b100: y = a ^ b;
            3'b101: y = ~a;
            3'b110: y = a << 1;
            3'b111: y = a >> 1;
            default: y = 4'b0000;
          endcase
        end
      endmodule
    `);

    const sim = new VerilogSimulator(design);

    // ADD: 6 + 5 = 11 (4'b1011)
    sim.step({ a: 6, b: 5, op: 0 });
    assert.strictEqual(sim.getInt("y"), 11);
    assert.strictEqual(sim.getInt("zero"), 0);

    // SUB: 5 - 5 = 0 -> zero = 1
    sim.step({ a: 5, b: 5, op: 1 });
    assert.strictEqual(sim.getInt("y"), 0);
    assert.strictEqual(sim.getInt("zero"), 1);

    // AND: 0b1100 & 0b1010 = 0b1000 (8)
    sim.step({ a: "1100", b: "1010", op: 2 });
    assert.strictEqual(sim.getInt("y"), 0b1000);

    // OR: 0b1100 | 0b1010 = 0b1110 (14)
    sim.step({ a: "1100", b: "1010", op: 3 });
    assert.strictEqual(sim.getInt("y"), 0b1110);

    // XOR: 0b1100 ^ 0b1010 = 0b0110 (6)
    sim.step({ a: "1100", b: "1010", op: 4 });
    assert.strictEqual(sim.getInt("y"), 0b0110);

    // NOT: ~0b0101 = 0b1010 (10)
    sim.step({ a: "0101", b: 0, op: 5 });
    assert.strictEqual(sim.getInt("y"), 0b1010);

    // SHL: 0b0011 << 1 = 0b0110 (6)
    sim.step({ a: "0011", b: 0, op: 6 });
    assert.strictEqual(sim.getInt("y"), 0b0110);

    // SHR: 0b1010 >> 1 = 0b0101 (5)
    sim.step({ a: "1010", b: 0, op: 7 });
    assert.strictEqual(sim.getInt("y"), 0b0101);
  });

  it("Benchmark 2: Synchronous 4-bit shift register over rising clock edges", () => {
    const design = parseVerilog(`
      module shift_reg4 (
        input clk,
        input rst,
        input sin,
        output reg [3:0] q
      );
        always @(posedge clk) begin
          if (rst)
            q <= 4'b0000;
          else
            q <= {q[2:0], sin};
        end
      endmodule
    `);

    const sim = new VerilogSimulator(design);

    // Synchronous reset
    sim.step({ clk: 0, rst: 1, sin: 0 });
    sim.step({ clk: 1, rst: 1, sin: 0 });
    assert.strictEqual(sim.getSignal("q").toBitString(), "0000");

    // Shift in bit sequence 1, 0, 1, 1
    const bits = [1, 0, 1, 1];
    const expected = ["0001", "0010", "0101", "1011"];
    for (let i = 0; i < bits.length; i++) {
      sim.step({ clk: 0, rst: 0, sin: bits[i]! });
      sim.step({ clk: 1, rst: 0, sin: bits[i]! });
      assert.strictEqual(sim.getSignal("q").toBitString(), expected[i]);
    }
  });

  it("Benchmark 3: LFSR PRBS-7 maximal-length sequence parity (period 127) vs WASM kernel", async () => {
    const design = parseVerilog(`
      module lfsr_prbs7 (
        input clk,
        input rst,
        output reg [6:0] q
      );
        wire feedback;
        assign feedback = q[6] ^ q[5];
        always @(posedge clk) begin
          if (rst)
            q <= 7'b1111111;
          else
            q <= {q[5:0], feedback};
        end
      endmodule
    `);

    const wasmBytes = getVerilogStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const stepLfsr7 = instance.exports["verilogStepLfsr7"] as (state: number) => number;

    const sim = new VerilogSimulator(design);
    sim.step({ clk: 0, rst: 1 });
    sim.step({ clk: 1, rst: 1 });
    assert.strictEqual(sim.getInt("q"), 0x7f);

    let refState = 0x7f;
    const seen = new Set<number>([refState]);

    for (let cycle = 1; cycle <= 127; cycle++) {
      sim.step({ clk: 0, rst: 0 });
      sim.step({ clk: 1, rst: 0 });
      refState = stepLfsr7(refState);
      const simVal = sim.getInt("q");
      assert.strictEqual(simVal, refState, `Mismatch at PRBS-7 cycle ${cycle}`);
      if (cycle < 127) {
        assert.ok(!seen.has(refState), `Premature repetition at cycle ${cycle}`);
        seen.add(refState);
      }
    }

    // Must return to seed 0x7f after exactly 127 cycles (2^7 - 1) with zero residual
    const residual = Math.abs(sim.getInt("q") - 0x7f);
    assert.ok(residual <= 0, `Expected zero residual, got ${residual}`);
    assert.strictEqual(seen.size, 127);
  });

  it("Benchmark 4: Gate-level full-adder 4-state X/Z propagation & tri-state buffer", () => {
    const design = parseVerilog(`
      module full_adder_gates (
        input a,
        input b,
        input cin,
        input oe,
        output wire sum,
        output wire cout,
        output tri sum_tri
      );
        wire s1, c1, c2;
        xor g1 (s1, a, b);
        xor g2 (sum, s1, cin);
        and g3 (c1, a, b);
        and g4 (c2, s1, cin);
        or  g5 (cout, c1, c2);
        bufif1 g6 (sum_tri, sum, oe);
      endmodule
    `);

    const sim = new VerilogSimulator(design);

    // Exhaustive 2-state truth table (8 combinations)
    for (let a = 0; a <= 1; a++) {
      for (let b = 0; b <= 1; b++) {
        for (let cin = 0; cin <= 1; cin++) {
          sim.step({ a, b, cin, oe: 1 });
          const total = a + b + cin;
          assert.strictEqual(sim.getInt("sum"), total & 1);
          assert.strictEqual(sim.getInt("cout"), (total >> 1) & 1);
          assert.strictEqual(sim.getInt("sum_tri"), total & 1);
        }
      }
    }

    // Tri-state disable -> Z on sum_tri
    sim.step({ a: 1, b: 0, cin: 0, oe: 0 });
    assert.strictEqual(sim.getSignal("sum").toBitString(), "1");
    assert.strictEqual(sim.getSignal("sum_tri").toBitString(), "Z");

    // Controlling value masking: a=1, b=1, cin=X -> sum=X, but cout=1 because c1 = a & b = 1 dominates OR gate!
    sim.step({ a: "1", b: "1", cin: "X", oe: "1" });
    assert.strictEqual(sim.getSignal("sum").toBitString(), "X");
    assert.strictEqual(sim.getSignal("cout").toBitString(), "1");

    // Controlling value 0 masking: a=0, b=0, cin=Z -> sum=X, cout=0 (because a&b=0 and s1=0 so s1&cin=0!)
    sim.step({ a: "0", b: "0", cin: "Z", oe: "1" });
    assert.strictEqual(sim.getSignal("sum").toBitString(), "X");
    assert.strictEqual(sim.getSignal("cout").toBitString(), "0");
  });
});
