// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerJedecToDae } from "../src/dae/lowering.js";
import { parseJedec } from "../src/parser/jedec-parser.js";
import { jedecToVerilog } from "../src/projections/verilog.js";
import { jedecToVhdl } from "../src/projections/vhdl.js";
import { encodeProductTermRow } from "../src/solver/boolean-extractor.js";
import { PAL16L8_PROFILE } from "../src/solver/device-profiles.js";

function buildPal16L8XorSource(): string {
  const oe = encodeProductTermRow(PAL16L8_PROFILE, "ALWAYS_TRUE");
  const pt1 = encodeProductTermRow(PAL16L8_PROFILE, [
    { pin: 1, negated: true },
    { pin: 2, negated: true },
  ]);
  const pt2 = encodeProductTermRow(PAL16L8_PROFILE, [
    { pin: 1, negated: false },
    { pin: 2, negated: false },
  ]);
  return [
    "PAL16L8 2-Input XOR*",
    "QP20*",
    "QF2048*",
    "F0*",
    "N DEVICE PAL16L8*",
    `L0000 ${oe}*`,
    `L0032 ${pt1}*`,
    `L0064 ${pt2}*`,
  ].join("\n");
}

describe("@modelscript/jedec — Boolean DAE Lowering & HDL Projections", () => {
  it("lowers PAL16L8 XOR Boolean equations directly into DAEBuilder", () => {
    const doc = parseJedec(buildPal16L8XorSource(), "xor16l8.jed");
    const dae = new DAEBuilder();
    const res = lowerJedecToDae(doc, dae);

    assert.equal(res.extraction.deviceName, "PAL16L8");
    assert.ok(res.inputCount >= 10, "Should register PAL16L8 dedicated input pins");
    assert.equal(res.outputCount, 8, "Should register all 8 PAL16L8 output pins");
    assert.equal(res.productTermCount, 2, "XOR uses 2 active SOP product terms");
    assert.equal(res.equationCount, 10, "2 product term equations + 8 output equations");
    assert.ok(res.variableMap.has("I1"));
    assert.ok(res.variableMap.has("I2"));
    assert.ok(res.variableMap.has("O19"));
    assert.ok(res.variableMap.has("pt_1"));
    assert.ok(res.variableMap.has("pt_2"));
    assert.equal(dae.getEqCount(), res.equationCount);
    assert.equal(dae.getVarCount(), res.variableMap.size);
  });

  it("projects PAL16L8 XOR fuse map to synthesizable Verilog-2001", () => {
    const doc = parseJedec(buildPal16L8XorSource(), "xor16l8.jed");
    const verilog = jedecToVerilog(doc);

    assert.ok(verilog.includes("module xor16l8"));
    assert.ok(verilog.includes("input  wire I1"));
    assert.ok(verilog.includes("input  wire I2"));
    assert.ok(verilog.includes("output wire O19"));
    assert.ok(verilog.includes("assign O19 = ~("));
    assert.ok(verilog.includes("~I1"));
    assert.ok(verilog.includes("~I2"));
    assert.ok(verilog.includes("endmodule"));
  });

  it("projects PAL16L8 XOR fuse map to synthesizable VHDL-93", () => {
    const doc = parseJedec(buildPal16L8XorSource(), "xor16l8.jed");
    const vhdl = jedecToVhdl(doc);

    assert.ok(vhdl.includes("library ieee;"));
    assert.ok(vhdl.includes("entity xor16l8 is"));
    assert.ok(vhdl.includes("I1 : in  std_logic"));
    assert.ok(vhdl.includes("O19 : out std_logic"));
    assert.ok(vhdl.includes("O19 <= not ("));
    assert.ok(vhdl.includes("end architecture rtl;"));
  });
});
