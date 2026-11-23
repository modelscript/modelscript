// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSrec } from "../src/lints/index.js";
import { computeSrecChecksum, encodeSrec, parseSrec } from "../src/parser/index.js";
import { buildBinaryImage, computeCrc32, solveSrecMemory } from "../src/solver/index.js";

function deterministicBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = (x >>> 24) & 0xff;
  }
  return out;
}

describe("Motorola S-Record Parity Benchmarks (S1/S2/S3, Checksum, S5, CRC-32)", () => {
  it("achieves exact byte parity (relErr < 1e-12) across 16-bit S1, 24-bit S2, and 32-bit S3 round-trips", () => {
    const cases: Array<{
      label: string;
      type: "S1" | "S2" | "S3";
      baseAddr: number;
      size: number;
      seed: number;
    }> = [
      { label: "MC6800 16-bit S1/S9", type: "S1", baseAddr: 0xe000, size: 512, seed: 0x6800 },
      { label: "MC68000 24-bit S2/S8", type: "S2", baseAddr: 0x000400, size: 1024, seed: 0x68000 },
      { label: "PowerPC 32-bit S3/S7 high flash", type: "S3", baseAddr: 0xfff00000, size: 2048, seed: 0x555 },
    ];

    for (const tc of cases) {
      const original = deterministicBytes(tc.size, tc.seed);
      const originalCrc = computeCrc32(original);

      const encoded = encodeSrec([{ startAddress: tc.baseAddr, data: original }], {
        header: tc.label.slice(0, 16),
        dataRecordType: tc.type,
        bytesPerLine: 32,
        includeRecordCount: true,
        startAddress: tc.baseAddr,
      });

      const parsed = parseSrec(encoded);
      const lints = lintSrec(parsed);
      assert.strictEqual(lints.length, 0, `${tc.label} should have zero lint errors`);

      const img = buildBinaryImage(parsed, 0xff);
      assert.strictEqual(img.baseAddress, tc.baseAddr);
      assert.strictEqual(img.data.length, original.length);

      let absErrSum = 0;
      let refSum = 0;
      for (let i = 0; i < original.length; i++) {
        absErrSum += Math.abs(img.data[i]! - original[i]!);
        refSum += Math.abs(original[i]!) + 1;
      }
      const relErr = absErrSum / refSum;
      assert.ok(relErr < 1e-12, `${tc.label} relErr=${relErr} exceeded 1e-12`);
      assert.strictEqual(img.crc32, originalCrc, `${tc.label} IEEE CRC-32 mismatch`);
    }
  });

  it("verifies 1's-complement checksum & S5 record count parity with rmse === 0", () => {
    const payload = deterministicBytes(4096, 0xdeadbeef);
    const encoded = encodeSrec([{ startAddress: 0x00100000, data: payload }], {
      header: "BENCH_CHK",
      dataRecordType: "S3",
      bytesPerLine: 16,
      includeRecordCount: true,
      startAddress: 0x00100000,
    });

    const parsed = parseSrec(encoded);
    assert.strictEqual(parsed.dataRecordCount, 256);
    assert.strictEqual(parsed.declaredRecordCount, 256);

    let sqErr = 0;
    for (const rec of parsed.records) {
      const recomputed = computeSrecChecksum(rec.byteCount, rec.address, rec.addressBytes, rec.data);
      const diff = rec.checksum - recomputed;
      sqErr += diff * diff;
    }
    const countDiff = (parsed.declaredRecordCount ?? -1) - parsed.dataRecordCount;
    sqErr += countDiff * countDiff;

    const rmse = Math.sqrt(sqErr / (parsed.records.length + 1));
    assert.strictEqual(rmse, 0, `Expected checksum & S5 count RMSE === 0, got ${rmse}`);

    const solved = solveSrecMemory(parsed);
    assert.strictEqual(solved.overallCrc32, computeCrc32(payload));
    assert.strictEqual(solved.entryPointValid, true);
  });
});
