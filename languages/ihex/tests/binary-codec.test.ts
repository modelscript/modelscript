// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceIhexMemoryMap,
  encodeIhex,
  ihexToCArray,
  ihexToSrec,
  ihexToVerilogMem,
  parseIhex,
  toBinaryRomImage,
} from "../src/index.js";

describe("@modelscript/ihex Binary Codec & Projections Suite", () => {
  it("round-trips I8HEX, I16HEX, and I32HEX binary images cleanly", () => {
    const payload = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98]);

    // I8HEX
    const hex8 = encodeIhex([{ address: 0x0200, data: payload }], { format: "I8HEX", bytesPerLine: 4 });
    const parsed8 = parseIhex(hex8);
    assert.equal(parsed8.format, "I8HEX");
    assert.equal(parsed8.parseErrors.length, 0);
    const map8 = coalesceIhexMemoryMap(parsed8);
    assert.equal(map8.segments.length, 1);
    assert.equal(map8.segments[0]?.startAddress, 0x0200);
    assert.deepEqual(Array.from(map8.segments[0]?.data ?? []), Array.from(payload));

    // I16HEX (above 64 KiB using record type 02)
    const hex16 = encodeIhex([{ address: 0x10040, data: payload }], {
      format: "I16HEX",
      startSegmentAddress: { cs: 0x1000, ip: 0x0040 },
    });
    const parsed16 = parseIhex(hex16);
    assert.equal(parsed16.format, "I16HEX");
    const map16 = coalesceIhexMemoryMap(parsed16);
    assert.equal(map16.segments[0]?.startAddress, 0x10040);
    assert.deepEqual(Array.from(map16.segments[0]?.data ?? []), Array.from(payload));
    assert.deepEqual(parsed16.startSegmentAddress, { cs: 0x1000, ip: 0x0040 });

    // I32HEX (32-bit STM32 address)
    const hex32 = encodeIhex([{ address: 0x08001000, data: payload }], {
      format: "I32HEX",
      startLinearAddress: 0x08001000,
    });
    const parsed32 = parseIhex(hex32);
    assert.equal(parsed32.format, "I32HEX");
    const map32 = coalesceIhexMemoryMap(parsed32);
    assert.equal(map32.segments[0]?.startAddress, 0x08001000);
    assert.deepEqual(Array.from(map32.segments[0]?.data ?? []), Array.from(payload));
    assert.equal(parsed32.startLinearAddress, 0x08001000);
  });

  it("generates flat ROM binary images with 0xFF erased-flash gap fill", () => {
    const hex = encodeIhex(
      [
        { address: 0x0000, data: new Uint8Array([0xaa, 0xbb]) },
        { address: 0x0006, data: new Uint8Array([0xcc, 0xdd]) },
      ],
      { format: "I8HEX" },
    );
    const model = parseIhex(hex);
    const map = coalesceIhexMemoryMap(model, { fillByte: 0xff });
    assert.equal(map.segments.length, 2);
    assert.equal(map.totalGapBytes, 4);

    const rom = toBinaryRomImage(map, 0xff);
    assert.deepEqual(Array.from(rom), [0xaa, 0xbb, 0xff, 0xff, 0xff, 0xff, 0xcc, 0xdd]);
  });

  it("projects Intel HEX to Motorola S-Record, Verilog $readmemh, and C byte array", () => {
    const hex = encodeIhex([{ address: 0x08000000, data: new Uint8Array([0x10, 0x20, 0x30, 0x40]) }], {
      format: "I32HEX",
      startLinearAddress: 0x08000000,
    });
    const model = parseIhex(hex, "app.hex");

    const srec = ihexToSrec(model);
    assert.ok(srec.startsWith("S0"), "S-Record must start with S0 header");
    assert.ok(srec.includes("S3"), "32-bit address should emit S3 data records");
    assert.ok(srec.includes("S7"), "32-bit termination should emit S7 record");

    const vmem = ihexToVerilogMem(model, { wordWidthBytes: 1 });
    assert.ok(vmem.includes("@08000000"));
    assert.ok(vmem.includes("10 20 30 40"));

    const cArr = ihexToCArray(model, { symbolName: "boot_rom" });
    assert.ok(cArr.includes("static const uint8_t boot_rom[4]"));
    assert.ok(cArr.includes("0x10, 0x20, 0x30, 0x40"));
    assert.ok(cArr.includes("boot_rom_crc32"));
  });
});
