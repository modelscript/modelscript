// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeIhex, formatIhexRecord, lintIhex, parseIhex } from "../src/index.js";

describe("@modelscript/ihex Lints Suite (IHEX1001–IHEX5006)", () => {
  it("reports zero diagnostics on a clean I32HEX image", () => {
    const hex = encodeIhex([{ address: 0x08000000, data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }], {
      format: "I32HEX",
      startLinearAddress: 0x08000000,
    });
    const diags = lintIhex(parseIhex(hex));
    assert.equal(diags.length, 0);
  });

  it("detects syntax errors (IHEX1001 missing ':', IHEX1002 bad hex, IHEX1003 truncated)", () => {
    const bad = ["00000001FF", ":02000000ZZZZ00", ":000001", ":00000001FF"].join("\n");
    const codes = new Set(lintIhex(parseIhex(bad)).map((d) => d.code));
    assert.ok(codes.has("IHEX1001"));
    assert.ok(codes.has("IHEX1002"));
    assert.ok(codes.has("IHEX1003"));
  });

  it("detects checksum mismatch (IHEX2001) and byte count mismatch (IHEX2002)", () => {
    // Checksum should be 0xFF, changed to 0x00; byte count declares 04 but only 2 bytes provided
    const bad = [":04000000AABB95", ":0000000100"].join("\n");
    const codes = new Set(lintIhex(parseIhex(bad)).map((d) => d.code));
    assert.ok(codes.has("IHEX2001"));
    assert.ok(codes.has("IHEX2002"));
  });

  it("detects unsupported record type (IHEX3001), invalid control payload length (IHEX3002), and nonzero control address (IHEX3003)", () => {
    const recUnsupported = formatIhexRecord(0x09, 0x0000, [0x01]);
    const recBadElaLen = formatIhexRecord(0x04, 0x0010, [0x08]); // len 1 != 2, addr 0x0010 != 0
    const recData = formatIhexRecord(0x00, 0x0000, [0xaa]);
    const recEof = formatIhexRecord(0x01, 0x0000, []);

    const codes = new Set(
      lintIhex(parseIhex([recUnsupported, recBadElaLen, recData, recEof].join("\n"))).map((d) => d.code),
    );
    assert.ok(codes.has("IHEX3001"));
    assert.ok(codes.has("IHEX3002"));
    assert.ok(codes.has("IHEX3003"));
  });

  it("detects missing EOF (IHEX4001), records after EOF (IHEX4002), and duplicate EOF (IHEX4003)", () => {
    const noEof = formatIhexRecord(0x00, 0x0000, [0x01, 0x02]);
    assert.ok(lintIhex(parseIhex(noEof)).some((d) => d.code === "IHEX4001"));

    const afterEof = [
      formatIhexRecord(0x00, 0x0000, [0x01]),
      formatIhexRecord(0x01, 0x0000, []),
      formatIhexRecord(0x00, 0x0010, [0x02]),
      formatIhexRecord(0x01, 0x0000, []),
    ].join("\n");
    const codes = new Set(lintIhex(parseIhex(afterEof)).map((d) => d.code));
    assert.ok(codes.has("IHEX4002"));
    assert.ok(codes.has("IHEX4003"));
  });

  it("detects overlapping addresses (IHEX5001), large uninitialized gap (IHEX5002), and unaligned entry point (IHEX5006)", () => {
    const img = [
      formatIhexRecord(0x04, 0x0000, [0x08, 0x00]),
      formatIhexRecord(0x00, 0x0000, [0x01, 0x02, 0x03, 0x04]),
      formatIhexRecord(0x00, 0x0002, [0xaa, 0xbb]), // overlaps 0x08000002..0x08000003
      formatIhexRecord(0x04, 0x0000, [0x08, 0x04]), // 256 KiB gap
      formatIhexRecord(0x00, 0x0000, [0xff]),
      formatIhexRecord(0x05, 0x0000, [0x08, 0x02, 0x00, 0x00]), // entry outside segments
      formatIhexRecord(0x01, 0x0000, []),
    ].join("\n");

    const codes = new Set(lintIhex(parseIhex(img)).map((d) => d.code));
    assert.ok(codes.has("IHEX5001"));
    assert.ok(codes.has("IHEX5002"));
    assert.ok(codes.has("IHEX5006"));
  });
});
