// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeSrec, parseSrec } from "../src/parser/index.js";
import { srecToCArray, srecToIntelHex, srecToVerilogReadmemh } from "../src/projections/index.js";
import {
  buildBinaryImage,
  coalesceMemoryRegions,
  computeCrc32,
  solveSrecMemory,
  validateEntryPoint,
} from "../src/solver/index.js";

describe("SREC Binary Image Solver, CRC-32 & Polyglot Projections", () => {
  it("computes standard IEEE 802.3 CRC-32 check value 0xCBF43926 for ASCII '123456789'", () => {
    const checkBytes = new TextEncoder().encode("123456789");
    assert.strictEqual(computeCrc32(checkBytes), 0xcbf43926);
  });

  it("coalesces contiguous S-records and builds flat binary image with 0xFF gap fill", () => {
    const segA = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const segB = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const text = encodeSrec(
      [
        { startAddress: 0x1000, data: segA },
        { startAddress: 0x1008, data: segB },
      ],
      { header: "TESTIMG", bytesPerLine: 2, startAddress: 0x1000 },
    );

    const file = parseSrec(text);
    assert.strictEqual(file.dataRecordCount, 4);

    const { regions, overlappingAddresses } = coalesceMemoryRegions(file);
    assert.strictEqual(overlappingAddresses.length, 0);
    assert.strictEqual(regions.length, 2);
    assert.strictEqual(regions[0]!.startAddress, 0x1000);
    assert.strictEqual(regions[0]!.size, 4);
    assert.strictEqual(regions[1]!.startAddress, 0x1008);
    assert.strictEqual(regions[1]!.size, 4);

    const bin = buildBinaryImage(file, 0xff);
    assert.strictEqual(bin.baseAddress, 0x1000);
    assert.strictEqual(bin.endAddress, 0x100c);
    assert.strictEqual(bin.data.length, 12);
    assert.deepStrictEqual(
      Array.from(bin.data),
      [0x01, 0x02, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff, 0xaa, 0xbb, 0xcc, 0xdd],
    );

    const ep = validateEntryPoint(regions, 0x1000);
    assert.strictEqual(ep.valid, true);
    assert.strictEqual(ep.regionIndex, 0);

    const solved = solveSrecMemory(file);
    assert.strictEqual(solved.entryPointValid, true);
    assert.strictEqual(solved.addressSpan, 12);
    assert.strictEqual(solved.totalDataBytes, 8);
  });

  it("projects SREC to Intel HEX, Verilog $readmemh, and C uint8_t[] array", () => {
    const text = encodeSrec([{ startAddress: 0x00020000, data: new Uint8Array([0x10, 0x20, 0x30, 0x40]) }], {
      header: "FW_PROJ",
      dataRecordType: "S3",
      startAddress: 0x00020000,
    });
    const file = parseSrec(text);

    const ihex = srecToIntelHex(file);
    assert.ok(ihex.includes(":020000040002F8"), "Should emit Extended Linear Address 04 for 0x0002xxxx");
    assert.ok(ihex.includes(":04000000102030405C"), "Should emit Intel HEX data record");
    assert.ok(ihex.includes(":00000001FF"), "Should emit Intel HEX EOF record");

    const verilog = srecToVerilogReadmemh(file);
    assert.ok(verilog.includes("@00020000"));
    assert.ok(verilog.includes("10 20 30 40"));

    const cCode = srecToCArray(file, { symbolName: "boot_fw" });
    assert.ok(cCode.includes("static const uint8_t boot_fw_region_0_data[4]"));
    assert.ok(cCode.includes("0x10, 0x20, 0x30, 0x40"));
    assert.ok(cCode.includes("BOOT_FW_CRC32"));
  });
});
