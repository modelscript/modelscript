// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGribToDae } from "../src/dae/grib-to-dae.js";
import { parseGribDescriptor } from "../src/parser/text-parser.js";
import { gribToNetCdfCdl } from "../src/projections/grib-to-cdl.js";
import { gribToCsv } from "../src/projections/grib-to-csv.js";

const SAMPLE_HGT = `
GRIB edition=1
  PDS {
    center = 7
    parameter = HGT
    levelType = ISBL
    level = 500
    date = "2026-01-15T00:00"
    decimalScale = 0
  }
  GDS {
    gridType = 0
    ni = 3
    nj = 3
    la1 = 60.0
    lo1 = -100.0
    la2 = 40.0
    lo2 = -60.0
    di = 20.0
    dj = 10.0
  }
  BDS {
    bitsPerValue = 16
    binaryScale = 0
    referenceValue = 5200.0
    values = [
      5200, 5220, 5240,
      5400, 5420, 5440,
      5600, 5620, 5640
    ]
  }
7777
`;

describe("GRIB1 DAE Lowering & Projections", () => {
  it("lowers atmospheric primitive-equation balance to a structurally balanced DAEBuilder arena", () => {
    const doc = parseGribDescriptor(SAMPLE_HGT);
    const arena = lowerGribToDae(doc, { modelName: "Synoptic500hPa" });

    const varCount = arena.getVarCount();
    const eqCount = arena.getEqCount();
    assert.ok(varCount >= 18, `expected >= 18 variables, got ${varCount}`);
    assert.equal(varCount, eqCount, "DAE system must be structurally balanced (varCount === eqCount)");
  });

  it("projects GRIB1 fields to CF-1.8 NetCDF CDL", () => {
    const doc = parseGribDescriptor(SAMPLE_HGT);
    const cdl = gribToNetCdfCdl(doc, "synoptic_500");

    assert.ok(cdl.includes("netcdf synoptic_500 {"));
    assert.ok(cdl.includes("lat = 3 ;"));
    assert.ok(cdl.includes("lon = 3 ;"));
    assert.ok(cdl.includes("float HGT_ISBL_500(lat, lon) ;"));
    assert.ok(cdl.includes(':Conventions = "CF-1.8" ;'));
    assert.ok(cdl.includes("5200, 5220, 5240"));
  });

  it("projects GRIB1 lat/lon grids to flat CSV", () => {
    const doc = parseGribDescriptor(SAMPLE_HGT);
    const csv = gribToCsv(doc);
    const lines = csv.trim().split("\n");

    assert.equal(lines[0], "message,parameter,level_type,level_value,lat,lon,value");
    assert.equal(lines.length, 10); // header + 9 grid points
    assert.ok(lines[1]!.startsWith("0,HGT,ISBL,500,60,-100,5200"));
    assert.ok(lines[9]!.startsWith("0,HGT,ISBL,500,40,-60,5640"));
  });
});
