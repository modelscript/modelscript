// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeNetcdfBinary, encodeNetcdfBinary, isNetcdfBinary, parseCdl, parseNetcdf } from "../src/parser/index.js";

const BINARY_SAMPLE_CDL = `
netcdf ocean_slice {
dimensions:
  time = UNLIMITED ; // (2 currently)
  y = 2 ;
  x = 3 ;
variables:
  double time(time) ;
    time:units = "seconds since 2026-01-01" ;
    time:long_name = "time" ;
  float salinity(time, y, x) ;
    salinity:units = "0.001" ;
    salinity:long_name = "Sea Water Salinity" ;
  short elev(y, x) ;
    elev:units = "m" ;
    elev:long_name = "Elevation" ;
  byte mask(x) ;
    mask:units = "1" ;
    mask:long_name = "Mask" ;
  int run_id ;
    run_id:units = "1" ;
    run_id:long_name = "Run ID" ;
  :Conventions = "CF-1.8" ;
data:
  time = 0.0, 3600.0 ;
  salinity = 34.5, 34.75, 35.0, 35.25, 35.5, 35.75,
             34.6, 34.85, 35.1, 35.35, 35.6, 35.85 ;
  elev = -120, -45, 0, 15, 320, 1450 ;
  mask = -1, 0, 1 ;
  run_id = 42001 ;
}
`;

describe("NetCDF Classic Binary Codec (CDF1 & CDF2)", () => {
  it("encodes and decodes CDF1 (CDF\\x01) big-endian binary with fixed and UNLIMITED record vars", () => {
    const ds = parseCdl(BINARY_SAMPLE_CDL);
    const bytes = encodeNetcdfBinary(ds, "classic");

    assert.strictEqual(isNetcdfBinary(bytes), true);
    assert.strictEqual(bytes[0], 0x43); // C
    assert.strictEqual(bytes[1], 0x44); // D
    assert.strictEqual(bytes[2], 0x46); // F
    assert.strictEqual(bytes[3], 0x01); // v1

    const decoded = parseNetcdf(bytes, "ocean_slice");
    assert.strictEqual(decoded.parseErrors.length, 0);
    assert.strictEqual(decoded.format, "classic");
    assert.strictEqual(decoded.sourceFormat, "binary");
    assert.strictEqual(decoded.dimensions.length, 3);
    assert.strictEqual(decoded.variables.length, 5);

    const decodedTime = decoded.variables.find((v) => v.name === "time");
    assert.deepStrictEqual(decodedTime?.data, [0, 3600]);

    const decodedElev = decoded.variables.find((v) => v.name === "elev");
    assert.deepStrictEqual(decodedElev?.data, [-120, -45, 0, 15, 320, 1450]);

    const decodedMask = decoded.variables.find((v) => v.name === "mask");
    assert.deepStrictEqual(decodedMask?.data, [-1, 0, 1]);

    const decodedRun = decoded.variables.find((v) => v.name === "run_id");
    assert.deepStrictEqual(decodedRun?.data, [42001]);
  });

  it("encodes and decodes CDF2 (CDF\\x02) 64-bit offset binary format", () => {
    const ds = parseCdl(BINARY_SAMPLE_CDL);
    const bytes = encodeNetcdfBinary(ds, "64bit-offset");

    assert.strictEqual(isNetcdfBinary(bytes), true);
    assert.strictEqual(bytes[3], 0x02);

    const decoded = decodeNetcdfBinary(bytes, "ocean_slice_v2");
    assert.strictEqual(decoded.parseErrors.length, 0);
    assert.strictEqual(decoded.format, "64bit-offset");

    const origSal = ds.variables.find((v) => v.name === "salinity")?.data as number[];
    const decSal = decoded.variables.find((v) => v.name === "salinity")?.data as number[];
    assert.strictEqual(decSal.length, origSal.length);
    for (let i = 0; i < origSal.length; i++) {
      assert.ok(Math.abs(decSal[i]! - origSal[i]!) < 1e-5, `salinity[${i}] mismatch`);
    }
  });

  it("reports NC1002 on invalid magic bytes and NC1003 on truncated streams", () => {
    const badMagic = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.strictEqual(isNetcdfBinary(badMagic), false);
    const dsBad = decodeNetcdfBinary(badMagic);
    assert.strictEqual(dsBad.parseErrors[0]?.code, "NC1002");

    const truncated = new Uint8Array([0x43, 0x44, 0x46, 0x01, 0x00, 0x00]);
    const dsTrunc = decodeNetcdfBinary(truncated);
    assert.strictEqual(dsTrunc.parseErrors[0]?.code, "NC1003");
  });
});
