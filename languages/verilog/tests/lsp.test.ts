// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verilogIndexing } from "../src/indexing.js";
import { executeVerilogAction, getVerilogDocumentSymbols, getVerilogHover, validateVerilog } from "../src/lsp.js";

const SAMPLE_SRC = `module adder4 (
  input [3:0] a,
  input [3:0] b,
  output [3:0] sum
);
  assign sum = a + b;
endmodule
`;

describe("Verilog Indexing & LSP Services", () => {
  it("recognizes .v/.vh/.vl URIs and Verilog content in verilogIndexing", () => {
    assert.strictEqual(verilogIndexing.canIndex("alu.v", ""), true);
    assert.strictEqual(verilogIndexing.canIndex("defs.vh", ""), true);
    assert.strictEqual(verilogIndexing.canIndex("unknown.txt", SAMPLE_SRC), true);
    assert.strictEqual(verilogIndexing.canIndex("notes.md", "hello world"), false);
  });

  it("validates Verilog documents and reports LSP diagnostics", () => {
    const clean = validateVerilog(SAMPLE_SRC);
    assert.strictEqual(clean.length, 0);

    const bad = validateVerilog(`module m (input a, output y); assign y = a & ghost; endmodule`);
    assert.ok(bad.some((d) => d.code === "VLOG2003" && d.source === "modelscript-verilog"));
  });

  it("extracts hierarchical document symbols and contextual hover info", () => {
    const symbols = getVerilogDocumentSymbols(SAMPLE_SRC);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.name, "adder4");
    assert.strictEqual(symbols[0]?.children?.length, 3);

    // Hover over port 'a' on line 1
    const hoverPort = getVerilogHover(SAMPLE_SRC, { line: 1, character: 15 });
    assert.ok(hoverPort?.contents.value.includes("Port `a`"));
    assert.ok(hoverPort?.contents.value.includes("[3:0]"));

    // Hover over built-in gate primitive 'nand'
    const gateSrc = `module g(input a, input b, output y); nand u1 (y, a, b); endmodule`;
    const hoverGate = getVerilogHover(gateSrc, { line: 0, character: 40 });
    assert.ok(hoverGate?.contents.value.includes("IEEE 1364 Primitive `nand`"));
  });

  it("executes LSP domain actions (lint, to_modelica, to_vhdl, to_dae, simulate)", async () => {
    const mo = (await executeVerilogAction("to_modelica", { content: SAMPLE_SRC })) as string;
    assert.ok(mo.includes("model adder4"));

    const vhdl = (await executeVerilogAction("to_vhdl", { content: SAMPLE_SRC })) as string;
    assert.ok(vhdl.includes("entity adder4 is"));

    const dae = (await executeVerilogAction("to_dae", { content: SAMPLE_SRC })) as {
      varCount: number;
      eqCount: number;
    };
    assert.ok(dae.varCount >= 3);
    assert.strictEqual(dae.eqCount, 1);

    const simTrace = (await executeVerilogAction("simulate", {
      content: SAMPLE_SRC,
      steps: [{ inputs: { a: 5, b: 6 } }],
    })) as Array<{ values: Record<string, number | undefined> }>;
    assert.strictEqual(simTrace[0]?.values["sum"], 11);
  });
});
