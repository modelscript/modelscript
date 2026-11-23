// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SrecErrorCode, lintSrec } from "../src/lints/index.js";
import { encodeSrec, formatSrecRecord } from "../src/parser/index.js";

describe("Motorola S-Record Linter (SREC1001-SREC5006)", () => {
  it("reports zero diagnostics for a well-formed S0/S1/S5/S9 firmware image", () => {
    const valid = encodeSrec([{ startAddress: 0x0100, data: new Uint8Array([1, 2, 3, 4]) }], {
      header: "CLEAN",
      dataRecordType: "S1",
      startAddress: 0x0100,
    });
    const diags = lintSrec(valid);
    assert.strictEqual(diags.length, 0);
  });

  it("detects SREC1001 syntax error", () => {
    const diags = lintSrec("INVALID_LINE\nS9030000FC\n");
    assert.ok(diags.some((d) => d.code === SrecErrorCode.SYNTAX_ERROR.code));
  });

  it("detects SREC2001 1's-complement checksum mismatch", () => {
    const text = [
      formatSrecRecord("S0", 0, new TextEncoder().encode("HDR")),
      "S1050000010200", // wrong checksum (expected F7)
      "S9030000FC",
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.CHECKSUM_MISMATCH.code));
  });

  it("detects SREC2002 byte count mismatch", () => {
    const text = [
      formatSrecRecord("S0", 0, new TextEncoder().encode("HDR")),
      "S10800000102F4", // declared 8, actual 5
      "S9030000FC",
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.BYTE_COUNT_MISMATCH.code));
  });

  it("detects SREC3001 reserved S4 record type", () => {
    const text = [
      formatSrecRecord("S0", 0, new TextEncoder().encode("HDR")),
      formatSrecRecord("S4", 0),
      "S9030000FC",
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.RESERVED_RECORD_TYPE.code));
  });

  it("detects SREC3002 S5/S6 data record count mismatch", () => {
    const text = [
      formatSrecRecord("S0", 0, new TextEncoder().encode("HDR")),
      formatSrecRecord("S1", 0x0000, new Uint8Array([0x11, 0x22])),
      formatSrecRecord("S5", 5), // declared 5, actual 1
      formatSrecRecord("S9", 0x0000),
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.RECORD_COUNT_MISMATCH.code));
  });

  it("detects SREC4001 missing termination record", () => {
    const text = [
      formatSrecRecord("S0", 0, new TextEncoder().encode("HDR")),
      formatSrecRecord("S1", 0x0000, new Uint8Array([0x11, 0x22])),
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.MISSING_TERMINATION.code));
  });

  it("detects SREC4002 mismatched address width between data and terminator", () => {
    const text = [
      formatSrecRecord("S0", 0, new TextEncoder().encode("HDR")),
      formatSrecRecord("S3", 0x00001000, new Uint8Array([0x11, 0x22])),
      formatSrecRecord("S9", 0x1000), // S3 requires S7, not S9
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.ADDRESS_WIDTH_MISMATCH.code));
  });

  it("detects SREC5001 overlapping address bytes and SREC5006 missing S0 header warning", () => {
    const text = [
      formatSrecRecord("S1", 0x0100, new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])),
      formatSrecRecord("S1", 0x0102, new Uint8Array([0xee, 0xff])),
      formatSrecRecord("S9", 0x0100),
    ].join("\n");
    const diags = lintSrec(text);
    assert.ok(diags.some((d) => d.code === SrecErrorCode.OVERLAPPING_ADDRESS.code));
    const missingHdr = diags.find((d) => d.code === SrecErrorCode.MISSING_HEADER.code);
    assert.ok(missingHdr);
    assert.strictEqual(missingHdr.severity, "warning");
  });
});
