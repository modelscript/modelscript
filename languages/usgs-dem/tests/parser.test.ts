// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateInclinedPlaneDem } from "../src/catalog/index.js";
import { parseUsgsDem, serializeUsgsDem } from "../src/parser/index.js";

const FREE_FORMAT_DEM = [
  "# Sample USGS 7.5-minute DEM in free-format ASCII",
  'TYPE_A "BOULDER_WEST_CO" LEVEL=2 PATTERN=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=1 MINZ=1600 MAXZ=1650 ACCURACY=1 NROWS=1 NCOLS=3',
  "TYPE_B 1 1 3 1 470000 4420000 0 1600 1620 : 1600 1610 1620",
  "TYPE_B 1 2 3 1 470030 4420000 0 1615 1635 : 1615 1625 1635",
  "TYPE_B 1 3 3 1 470060 4420000 0 1630 1650 : 1630 1640 1650",
  "TYPE_C 1 2 2 1 15 1 1 1 2 30",
].join("\n");

describe("@modelscript/usgs-dem parser", () => {
  it("parses free-format TYPE_A, TYPE_B, and TYPE_C records", () => {
    const model = parseUsgsDem(FREE_FORMAT_DEM);
    assert.equal(model.format, "free-format");
    assert.equal(model.syntaxErrors.length, 0);
    assert.equal(model.header.quadrangleName, "BOULDER_WEST_CO");
    assert.equal(model.header.demLevelCode, 2);
    assert.equal(model.header.groundRefSystem, 1);
    assert.equal(model.header.groundRefZone, 13);
    assert.equal(model.header.planimetricUnits, 2);
    assert.equal(model.header.elevationUnits, 2);
    assert.equal(model.header.spatialResolution.dx, 30);
    assert.equal(model.header.spatialResolution.dy, 30);
    assert.equal(model.header.spatialResolution.dz, 1);
    assert.equal(model.profiles.length, 3);
    assert.equal(model.grid.numCols, 3);
    assert.equal(model.grid.numRows, 3);
    assert.equal(model.grid.z[0], 1600);
    assert.equal(model.grid.z[2 * 3 + 2], 1650);
    assert.ok(model.accuracy);
    assert.deepEqual(model.accuracy.rmseDem, [1, 1, 2]);
    assert.equal(model.accuracy.sampleSizeDem, 30);
  });

  it("round-trips 1024-byte fixed-column USGS DEM with Fortran D exponents", () => {
    const synth = generateInclinedPlaneDem({
      quadrangleName: "MOUNT_EVANS_CO",
      numCols: 5,
      numRows: 4,
      dx: 30,
      dy: 30,
      dz: 1,
      baseElevation: 3000,
      gradX: 0.1,
      gradY: 0.2,
    });
    const fixedText = serializeUsgsDem(synth, "fixed-1024");
    const firstLine = fixedText.split("\n")[0]!;
    assert.equal(firstLine.length, 1024);
    assert.ok(firstLine.includes("D+"), "Fixed-column Type A should contain Fortran D exponents");

    const reparsed = parseUsgsDem(fixedText);
    assert.equal(reparsed.format, "fixed-1024");
    assert.equal(reparsed.syntaxErrors.length, 0);
    assert.equal(reparsed.header.quadrangleName, "MOUNT_EVANS_CO");
    assert.equal(reparsed.header.cols, 5);
    assert.equal(reparsed.profiles.length, 5);
    assert.equal(reparsed.grid.numCols, 5);
    assert.equal(reparsed.grid.numRows, 4);
    assert.equal(reparsed.grid.z[0], 3000);
  });

  it("parses multi-line continuation samples for TYPE_B profiles", () => {
    const text = [
      'TYPE_A "CONT_QUAD" LEVEL=1 PATTERN=1 REF=1 ZONE=12 UNITS=2 ZUNITS=2 DX=10 DY=10 DZ=1 MINZ=100 MAXZ=130 NROWS=1 NCOLS=2',
      "TYPE_B 1 1 4 1 500000 4400000 0 100 130 : 100 110",
      "  120 130",
      "TYPE_B 1 2 4 1 500010 4400000 0 100 130 : 100 110 120 130",
    ].join("\n");
    const model = parseUsgsDem(text);
    assert.equal(model.syntaxErrors.length, 0);
    assert.equal(model.profiles[0]!.elevations.length, 4);
    assert.deepEqual(model.profiles[0]!.elevations, [100, 110, 120, 130]);
  });

  it("applies dz scale factor and local datum offset to Type B elevations", () => {
    const text = [
      'TYPE_A "SCALED_QUAD" LEVEL=1 PATTERN=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=0.5 MINZ=100 MAXZ=120 NROWS=1 NCOLS=1',
      "TYPE_B 1 1 3 1 500000 4400000 100 100 110 : 0 10 20",
    ].join("\n");
    const model = parseUsgsDem(text);
    assert.deepEqual(model.profiles[0]!.elevations, [100, 105, 110]);
  });
});
