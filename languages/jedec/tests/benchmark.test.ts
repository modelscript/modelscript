// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintJedec } from "../src/lints/index.js";
import { computeJedecFuseChecksum, formatHex16 } from "../src/parser/checksum.js";
import { parseJedec } from "../src/parser/jedec-parser.js";
import { encodeProductTermRow, extractJedecEquations } from "../src/solver/boolean-extractor.js";
import { PAL16L8_PROFILE } from "../src/solver/device-profiles.js";
import { simulateJedecVectors } from "../src/solver/simulator.js";

function make20PinVector(inputs: Record<number, "0" | "1">, outputs: Record<number, "H" | "L" | "Z">): string {
  const chars = new Array<string>(20).fill("X");
  chars[9] = "N"; // Pin 10 = GND
  chars[19] = "N"; // Pin 20 = VCC
  for (const [pinStr, val] of Object.entries(inputs)) {
    chars[Number(pinStr) - 1] = val;
  }
  for (const [pinStr, val] of Object.entries(outputs)) {
    chars[Number(pinStr) - 1] = val;
  }
  return chars.join("");
}

describe("@modelscript/jedec — Verification Benchmarks (Checksum Parity, PAL16L8 XOR & 2-to-1 MUX)", () => {
  it("achieves exact JESD3 16-bit fuse checksum parity (relErr === 0)", () => {
    // Independent reference implementation of JESD3 §3.3 LSB-first 8-bit byte sum mod 0x10000
    const fuses = new Uint8Array(2048);
    for (let i = 0; i < fuses.length; i++) {
      fuses[i] = (i * 7 + 3) % 5 === 0 ? 1 : 0;
    }

    let refSum = 0;
    for (let byteIdx = 0; byteIdx < fuses.length / 8; byteIdx++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        b |= (fuses[byteIdx * 8 + bit] ?? 0) << bit;
      }
      refSum = (refSum + b) & 0xffff;
    }

    const actual = computeJedecFuseChecksum(fuses);
    const relErr = refSum === 0 ? Math.abs(actual - refSum) : Math.abs(actual - refSum) / refSum;
    assert.equal(actual, refSum);
    assert.equal(relErr, 0);
  });

  it("extracts PAL16L8 2-input XOR fuse map and passes all 4 V test vectors (passRate === 1, rmse === 0)", () => {
    const oe = encodeProductTermRow(PAL16L8_PROFILE, "ALWAYS_TRUE");
    // Active-low PAL16L8: O19 = !((!I1 & !I2) | (I1 & I2)) === I1 ^ I2
    const pt1 = encodeProductTermRow(PAL16L8_PROFILE, [
      { pin: 1, negated: true },
      { pin: 2, negated: true },
    ]);
    const pt2 = encodeProductTermRow(PAL16L8_PROFILE, [
      { pin: 1, negated: false },
      { pin: 2, negated: false },
    ]);

    const vectors = [
      make20PinVector({ 1: "0", 2: "0" }, { 19: "L" }),
      make20PinVector({ 1: "0", 2: "1" }, { 19: "H" }),
      make20PinVector({ 1: "1", 2: "0" }, { 19: "H" }),
      make20PinVector({ 1: "1", 2: "1" }, { 19: "L" }),
    ];

    const body = [
      "PAL16L8 2-Input XOR Benchmark*",
      "QP20*",
      "QF2048*",
      "QV4*",
      "F0*",
      "G0*",
      "N DEVICE PAL16L8*",
      `L0000 ${oe}*`,
      `L0032 ${pt1}*`,
      `L0064 ${pt2}*`,
      ...vectors.map((v, idx) => `V000${idx + 1} ${v}*`),
    ].join("\n");

    const pre = parseJedec(body);
    const full = `${body}\nC${formatHex16(pre.computedFuseChecksum)}*\n`;
    const doc = parseJedec(full, "pal16l8_xor.jed");

    assert.equal(lintJedec(doc).length, 0, "Valid XOR JEDEC file should produce zero diagnostics");

    const extraction = extractJedecEquations(doc);
    const o19 = extraction.equations.find((e) => e.pin === 19);
    assert.ok(o19, "Expected O19 equation");
    assert.equal(o19.activeLow, true);
    assert.equal(o19.activeTerms.length, 2);
    assert.equal(extraction.utilization.totalFuses, 2048);
    assert.ok(extraction.utilization.usedProductTerms >= 3);

    const sim = simulateJedecVectors(doc);
    assert.equal(sim.totalVectors, 4);
    assert.equal(sim.passedVectors, 4);
    assert.equal(sim.failedVectors, 0);
    assert.equal(sim.passRate, 1.0);
    assert.equal(sim.rmse, 0.0);
  });

  it("extracts PAL16L8 2-to-1 MUX fuse map and passes all 8 V test vectors (passRate === 1, rmse === 0)", () => {
    const oe = encodeProductTermRow(PAL16L8_PROFILE, "ALWAYS_TRUE");
    // 2-to-1 MUX: O19 = (!I3 & I1) | (I3 & I2)
    // Active-low PAL16L8: !O19 = (!I3 & !I1) | (I3 & !I2)
    const pt1 = encodeProductTermRow(PAL16L8_PROFILE, [
      { pin: 3, negated: true },
      { pin: 1, negated: true },
    ]);
    const pt2 = encodeProductTermRow(PAL16L8_PROFILE, [
      { pin: 3, negated: false },
      { pin: 2, negated: true },
    ]);

    const vectors: string[] = [];
    for (let s = 0; s <= 1; s++) {
      for (let a = 0; a <= 1; a++) {
        for (let b = 0; b <= 1; b++) {
          const y = s === 0 ? a : b;
          vectors.push(
            make20PinVector({ 1: a ? "1" : "0", 2: b ? "1" : "0", 3: s ? "1" : "0" }, { 19: y ? "H" : "L" }),
          );
        }
      }
    }

    const body = [
      "PAL16L8 2-to-1 MUX Benchmark*",
      "QP20*",
      "QF2048*",
      "QV8*",
      "F0*",
      "G0*",
      "N DEVICE PAL16L8*",
      `L0000 ${oe}*`,
      `L0032 ${pt1}*`,
      `L0064 ${pt2}*`,
      ...vectors.map((v, idx) => `V000${idx + 1} ${v}*`),
    ].join("\n");

    const pre = parseJedec(body);
    const full = `${body}\nC${formatHex16(pre.computedFuseChecksum)}*\n`;
    const doc = parseJedec(full, "pal16l8_mux.jed");

    assert.equal(lintJedec(doc).length, 0);

    const extraction = extractJedecEquations(doc);
    const o19 = extraction.equations.find((e) => e.pin === 19);
    assert.ok(o19);
    assert.equal(o19.activeTerms.length, 2);

    const sim = simulateJedecVectors(doc);
    assert.equal(sim.totalVectors, 8);
    assert.equal(sim.passedVectors, 8);
    assert.equal(sim.failedVectors, 0);
    assert.equal(sim.passRate, 1.0);
    assert.equal(sim.rmse, 0.0);
  });
});
