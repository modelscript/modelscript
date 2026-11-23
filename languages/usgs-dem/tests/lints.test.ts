// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintUsgsDem } from "../src/lints/index.js";
import { parseUsgsDem } from "../src/parser/index.js";

describe("@modelscript/usgs-dem lints (DEM1001-DEM5006)", () => {
  it("produces zero diagnostics for a valid USGS DEM", () => {
    const text = [
      'TYPE_A "CLEAN_QUAD" LEVEL=2 PATTERN=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=1 MINZ=100 MAXZ=120 NROWS=1 NCOLS=2',
      "TYPE_B 1 1 2 1 500000 4400000 0 100 110 : 100 110",
      "TYPE_B 1 2 2 1 500030 4400000 0 110 120 : 110 120",
      "TYPE_C 1 1 1 1 10 1 1 1 1 20",
    ].join("\n");
    const diags = lintUsgsDem(parseUsgsDem(text));
    assert.equal(diags.length, 0);
  });

  it("reports DEM1001 for syntax errors", () => {
    const diags = lintUsgsDem(parseUsgsDem("INVALID_RECORD foo bar"));
    assert.ok(diags.some((d) => d.code === "DEM1001"));
  });

  it("reports DEM2001, DEM2002, DEM2003 for invalid CRS and unit codes", () => {
    const text = [
      'TYPE_A "BAD_CODES" LEVEL=9 REF=99 ZONE=0 UNITS=9 ZUNITS=7 DX=30 DY=30 DZ=1 MINZ=100 MAXZ=110 NROWS=1 NCOLS=1',
      "TYPE_B 1 1 2 1 0 0 0 100 110 : 100 110",
    ].join("\n");
    const codes = new Set(lintUsgsDem(parseUsgsDem(text)).map((d) => d.code));
    assert.ok(codes.has("DEM2001"));
    assert.ok(codes.has("DEM2002"));
    assert.ok(codes.has("DEM2003"));
    assert.ok(codes.has("DEM5006"));
  });

  it("reports DEM3001 for non-positive spatial resolution dx/dy/dz", () => {
    const text = [
      'TYPE_A "BAD_RES" LEVEL=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=0 DY=-10 DZ=0 MINZ=0 MAXZ=10 NROWS=1 NCOLS=1',
      "TYPE_B 1 1 2 1 0 0 0 0 10 : 0 10",
    ].join("\n");
    const resErrors = lintUsgsDem(parseUsgsDem(text)).filter((d) => d.code === "DEM3001");
    assert.equal(resErrors.length, 3);
  });

  it("reports DEM4001 when Type B profiles are missing", () => {
    const text =
      'TYPE_A "NO_PROFILES" LEVEL=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=1 MINZ=0 MAXZ=100 NROWS=1 NCOLS=3';
    const diags = lintUsgsDem(parseUsgsDem(text));
    assert.ok(diags.some((d) => d.code === "DEM4001"));
  });

  it("reports DEM4002 when profile count mismatches Type A NCOLS", () => {
    const text = [
      'TYPE_A "MISMATCH" LEVEL=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=1 MINZ=0 MAXZ=100 NROWS=1 NCOLS=4',
      "TYPE_B 1 1 2 1 0 0 0 0 10 : 0 10",
      "TYPE_B 1 2 2 1 30 0 0 0 10 : 0 10",
    ].join("\n");
    const diags = lintUsgsDem(parseUsgsDem(text));
    assert.ok(diags.some((d) => d.code === "DEM4002"));
  });

  it("reports DEM5001, DEM5002, DEM5003, DEM5004, DEM5005", () => {
    const text = [
      'TYPE_A "OOB" LEVEL=1 REF=1 ZONE=99 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=1 MINZ=100 MAXZ=150 NROWS=1 NCOLS=1',
      "TYPE_B 1 1 3 1 0 0 0 100 200 : 100 200",
      "TYPE_C 1 -1 0 0 10 1 0 0 -2 10",
    ].join("\n");
    const codes = new Set(lintUsgsDem(parseUsgsDem(text)).map((d) => d.code));
    assert.ok(codes.has("DEM5001"));
    assert.ok(codes.has("DEM5002"));
    assert.ok(codes.has("DEM5004"));
    assert.ok(codes.has("DEM5005"));

    const invRange = lintUsgsDem(
      parseUsgsDem(
        'TYPE_A "INV" LEVEL=1 REF=0 ZONE=0 UNITS=3 ZUNITS=2 DX=3 DY=3 DZ=1 MINZ=500 MAXZ=100 NROWS=1 NCOLS=1\nTYPE_B 1 1 1 1 0 0 0 100 100 : 100',
      ),
    );
    assert.ok(invRange.some((d) => d.code === "DEM5003"));
  });
});
