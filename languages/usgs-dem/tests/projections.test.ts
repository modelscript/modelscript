// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateGaussianHillDem } from "../src/catalog/index.js";
import { usgsDemToHec1, usgsDemToObj, usgsDemToStl } from "../src/projections/index.js";

describe("@modelscript/usgs-dem projections (STL, OBJ, HEC-1)", () => {
  const model = generateGaussianHillDem({
    quadrangleName: "RED_ROCKS_CO",
    numCols: 7,
    numRows: 7,
    dx: 30,
    dy: 30,
  });

  it("exports watertight ASCII STL terrain mesh", () => {
    const stl = usgsDemToStl(model);
    assert.ok(stl.startsWith("solid RED_ROCKS_CO"));
    assert.ok(stl.includes("facet normal"));
    assert.ok(stl.includes("vertex "));
    assert.ok(stl.trim().endsWith("endsolid RED_ROCKS_CO"));
  });

  it("exports Wavefront OBJ terrain mesh with vertices and triangular faces", () => {
    const obj = usgsDemToObj(model);
    assert.ok(obj.includes("o RED_ROCKS_CO"));
    const vCount = obj.split("\n").filter((l) => l.startsWith("v ")).length;
    const fCount = obj.split("\n").filter((l) => l.startsWith("f ")).length;
    assert.equal(vCount, 7 * 7);
    assert.equal(fCount, 6 * 6 * 2);
  });

  it("exports USACE HEC-1 subbasin summary deck", () => {
    const hec1 = usgsDemToHec1(model, { curveNumber: 78, manningN: 0.04 });
    assert.ok(hec1.includes("ID  USGS DEM WATERSHED SUMMARY: RED_ROCKS_CO"));
    assert.ok(hec1.includes("BA"));
    assert.ok(hec1.includes("LS"));
    assert.ok(hec1.includes("UD"));
    assert.ok(hec1.trim().endsWith("ZZ"));
  });
});
