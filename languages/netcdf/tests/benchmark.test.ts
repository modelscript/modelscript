// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeNetcdfBinary, encodeNetcdfBinary, parseCdl } from "../src/parser/index.js";
import {
  bilinearInterpolate2D,
  computeFieldRmse,
  computeFieldStats,
  sliceVariable,
  unpackVariableValues,
} from "../src/solver/index.js";
import type { NetcdfDataset } from "../src/types.js";

describe("NetCDF Numerical Benchmarks (CDF1/CDF2 Round-Trip, Bilinear Interpolation & Field Stats)", () => {
  it("achieves relErr < 1e-6 on CDF1 and CDF2 binary round-trip for float32 and float64 fields", () => {
    const nt = 3;
    const ny = 8;
    const nx = 10;
    const tempData: number[] = [];
    const pressData: number[] = [];

    for (let t = 0; t < nt; t++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          tempData.push(273.15 + 15.0 * Math.sin(0.3 * i) * Math.cos(0.4 * j) + 0.5 * t);
          pressData.push(101325.0 - 250.0 * j + 12.5 * i + 3.0 * t);
        }
      }
    }

    const ds: NetcdfDataset = {
      name: "bench_grid",
      format: "classic",
      sourceFormat: "cdl",
      dimensions: [
        { name: "time", size: nt, isUnlimited: true },
        { name: "y", size: ny, isUnlimited: false },
        { name: "x", size: nx, isUnlimited: false },
      ],
      variables: [
        {
          name: "temperature",
          type: "float",
          dimensions: ["time", "y", "x"],
          attributes: [
            { name: "units", type: "char", value: "K" },
            { name: "long_name", type: "char", value: "Air Temperature" },
          ],
          data: tempData,
          isRecord: true,
        },
        {
          name: "pressure",
          type: "double",
          dimensions: ["time", "y", "x"],
          attributes: [
            { name: "units", type: "char", value: "Pa" },
            { name: "long_name", type: "char", value: "Air Pressure" },
          ],
          data: pressData,
          isRecord: true,
        },
      ],
      globalAttributes: [{ name: "Conventions", type: "char", value: "CF-1.8" }],
      parseErrors: [],
    };

    for (const fmt of ["classic", "64bit-offset"] as const) {
      const encoded = encodeNetcdfBinary(ds, fmt);
      const decoded = decodeNetcdfBinary(encoded, `bench_${fmt}`);
      assert.strictEqual(decoded.parseErrors.length, 0);
      assert.strictEqual(decoded.format, fmt);

      const decTemp = decoded.variables.find((v) => v.name === "temperature")?.data as number[];
      const decPress = decoded.variables.find((v) => v.name === "pressure")?.data as number[];

      const tempErr = computeFieldRmse(decTemp, tempData);
      const pressErr = computeFieldRmse(decPress, pressData);

      assert.ok(tempErr.relErr < 1e-6, `${fmt} float32 relErr=${tempErr.relErr} >= 1e-6`);
      assert.ok(pressErr.relErr < 1e-12, `${fmt} float64 relErr=${pressErr.relErr} >= 1e-12`);
    }
  });

  it("achieves rmse < 1e-10 on 2D bilinear interpolation of exact bilinear analytic field", () => {
    // Analytic bilinear function: f(x, y) = 2.5 + 1.3*x - 0.7*y + 0.4*x*y
    const f = (x: number, y: number): number => 2.5 + 1.3 * x - 0.7 * y + 0.4 * x * y;
    const xCoords = [-10, -4, 0, 5, 12];
    const yCoords = [-8, -2, 3, 9];
    const grid: number[] = [];
    for (const y of yCoords) {
      for (const x of xCoords) {
        grid.push(f(x, y));
      }
    }

    const actual: number[] = [];
    const expected: number[] = [];
    for (let xi = -9.5; xi <= 11.5; xi += 1.75) {
      for (let yi = -7.5; yi <= 8.5; yi += 1.5) {
        actual.push(bilinearInterpolate2D(grid, xCoords, yCoords, xi, yi));
        expected.push(f(xi, yi));
      }
    }

    const metrics = computeFieldRmse(actual, expected);
    assert.ok(metrics.count > 100);
    assert.ok(metrics.rmse < 1e-10, `Bilinear interpolation RMSE=${metrics.rmse} >= 1e-10`);
  });

  it("computes exact field statistics (rmse < 1e-10) and multidimensional slices with CF unpacking", () => {
    const cdl = `
netcdf packed_cube {
dimensions:
  t = 2 ;
  y = 2 ;
  x = 2 ;
variables:
  short temp(t, y, x) ;
    temp:units = "K" ;
    temp:long_name = "Packed Temperature" ;
    temp:scale_factor = 0.5 ;
    temp:add_offset = 270.0 ;
    temp:_FillValue = -999s ;
  :Conventions = "CF-1.8" ;
data:
  temp = 20, 24, 28, 32,
         40, -999, 48, 52 ;
}
`;
    const ds = parseCdl(cdl);
    const v = ds.variables[0]!;
    const unpacked = unpackVariableValues(v);
    assert.deepStrictEqual(unpacked.slice(0, 4), [280, 282, 284, 286]);
    assert.ok(Number.isNaN(unpacked[5]));

    const slice0 = sliceVariable(ds, "temp", [0, ":", ":"]);
    assert.deepStrictEqual(slice0.dimensions, ["y", "x"]);
    assert.deepStrictEqual(slice0.shape, [2, 2]);
    assert.deepStrictEqual(slice0.data, [280, 282, 284, 286]);

    const stats = computeFieldStats(slice0.data);
    // Analytic for [280, 282, 284, 286]: mean=283, var=5, std=sqrt(5)
    assert.ok(Math.abs(stats.mean - 283.0) < 1e-12);
    assert.ok(Math.abs(stats.variance - 5.0) < 1e-12);
    assert.ok(Math.abs(stats.std - Math.sqrt(5.0)) < 1e-12);
    assert.strictEqual(stats.min, 280);
    assert.strictEqual(stats.max, 286);
  });
});
