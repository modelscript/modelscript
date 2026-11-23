// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintGribDocument } from "../src/lints/index.js";
import { parseGribDescriptor } from "../src/parser/text-parser.js";

describe("GRIB1 Linter (GRIB1001–GRIB5006)", () => {
  it("reports zero diagnostics on a valid GRIB1 descriptor", () => {
    const valid = `
GRIB edition=1
  PDS { center = 7, parameter = HGT, levelType = ISBL, level = 500, date = "2026-01-10T00:00", decimalScale = 0 }
  GDS { ni = 2, nj = 2, la1 = 60, lo1 = -100, la2 = 40, lo2 = -80, di = 20, dj = 20 }
  BDS { bitsPerValue = 16, binaryScale = 0, referenceValue = 5400, values = [5400, 5450, 5500, 5550] }
7777
`;
    const diags = lintGribDocument(parseGribDescriptor(valid));
    assert.equal(diags.length, 0);
  });

  it("detects missing 7777 trailer (GRIB1002) and unsupported edition (GRIB1003)", () => {
    const src = `
GRIB edition=2
  PDS { parameter = TMP, levelType = ISBL, level = 500, date = "2026-01-10T00:00" }
  GDS { ni = 2, nj = 1, la1 = 50, lo1 = 0, la2 = 50, lo2 = 10, di = 10, dj = 10 }
  BDS { bitsPerValue = 16, values = [260, 262] }
`;
    const diags = lintGribDocument(parseGribDescriptor(src));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("GRIB1002"), "should flag missing 7777 trailer");
    assert.ok(codes.has("GRIB1003"), "should flag unsupported edition != 1");
  });

  it("detects invalid PDS date (GRIB2001) and invalid parameter code (GRIB2002)", () => {
    const src = `
GRIB edition=1
  PDS { parameter = 255, levelType = ISBL, level = 500, year = 2026, month = 13, day = 40, hour = 25, minute = 0 }
  GDS { ni = 1, nj = 1, la1 = 45, lo1 = 0, la2 = 45, lo2 = 0, di = 1, dj = 1 }
  BDS { bitsPerValue = 16, values = [270] }
7777
`;
    const diags = lintGribDocument(parseGribDescriptor(src));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("GRIB2001"), "should flag invalid PDS date/time");
    assert.ok(codes.has("GRIB2002"), "should flag invalid parameter code");
  });

  it("detects GDS/BDS dimension mismatch (GRIB3001), invalid lat/lon bounds (GRIB3002), and invalid bit-width (GRIB4001)", () => {
    const src = `
GRIB edition=1
  PDS { parameter = TMP, levelType = ISBL, level = 500, date = "2026-01-10T00:00" }
  GDS { ni = 3, nj = 3, la1 = 95, lo1 = -200, la2 = 40, lo2 = 0, di = 10, dj = 10 }
  BDS { bitsPerValue = 40, values = [250, 251, 252] }
7777
`;
    const diags = lintGribDocument(parseGribDescriptor(src));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("GRIB3001"), "should flag GDS/BDS dimension mismatch");
    assert.ok(codes.has("GRIB3002"), "should flag invalid lat/lon bounds");
    assert.ok(codes.has("GRIB4001"), "should flag invalid bit-width > 32");
  });

  it("detects missing PDS/BDS (GRIB5001/GRIB5002) and physical range warning (GRIB5006)", () => {
    const emptyMsg = `GRIB edition=1\n7777`;
    const diags1 = lintGribDocument(parseGribDescriptor(emptyMsg));
    const codes1 = new Set(diags1.map((d) => d.code));
    assert.ok(codes1.has("GRIB5001"));
    assert.ok(codes1.has("GRIB5002"));

    const badTemp = `
GRIB edition=1
  PDS { parameter = TMP, levelType = ISBL, level = 500, date = "2026-01-10T00:00" }
  GDS { ni = 2, nj = 1, la1 = 45, lo1 = 0, la2 = 45, lo2 = 10, di = 10, dj = 10 }
  BDS { bitsPerValue = 16, values = [50.0, 270.0] }
7777
`;
    const diags2 = lintGribDocument(parseGribDescriptor(badTemp));
    assert.ok(
      diags2.some((d) => d.code === "GRIB5006"),
      "should flag implausible temperature 50 K",
    );
  });
});
