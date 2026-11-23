// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintNetcdf } from "../src/lints/index.js";
import { decodeNetcdfBinary, parseCdl } from "../src/parser/index.js";

describe("NetCDF Structural & CF-1.x Lints (NC1001–NC5006)", () => {
  it("produces zero diagnostics for a clean CF-1.8 compliant dataset", () => {
    const clean = `
netcdf clean_cf {
dimensions:
  x = 2 ;
  y = 2 ;
variables:
  float temp(y, x) ;
    temp:units = "K" ;
    temp:long_name = "Air Temperature" ;
  :Conventions = "CF-1.8" ;
data:
  temp = 280.0, 281.0, 282.0, 283.0 ;
}
`;
    const diags = lintNetcdf(parseCdl(clean));
    assert.strictEqual(diags.length, 0);
  });

  it("detects duplicate dimension/variable/attribute, undefined dimension, and non-positive size", () => {
    const bad = `
netcdf bad_schema {
dimensions:
  x = 3 ;
  x = 4 ;
  zero_dim = 0 ;
  t1 = UNLIMITED ;
  t2 = UNLIMITED ;
variables:
  float a(x, missing_dim) ;
    a:units = "K" ;
    a:units = "C" ;
    a:long_name = "A" ;
  float a(x) ;
    a:units = "K" ;
    a:long_name = "Dup A" ;
  float bad_rec(x, t1) ;
    bad_rec:units = "m" ;
    bad_rec:long_name = "Bad record order" ;
  :Conventions = "CF-1.8" ;
  :Conventions = "CF-1.7" ;
}
`;
    const codes = new Set(lintNetcdf(parseCdl(bad)).map((d) => d.code));
    assert.ok(codes.has("NC2001"), "Expected NC2001 duplicate dimension");
    assert.ok(codes.has("NC2002"), "Expected NC2002 duplicate variable");
    assert.ok(codes.has("NC2003"), "Expected NC2003 duplicate attribute");
    assert.ok(codes.has("NC2004"), "Expected NC2004 undefined dimension");
    assert.ok(codes.has("NC3001"), "Expected NC3001 non-positive dimension");
    assert.ok(codes.has("NC3002"), "Expected NC3002 multiple UNLIMITED dimensions");
    assert.ok(codes.has("NC3003"), "Expected NC3003 UNLIMITED not leading");
  });

  it("detects data count mismatch, undeclared data variable, CF warnings, NaN fill mismatch, and invalid scaling", () => {
    const badData = `
netcdf bad_data {
dimensions:
  x = 3 ;
variables:
  float field(x) ;
    field:_FillValue = "wrong_type" ;
    field:scale_factor = 0.0 ;
data:
  field = 1.0, NaN ;
  ghost_var = 1, 2, 3 ;
}
`;
    const codes = new Set(lintNetcdf(parseCdl(badData)).map((d) => d.code));
    assert.ok(codes.has("NC4001"), "Expected NC4001 data count mismatch");
    assert.ok(codes.has("NC4002"), "Expected NC4002 undeclared data variable");
    assert.ok(codes.has("NC5001"), "Expected NC5001 missing units warning");
    assert.ok(codes.has("NC5002"), "Expected NC5002 missing long_name warning");
    assert.ok(codes.has("NC5003"), "Expected NC5003 missing Conventions info");
    assert.ok(codes.has("NC5004"), "Expected NC5004 NaN/Inf fill value mismatch");
    assert.ok(codes.has("NC5005"), "Expected NC5005 _FillValue type mismatch");
    assert.ok(codes.has("NC5006"), "Expected NC5006 scale_factor invalid");
  });

  it("propagates binary magic error NC1002 through lintNetcdf", () => {
    const ds = decodeNetcdfBinary(new Uint8Array([1, 2, 3, 4]));
    const diags = lintNetcdf(ds);
    assert.ok(diags.some((d) => d.code === "NC1002"));
  });
});
