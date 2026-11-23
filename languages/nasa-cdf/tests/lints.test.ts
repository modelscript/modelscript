// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintNasaCdf } from "../src/lints/index.js";
import { parseCdfSkeleton } from "../src/parser/skt-parser.js";

describe("NASA CDF Lints (NCDF1001-NCDF5006)", () => {
  it("reports zero errors/warnings on a fully ISTP-compliant skeleton table", () => {
    const validSkt = `#header
  CDF NAME: clean_istp.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0
#GLOBALattributes
  "Project" 0: CDF_CHAR { "THEMIS" }
  "Source_name" 0: CDF_CHAR { "THA" }
  "Discipline" 0: CDF_CHAR { "Space Physics" }
  "Data_type" 0: CDF_CHAR { "L2" }
  "Descriptor" 0: CDF_CHAR { "FGM" }
#VARIABLEattributes
  "DEPEND_0"
  "UNITS"
  "VALIDMIN"
  "VALIDMAX"
  "FILLVAL"
  "VAR_TYPE"
#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    "VAR_TYPE" CDF_CHAR { "support_data" }
    [0] = "2025-03-15T12:00:00.000Z"
    [1] = "2025-03-15T12:00:01.000Z"
  .
  "B_MAG" CDF_REAL4 1 0:[] T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "nT" }
    "VALIDMIN" CDF_REAL4 { 0.0 }
    "VALIDMAX" CDF_REAL4 { 1000.0 }
    "FILLVAL" CDF_REAL4 { -1.0e31 }
    "VAR_TYPE" CDF_CHAR { "data" }
    [0] = 5.0
    [1] = 5.2
  .
#end
`;
    const diags = lintNasaCdf(parseCdfSkeleton(validSkt));
    assert.equal(diags.length, 0);
  });

  it("detects missing #header (NCDF2001) and missing #end (NCDF2002)", () => {
    const doc = parseCdfSkeleton(`#variables
  "X" CDF_REAL4 1 0:[] T
  .
`);
    const codes = new Set(lintNasaCdf(doc).map((d) => d.code));
    assert.ok(codes.has("NCDF2001"));
    assert.ok(codes.has("NCDF2002"));
  });

  it("detects duplicate variable (NCDF2003), duplicate attribute (NCDF2004), and invalid type (NCDF3001)", () => {
    const doc = parseCdfSkeleton(`#header
  CDF NAME: dup_test.cdf
#GLOBALattributes
  "Project" 0: CDF_CHAR { "A" }
  "Project" 0: CDF_CHAR { "B" }
#variables
  "V1" CDF_FAKE99 1 0:[] T
  .
  "V1" CDF_REAL4 1 0:[] T
  .
#end
`);
    const codes = new Set(lintNasaCdf(doc).map((d) => d.code));
    assert.ok(codes.has("NCDF2003"));
    assert.ok(codes.has("NCDF2004"));
    assert.ok(codes.has("NCDF3001"));
  });

  it("detects ISTP missing DEPEND_0 (NCDF4001), UNITS (NCDF4002), VALIDMIN/VALIDMAX (NCDF4003), out-of-range (NCDF5002), and non-monotonic EPOCH (NCDF5003)", () => {
    const doc = parseCdfSkeleton(`#header
  CDF NAME: istp_violations.cdf
#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    [0] = "2025-03-15T12:00:05.000Z"
    [1] = "2025-03-15T12:00:02.000Z"
  .
  "B_MISSING" CDF_REAL4 1 0:[] T
    [0] = 10.0
  .
  "B_RANGE" CDF_REAL4 1 0:[] T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "nT" }
    "VALIDMIN" CDF_REAL4 { 0.0 }
    "VALIDMAX" CDF_REAL4 { 50.0 }
    [0] = 120.0
  .
#end
`);
    const codes = new Set(lintNasaCdf(doc).map((d) => d.code));
    assert.ok(codes.has("NCDF4001"));
    assert.ok(codes.has("NCDF4002"));
    assert.ok(codes.has("NCDF4003"));
    assert.ok(codes.has("NCDF5002"));
    assert.ok(codes.has("NCDF5003"));
  });
});
