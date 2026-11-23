// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeJedecFuseChecksum, computeJedecTransmissionChecksum, formatHex16 } from "../src/parser/checksum.js";

describe("@modelscript/jedec — JESD3 16-bit Fuse & Transmission Checksums", () => {
  it("computes LSB-first 8-bit byte-sum fuse checksum per JESD3 §3.3", () => {
    // 8 bits: "10000000" => bit 0 = 1 => 0x01
    assert.equal(computeJedecFuseChecksum("10000000"), 0x0001);
    // 8 bits: "00000001" => bit 7 = 1 => 0x80
    assert.equal(computeJedecFuseChecksum("00000001"), 0x0080);
    // 8 bits all 1s => 0xFF
    assert.equal(computeJedecFuseChecksum("11111111"), 0x00ff);
    // 16 bits: 0xFF + 0x01 = 0x0100
    assert.equal(computeJedecFuseChecksum("1111111110000000"), 0x0100);
    // Partial final byte (10 bits): byte0 = 0x00, byte1 = bit0(1) + bit1(1) = 0x03
    assert.equal(computeJedecFuseChecksum("0000000011"), 0x0003);
    // All-zero 2048-fuse PAL16L8 => 0x0000
    assert.equal(computeJedecFuseChecksum(new Uint8Array(2048)), 0x0000);
    // All-one 2048-fuse PAL16L8 => 256 bytes * 0xFF = 65280 = 0xFF00
    const allOnes = new Uint8Array(2048);
    allOnes.fill(1);
    assert.equal(computeJedecFuseChecksum(allOnes), 0xff00);
    assert.equal(formatHex16(0xff00), "FF00");
  });

  it("wraps 16-bit fuse checksum modulo 0x10000", () => {
    // 258 bytes of 0xFF => 258 * 255 = 65790 = 0x100FE => mod 0x10000 = 0x00FE
    const fuses = new Uint8Array(258 * 8);
    fuses.fill(1);
    assert.equal(computeJedecFuseChecksum(fuses), 0x00fe);
    assert.equal(formatHex16(computeJedecFuseChecksum(fuses)), "00FE");
  });

  it("computes 16-bit ETX transmission checksum from STX through ETX inclusive", () => {
    const frame = "\x02QF8*\x03";
    // ASCII codes: 2 + 81 + 70 + 56 + 42 + 3 = 254 = 0x00FE
    const expected = (0x02 + 81 + 70 + 56 + 42 + 0x03) & 0xffff;
    assert.equal(computeJedecTransmissionChecksum(frame), expected);
    assert.equal(computeJedecTransmissionChecksum(`${frame}00FE`), expected);
    assert.equal(formatHex16(expected), "00FE");
  });
});
