// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintJedec } from "../src/lints/index.js";
import { formatHex16 } from "../src/parser/checksum.js";
import { parseJedec } from "../src/parser/jedec-parser.js";

describe("@modelscript/jedec — JESD3 Lints (JED1001–JED5006)", () => {
  it("reports JED1002 when a trailing field is missing its '*' delimiter", () => {
    const doc = parseJedec("QP20*\nQF64*\nF0");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED1002"));
  });

  it("reports JED2001 when mandatory QF fuse count is missing", () => {
    const doc = parseJedec("QP20*\nF0*\nC0000*");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED2001"));
  });

  it("reports JED2002 for invalid default fuse state F not 0/1", () => {
    const doc = parseJedec("QP20*\nQF64*\nF2*\nC0000*");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED2002"));
  });

  it("reports JED3001 on 16-bit C fuse checksum mismatch", () => {
    const doc = parseJedec("QP20*\nQF16*\nF0*\nL0000 1111111100000000*\nCFFFF*");
    const diags = lintJedec(doc);
    const mismatch = diags.find((d) => d.code === "JED3001");
    assert.ok(mismatch, "Expected JED3001 fuse checksum mismatch");
    assert.ok(mismatch.message.includes("FFFF"));
    assert.ok(mismatch.message.includes("00FF"));
  });

  it("reports JED3002 on 16-bit ETX transmission checksum mismatch", () => {
    const doc = parseJedec("\x02QP20*\nQF8*\nF0*\nC0000*\x03DEAD");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED3002"));
  });

  it("reports JED4001 when L fuse address + bits exceed [0, QF) bounds", () => {
    const doc = parseJedec("QP20*\nQF16*\nF0*\nL0012 11111111*\nC0000*");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED4001"));
  });

  it("reports JED4002 on overlapping L fuse writes", () => {
    const src = "QP20*\nQF32*\nF0*\nL0000 11111111*\nL0004 00001111*";
    const pre = parseJedec(src);
    const doc = parseJedec(`${src}\nC${formatHex16(pre.computedFuseChecksum)}*`);
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED4002"));
  });

  it("reports JED5001 when V test vector length mismatches QP pin count", () => {
    const doc = parseJedec("QP20*\nQF64*\nF0*\nV0001 010101*\nC0000*");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED5001"));
  });

  it("reports JED5002 when V test vector count exceeds QV", () => {
    const doc = parseJedec("QP4*\nQF16*\nQV1*\nF0*\nV0001 00HL*\nV0002 01LH*\nC0000*");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED5002"));
  });

  it("reports JED5006 info when security fuse G1* is blown", () => {
    const doc = parseJedec("QP20*\nQF16*\nF0*\nG1*\nC0000*");
    const diags = lintJedec(doc);
    assert.ok(diags.some((d) => d.code === "JED5006" && d.severity === "info"));
  });
});
