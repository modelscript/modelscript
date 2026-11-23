// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CDF_MAGIC_UNCOMPRESSED,
  CDF_MAGIC_V2,
  CDF_MAGIC_V3,
  decodeCdfBinary,
  encodeCdfBinary,
  isCdfBinaryBuffer,
  parseCdfSkeleton,
  parseNasaCdf,
} from "../src/parser/index.js";

const MAGNETOMETER_SKT = `#header
  CDF NAME: psp_fld_mag.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0

#GLOBALattributes
  "Project" 0: CDF_CHAR { "Parker Solar Probe" }
  "Descriptor" 0: CDF_CHAR { "FIELDS_MAG" }

#VARIABLEattributes
  "DEPEND_0"
  "UNITS"

#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    "UNITS" CDF_CHAR { "ms" }
    [0] = 63113947200000
    [1] = 63113947201000
    [2] = 63113947202000
  .
  "B_RTN" CDF_REAL8 1 1:[3] T T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "nT" }
    [0] = { 12.345678901, -4.567890123, 0.987654321 }
    [1] = { 13.111111111, -5.222222222, 1.333333333 }
    [2] = { 14.000000000, -6.500000000, 2.250000000 }
  .
  "QUALITY_FLAG" CDF_INT4 1 0:[] T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "flag" }
    [0] = 0
    [1] = 0
    [2] = 1
  .
#end
`;

describe("Binary CDF v2/v3 Record Codec", () => {
  it("encodes and decodes CDF v3 binary stream with 0xCDF30001 magic", () => {
    const doc = parseCdfSkeleton(MAGNETOMETER_SKT);
    const bin = encodeCdfBinary(doc, { version: "v3" });
    assert.equal(isCdfBinaryBuffer(bin), true);

    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    assert.equal(view.getUint32(0, false), CDF_MAGIC_V3);
    assert.equal(view.getUint32(4, false), CDF_MAGIC_UNCOMPRESSED);

    const decoded = decodeCdfBinary(bin, "psp_fld_mag.cdf");
    assert.equal(decoded.isBinary, true);
    assert.equal(decoded.formatVersion, "v3");
    assert.equal(decoded.header.fileName, "psp_fld_mag.cdf");
    assert.equal(decoded.globalAttributes.length, 2);
    assert.equal(decoded.variables.length, 3);
    assert.equal(decoded.variables[1]?.attributes["UNITS"]?.values[0], "nT");
    assert.deepEqual(decoded.variables[2]?.values, [0, 0, 1]);
  });

  it("encodes and decodes CDF v2 binary stream with 0xCDF26002 magic", () => {
    const doc = parseCdfSkeleton(MAGNETOMETER_SKT);
    const bin = encodeCdfBinary(doc, { version: "v2" });
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    assert.equal(view.getUint32(0, false), CDF_MAGIC_V2);

    const decoded = parseNasaCdf(bin);
    assert.equal(decoded.isBinary, true);
    assert.equal(decoded.formatVersion, "v2");
    assert.equal(decoded.variables.length, 3);
    assert.deepEqual(decoded.variables[1]?.values[0], [12.345678901, -4.567890123, 0.987654321]);
  });

  it("rejects invalid binary magic header with NCDF1002 message", () => {
    const bad = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0xff, 0xff]);
    assert.equal(isCdfBinaryBuffer(bad), false);
    assert.throws(() => decodeCdfBinary(bad), /DEADBEEF/);
  });
});
