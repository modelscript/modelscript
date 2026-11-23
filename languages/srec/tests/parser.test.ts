// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressBytesForRecordType,
  computeSrecChecksum,
  decodeHeaderAscii,
  encodeSrec,
  formatSrecRecord,
  parseSrec,
} from "../src/parser/index.js";

describe("Motorola S-Record Parser & Encoder", () => {
  it("parses classic Wikipedia / Motorola S1/S5/S9 example with valid 1's-complement checksums", () => {
    const sample = [
      "S00F000068656C6C6F202020202000003C",
      "S11F00007C0802A6900100049421FFF07C6C1B787C8C23783C6000003863000026",
      "S11F001C4BFFFFE5398000007D83637880010014382100107C0803A64E800020E9",
      "S111003848656C6C6F20776F726C642E0A0042",
      "S5030003F9",
      "S9030000FC",
    ].join("\n");

    const file = parseSrec(sample);
    assert.strictEqual(file.parseErrors.length, 0);
    assert.strictEqual(file.records.length, 6);
    assert.strictEqual(file.dataRecordCount, 3);
    assert.strictEqual(file.declaredRecordCount, 3);
    assert.strictEqual(file.terminationType, "S9");
    assert.strictEqual(file.startAddress, 0x0000);
    assert.strictEqual(file.headerText?.trim(), "hello");
    assert.strictEqual(file.totalDataBytes, 28 + 28 + 14);

    for (const rec of file.records) {
      assert.strictEqual(rec.checksumValid, true, `Checksum failed on line ${rec.line}`);
      assert.strictEqual(rec.byteCountValid, true, `Byte count failed on line ${rec.line}`);
    }
  });

  it("parses and encodes 24-bit S2/S8 and 32-bit S3/S7 records including high unsigned addresses", () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x12, 0x34, 0x56, 0x78]);

    // 24-bit Motorola 68000
    const s2Text = encodeSrec([{ startAddress: 0x008000, data: payload }], {
      header: "M68K",
      dataRecordType: "S2",
      startAddress: 0x008000,
    });
    const s2File = parseSrec(s2Text);
    assert.strictEqual(s2File.parseErrors.length, 0);
    assert.strictEqual(s2File.records.find((r) => r.type === "S2")?.address, 0x008000);
    assert.strictEqual(s2File.terminationType, "S8");
    assert.strictEqual(s2File.startAddress, 0x008000);

    // 32-bit PowerPC high boot flash address >= 0x80000000
    const s3Text = encodeSrec([{ startAddress: 0xfff00100, data: payload }], {
      header: "PPC_BOOT",
      dataRecordType: "S3",
      startAddress: 0xfff00100,
    });
    const s3File = parseSrec(s3Text);
    assert.strictEqual(s3File.parseErrors.length, 0);
    assert.strictEqual(s3File.records.find((r) => r.type === "S3")?.address, 0xfff00100);
    assert.strictEqual(s3File.terminationType, "S7");
    assert.strictEqual(s3File.startAddress, 0xfff00100);
    assert.deepStrictEqual(s3File.records.find((r) => r.type === "S3")?.data, payload);
  });

  it("computes exact 1's-complement checksums and decodes ASCII headers", () => {
    // S9030000FC -> byteCount=0x03, addr=0x0000, sum=0x03, ~0x03 & 0xFF = 0xFC
    assert.strictEqual(computeSrecChecksum(0x03, 0x0000, 2, new Uint8Array(0)), 0xfc);
    assert.strictEqual(formatSrecRecord("S9", 0x0000), "S9030000FC");
    assert.strictEqual(addressBytesForRecordType("S1"), 2);
    assert.strictEqual(addressBytesForRecordType("S2"), 3);
    assert.strictEqual(addressBytesForRecordType("S3"), 4);
    assert.strictEqual(decodeHeaderAscii(new Uint8Array([0x4d, 0x4f, 0x54, 0x00, 0x41])), "MOT");
  });

  it("records syntax errors for malformed lines without throwing", () => {
    const bad = "NOT_SREC\nS102\nS1040000ZZ00\nS10400001\n";
    const file = parseSrec(bad);
    assert.strictEqual(file.parseErrors.length, 4);
    assert.strictEqual(file.records.length, 0);
  });
});
