// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCrc32, computeFletcher16, encodeIhex, parseIhex, solveIhexImage } from "../src/index.js";

describe("@modelscript/ihex Verification & Benchmark Suite", () => {
  it("verifies IEEE 802.3 CRC-32 check value 0xCBF43926 for ASCII '123456789'", () => {
    const checkBytes = new TextEncoder().encode("123456789");
    const crc = computeCrc32(checkBytes);
    assert.equal(crc, 0xcbf43926, `Expected 0xCBF43926, got 0x${crc.toString(16).toUpperCase()}`);

    // Standard Fletcher-16 check value for "abcde" is 0xC8F0
    const f16 = computeFletcher16(new TextEncoder().encode("abcde"));
    assert.equal(f16, 0xc8f0, `Expected 0xC8F0, got 0x${f16.toString(16).toUpperCase()}`);
  });

  it("achieves exact byte parity (relErr < 1e-12) and checksum RMSE === 0 on multi-segment I32HEX round-trip", () => {
    // 3 segments spanning multiple 64 KiB Extended Linear Address (04) boundaries
    const seg0 = new Uint8Array(256);
    const seg1 = new Uint8Array(512);
    const seg2 = new Uint8Array(128);
    for (let i = 0; i < seg0.length; i++) seg0[i] = (i * 37 + 11) & 0xff;
    for (let i = 0; i < seg1.length; i++) seg1[i] = (i * 73 + 19) & 0xff;
    for (let i = 0; i < seg2.length; i++) seg2[i] = (i * 101 + 7) & 0xff;

    const inputSegments = [
      { address: 0x08000000, data: seg0 },
      { address: 0x0800ff80, data: seg1 }, // crosses 0x08010000 ELA boundary!
      { address: 0x08020400, data: seg2 },
    ];

    const encoded = encodeIhex(inputSegments, {
      format: "I32HEX",
      bytesPerLine: 16,
      startLinearAddress: 0x08000000,
    });

    const parsed = parseIhex(encoded, "benchmark_m4.hex");
    assert.equal(parsed.parseErrors.length, 0);
    assert.equal(parsed.format, "I32HEX");
    assert.equal(parsed.startLinearAddress, 0x08000000);

    const solved = solveIhexImage(parsed, { flashSizeBytes: 524288 });
    assert.equal(solved.checksumRmse, 0, "All 2's-complement record checksums must have RMSE === 0");
    assert.equal(solved.validChecksumCount, solved.recordCount);
    assert.equal(solved.memoryMap.segments.length, 3);

    // Compute exact byte-wise relative error across all segments
    let totalAbsErr = 0;
    let totalRef = 0;
    for (let s = 0; s < inputSegments.length; s++) {
      const expected = inputSegments[s]!;
      const actual = solved.memoryMap.segments[s]!;
      assert.equal(actual.startAddress, expected.address);
      assert.equal(actual.length, expected.data.length);
      assert.equal(actual.crc32, computeCrc32(expected.data));

      for (let i = 0; i < expected.data.length; i++) {
        totalAbsErr += Math.abs((actual.data[i] ?? 0) - (expected.data[i] ?? 0));
        totalRef += expected.data[i] ?? 0;
      }
    }

    const relErr = totalRef > 0 ? totalAbsErr / totalRef : totalAbsErr;
    assert.ok(relErr < 1e-12, `Expected relErr < 1e-12, got ${relErr}`);
    assert.equal(relErr, 0);
  });
});
