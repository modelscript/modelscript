// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeIhexChecksum, IhexRecordType, parseIhex } from "../src/index.js";

describe("@modelscript/ihex Parser Suite", () => {
  it("parses I8HEX data and EOF records with valid 2's-complement checksums", () => {
    const sample = [
      ":10010000214601360121470136007EFE09D2190140",
      ":100110002146017E17C20001FF5F16002148011928",
      ":00000001FF",
    ].join("\n");

    const model = parseIhex(sample, "blink8051.hex");
    assert.equal(model.format, "I8HEX");
    assert.equal(model.parseErrors.length, 0);
    assert.equal(model.records.length, 3);
    assert.equal(model.hasEof, true);
    assert.equal(model.eofLine, 3);
    assert.equal(model.totalDataBytes, 32);
    assert.equal(model.minAddress, 0x0100);
    assert.equal(model.maxAddress, 0x0120);

    for (const rec of model.records) {
      assert.equal(rec.checksumValid, true, `Line ${rec.lineNumber} checksum should be valid`);
      assert.equal(rec.byteCountValid, true, `Line ${rec.lineNumber} byteCount should be valid`);
    }

    assert.equal(model.records[0]?.recordType, IhexRecordType.Data);
    assert.equal(model.records[0]?.data[0], 0x21);
    assert.equal(model.records[0]?.data[15], 0x01);
  });

  it("parses I16HEX Extended Segment Address (02) and Start Segment Address (03)", () => {
    const sample = [":020000021200EA", ":04001000DEADBEEFC8", ":0400000312000010D7", ":00000001FF"].join("\n");

    const model = parseIhex(sample, "dos_rom.hex");
    assert.equal(model.format, "I16HEX");
    assert.equal(model.parseErrors.length, 0);
    assert.equal(model.records[1]?.baseAddress, 0x12000);
    assert.equal(model.records[1]?.linearAddress, 0x12010);
    assert.deepEqual(Array.from(model.records[1]?.data ?? []), [0xde, 0xad, 0xbe, 0xef]);
    assert.deepEqual(model.startSegmentAddress, { cs: 0x1200, ip: 0x0010 });
  });

  it("parses I32HEX Extended Linear Address (04) and Start Linear Address (05)", () => {
    const sample = [":020000040800F2", ":04000000005000208C", ":0400000508000101ED", ":00000001FF"].join("\n");

    const model = parseIhex(sample, "stm32.hex");
    assert.equal(model.format, "I32HEX");
    assert.equal(model.parseErrors.length, 0);
    assert.equal(model.records[1]?.baseAddress, 0x08000000);
    assert.equal(model.records[1]?.linearAddress, 0x08000000);
    assert.equal(model.startLinearAddress, 0x08000101);
    assert.equal(
      model.records.every((r) => r.checksumValid),
      true,
    );
  });

  it("computes exact 2's-complement checksums", () => {
    // :0300300002337A1E -> sum(03, 00, 30, 00, 02, 33, 7A) = 0xE2 -> 0x100 - 0xE2 = 0x1E
    const cs = computeIhexChecksum([0x03, 0x00, 0x30, 0x00, 0x02, 0x33, 0x7a]);
    assert.equal(cs, 0x1e);
    assert.equal(computeIhexChecksum([0x00, 0x00, 0x00, 0x01]), 0xff);
  });
});
