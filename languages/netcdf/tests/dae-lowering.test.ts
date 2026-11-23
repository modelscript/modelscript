// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { netcdfToDae } from "../src/dae/index.js";
import { parseCdl } from "../src/parser/index.js";
import { netcdfToCsv, netcdfToModelica, netcdfToPlot3d } from "../src/projections/index.js";

const DAE_SAMPLE_CDL = `
netcdf thermal_slab {
dimensions:
  lat = 2 ;
  lon = 3 ;
variables:
  float lat(lat) ;
    lat:units = "degrees_north" ;
    lat:long_name = "latitude" ;
  float lon(lon) ;
    lon:units = "degrees_east" ;
    lon:long_name = "longitude" ;
  float temperature(lat, lon) ;
    temperature:units = "K" ;
    temperature:long_name = "Surface Air Temperature" ;
  :Conventions = "CF-1.8" ;
data:
  lat = 10.0, 20.0 ;
  lon = -120.0, -110.0, -100.0 ;
  temperature = 280.0, 282.0, 284.0,
                286.0, 288.0, 290.0 ;
}
`;

describe("NetCDF DAE Arena Lowering & Polyglot Projections", () => {
  it("lowers NetCDF coordinate and field variables directly into DAEBuilder linear memory", () => {
    const ds = parseCdl(DAE_SAMPLE_CDL);
    const { builder, result } = netcdfToDae(ds);

    assert.ok(result.stateVarIndices.length === 1, "Should create 1 field mean state variable");
    assert.ok(result.parameterVarIndices.length >= 6, "Should register dimensions and bounds as parameters");
    assert.strictEqual(result.equationCount, 4, "2 coord spans + 1 ODE + 1 spread equation");
    assert.ok(result.variableMap.has("temperature_mean"));
    assert.ok(result.variableMap.has("dim_lat"));
    assert.ok(result.variableMap.has("dim_lon"));
    assert.ok(builder.getVarCount() >= result.variableMap.size);
    assert.strictEqual(builder.getEqCount(), result.equationCount);
  });

  it("projects NetCDF dataset to tidy CSV, NASA PLOT3D, and Modelica 3.x", () => {
    const ds = parseCdl(DAE_SAMPLE_CDL);

    const csv = netcdfToCsv(ds);
    const csvLines = csv.trim().split("\n");
    assert.strictEqual(csvLines[0], "lat,lon,temperature");
    assert.strictEqual(csvLines.length, 7); // 1 header + 6 grid points
    assert.strictEqual(csvLines[1], "10,-120,280");
    assert.strictEqual(csvLines[6], "20,-100,290");

    const plot3d = netcdfToPlot3d(ds, "temperature");
    assert.strictEqual(plot3d.ni, 3);
    assert.strictEqual(plot3d.nj, 2);
    assert.strictEqual(plot3d.nk, 1);
    assert.ok(plot3d.gridXyz.includes("3 2 1"));
    assert.ok(plot3d.solutionQ.includes("290.000000"));

    const mo = netcdfToModelica(ds);
    assert.ok(mo.includes("model thermal_slab"));
    assert.ok(mo.includes("parameter Integer dim_lat = 2;"));
    assert.ok(mo.includes("der(temperature_mean)"));
    assert.ok(mo.includes("end thermal_slab;"));
  });
});
