// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hdf4ToDae, lowerHdf4ToDae } from "../src/dae/index.js";
import { parseHdf4Ddl } from "../src/parser/ddl-parser.js";
import { hdf4ToCsv, hdf4ToNetcdfCdl } from "../src/projections/index.js";

const SAMPLE_EOS = `
HDF4 TerraSurface VERSION="4.2"
  ATTR Producer = "NASA"
  SDS LST TYPE=FLOAT32 REF=10 UNIT="K"
    DIM lat = 2
    DIM lon = 2
    ATTR scale_factor = 0.02
    ATTR add_offset = 250.0
    DATA [1000, 1100, 1200, 1300]
  END
  SDS Emissivity TYPE=FLOAT32 REF=11 UNIT="1"
    DIM lat = 2
    DIM lon = 2
    DATA [0.95, 0.96, 0.97, 0.98]
  END
END
`;

describe("HDF4 DAE lowering & projections", () => {
  it("lowers scientific datasets and container balance equations into DAEBuilder", () => {
    const doc = parseHdf4Ddl(SAMPLE_EOS);
    const builder = new DAEBuilder(undefined, "TerraSurface");
    const res = lowerHdf4ToDae(builder, doc);

    assert.equal(res.datasetCount, 2);
    // 10 vars per SDS + 1 container.total_integral = 21
    assert.equal(res.variableCount, 21);
    // 3 eqs per SDS + 1 global balance eq = 7
    assert.equal(res.equationCount, 7);

    const dae = hdf4ToDae(doc, { modelName: "TerraSurface" });
    assert.ok(dae.lookupVariable("LST.calibrated_mean") >= 0);
    assert.ok(dae.lookupVariable("Emissivity.integral_sum") >= 0);
    assert.ok(dae.lookupVariable("container.total_integral") >= 0);
  });

  it("projects HDF4 documents to NetCDF CDL and RFC-4180 CSV", () => {
    const doc = parseHdf4Ddl(SAMPLE_EOS);
    const cdl = hdf4ToNetcdfCdl(doc);
    assert.ok(cdl.includes("netcdf TerraSurface {"));
    assert.ok(cdl.includes("lat = 2 ;"));
    assert.ok(cdl.includes("float LST(lat, lon) ;"));
    assert.ok(cdl.includes('LST:units = "K" ;'));

    const csv = hdf4ToCsv(doc, "LST");
    const lines = csv.trim().split("\n");
    assert.equal(lines.length, 3); // header + 2 rows
    assert.equal(lines[0], "lat,lon_0,lon_1");
    assert.equal(lines[1], "0,1000,1100");
    assert.equal(lines[2], "1,1200,1300");
  });
});
