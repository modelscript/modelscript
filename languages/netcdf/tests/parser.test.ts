// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCdl, parseCdl, parseNetcdf } from "../src/parser/index.js";

const SAMPLE_CDL = `
// Unidata NetCDF Classic CF-1.8 Atmospheric Grid Example
netcdf atmos_grid {
dimensions:
  time = UNLIMITED ; // (2 currently)
  lat = 2 ;
  lon = 3 ;
variables:
  double time(time) ;
    time:units = "hours since 2026-01-01 00:00:00" ;
    time:long_name = "forecast time" ;
  float lat(lat) ;
    lat:units = "degrees_north" ;
    lat:long_name = "latitude" ;
  float lon(lon) ;
    lon:units = "degrees_east" ;
    lon:long_name = "longitude" ;
  float temperature(time, lat, lon) ;
    temperature:units = "K" ;
    temperature:long_name = "Air Temperature" ;
    temperature:standard_name = "air_temperature" ;
    temperature:_FillValue = -9999.f ;
  short flag(lat) ;
    flag:units = "1" ;
    flag:long_name = "quality flag" ;
  byte mask(lon) ;
    mask:units = "1" ;
    mask:long_name = "land sea mask" ;
  int station_id ;
    station_id:units = "1" ;
    station_id:long_name = "WMO station identifier" ;
  char station_name(lon) ;

// global attributes:
  :Conventions = "CF-1.8" ;
  :title = "Atmospheric Forecast Slice" ;
  :version = 1, 2 ;
data:
  time = 0, 6 ;
  lat = -10.0, 10.0 ;
  lon = 0.0, 15.0, 30.0 ;
  temperature =
    280.5, 281.0, 282.5,
    285.0, _, 287.0,
    281.5, 282.0, 283.5,
    286.0, 287.0, 288.0 ;
  flag = 1s, 2s ;
  mask = 0b, 1b, 1b ;
  station_id = 72469 ;
  station_name = "DEN" ;
}
`;

describe("NetCDF CDL ASCII Parser & Formatter", () => {
  it("parses dimensions including UNLIMITED with current record count", () => {
    const ds = parseCdl(SAMPLE_CDL);
    assert.strictEqual(ds.name, "atmos_grid");
    assert.strictEqual(ds.sourceFormat, "cdl");
    assert.strictEqual(ds.parseErrors.length, 0);
    assert.strictEqual(ds.dimensions.length, 3);

    const timeDim = ds.dimensions.find((d) => d.name === "time");
    assert.ok(timeDim);
    assert.strictEqual(timeDim.isUnlimited, true);
    assert.strictEqual(timeDim.size, 2);

    const latDim = ds.dimensions.find((d) => d.name === "lat");
    assert.strictEqual(latDim?.size, 2);
    assert.strictEqual(latDim?.isUnlimited, false);
  });

  it("parses all NetCDF Classic types, variable attributes, global attributes, and data", () => {
    const ds = parseCdl(SAMPLE_CDL);
    assert.strictEqual(ds.variables.length, 8);
    assert.strictEqual(ds.globalAttributes.length, 3);

    const temp = ds.variables.find((v) => v.name === "temperature");
    assert.ok(temp);
    assert.strictEqual(temp.type, "float");
    assert.deepStrictEqual(temp.dimensions, ["time", "lat", "lon"]);
    assert.strictEqual(temp.isRecord, true);
    assert.strictEqual(temp.data?.length, 12);
    // '_' sentinel resolves to _FillValue (-9999)
    assert.strictEqual(temp.data?.[4], -9999);

    const conv = ds.globalAttributes.find((a) => a.name === "Conventions");
    assert.strictEqual(conv?.value, "CF-1.8");
    const ver = ds.globalAttributes.find((a) => a.name === "version");
    assert.deepStrictEqual(ver?.value, [1, 2]);
  });

  it("round-trips CDL through formatCdl and parseNetcdf", () => {
    const ds1 = parseNetcdf(SAMPLE_CDL);
    const serialized = formatCdl(ds1);
    const ds2 = parseCdl(serialized);

    assert.strictEqual(ds2.parseErrors.length, 0);
    assert.strictEqual(ds2.name, ds1.name);
    assert.strictEqual(ds2.dimensions.length, ds1.dimensions.length);
    assert.strictEqual(ds2.variables.length, ds1.variables.length);
    assert.deepStrictEqual(
      ds2.variables.find((v) => v.name === "temperature")?.data,
      ds1.variables.find((v) => v.name === "temperature")?.data,
    );
  });
});
