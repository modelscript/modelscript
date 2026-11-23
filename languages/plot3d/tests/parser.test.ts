// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePlot3dAuto,
  parsePlot3dFunctionAscii,
  parsePlot3dGridAscii,
  parsePlot3dNam,
  parsePlot3dSolutionAscii,
  serializePlot3dFunctionAscii,
  serializePlot3dGridAscii,
  serializePlot3dSolutionAscii,
  tokenizePlot3dNumbers,
} from "../src/parser/ascii-parser.js";
import { generateIsentropicNozzlePlot3d } from "../src/solver/nozzle.js";

describe("PLOT3D ASCII Parser & Serializer", () => {
  it("tokenizes Fortran D-exponent notation and repeat counts", () => {
    const tokens = tokenizePlot3dNumbers(`
      # Comment line
      1.5D-2  -2.0d+1  3*0.25
      ! Another comment
      4.0E0, 5
    `);
    assert.deepStrictEqual(tokens, [0.015, -20, 0.25, 0.25, 0.25, 4.0, 5]);
  });

  it("parses and round-trips a single-block 3D ASCII grid (.xyz)", () => {
    const text = ["2 2 2", "0 1 0 1 0 1 0 1", "0 0 1 1 0 0 1 1", "0 0 0 0 1 1 1 1"].join("\n");

    const grid = parsePlot3dGridAscii(text);
    assert.strictEqual(grid.format, "ascii");
    assert.strictEqual(grid.dimension, "3d");
    assert.strictEqual(grid.multiBlock, false);
    assert.strictEqual(grid.blocks.length, 1);
    assert.strictEqual(grid.blocks[0]!.ni, 2);
    assert.strictEqual(grid.blocks[0]!.nj, 2);
    assert.strictEqual(grid.blocks[0]!.nk, 2);
    assert.strictEqual(grid.blocks[0]!.x.length, 8);

    const serialized = serializePlot3dGridAscii(grid);
    const reparsed = parsePlot3dGridAscii(serialized);
    assert.deepStrictEqual(Array.from(reparsed.blocks[0]!.x), Array.from(grid.blocks[0]!.x));
    assert.deepStrictEqual(Array.from(reparsed.blocks[0]!.y), Array.from(grid.blocks[0]!.y));
    assert.deepStrictEqual(Array.from(reparsed.blocks[0]!.z), Array.from(grid.blocks[0]!.z));
  });

  it("parses a multi-block 3D ASCII grid with iblank", () => {
    const text = [
      "2",
      "2 2 2",
      "2 2 2",
      // Block 1: x, y, z, iblank
      "0 1 0 1 0 1 0 1",
      "0 0 1 1 0 0 1 1",
      "0 0 0 0 1 1 1 1",
      "1 1 1 1 1 1 1 1",
      // Block 2: x, y, z, iblank
      "1 2 1 2 1 2 1 2",
      "0 0 1 1 0 0 1 1",
      "0 0 0 0 1 1 1 1",
      "1 1 1 1 0 0 0 0",
    ].join("\n");

    const grid = parsePlot3dGridAscii(text);
    assert.strictEqual(grid.multiBlock, true);
    assert.strictEqual(grid.hasIblank, true);
    assert.strictEqual(grid.blocks.length, 2);
    assert.deepStrictEqual(Array.from(grid.blocks[1]!.iblank!), [1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("parses a 2D single-block ASCII grid", () => {
    const text = ["2 2", "0.0 1.0 0.0 1.0", "0.0 0.0 2.0 2.0"].join("\n");

    const grid = parsePlot3dGridAscii(text);
    assert.strictEqual(grid.dimension, "2d");
    assert.strictEqual(grid.multiBlock, false);
    assert.strictEqual(grid.blocks[0]!.nk, 1);
    assert.deepStrictEqual(Array.from(grid.blocks[0]!.y), [0, 0, 2, 2]);
  });

  it("parses and round-trips multi-block 3D ASCII conservative solution (.q)", () => {
    const { solution } = generateIsentropicNozzlePlot3d({ ni: 7, nj: 2, nk: 2, numBlocks: 2 });
    const ascii = serializePlot3dSolutionAscii(solution, 12);
    const parsed = parsePlot3dSolutionAscii(ascii);

    assert.strictEqual(parsed.multiBlock, true);
    assert.strictEqual(parsed.dimension, "3d");
    assert.strictEqual(parsed.blocks.length, 2);
    assert.ok(Math.abs(parsed.blocks[0]!.conditions.fsmach - solution.blocks[0]!.conditions.fsmach) < 1e-8);
    assert.ok(Math.abs(parsed.blocks[1]!.energy[0]! - solution.blocks[1]!.energy[0]!) < 1e-5);
  });

  it("parses and round-trips PLOT3D function (.f) and metadata (.nam) files", () => {
    const fText = ["1", "2 2 1 2", "101325 101325 101325 101325", "0.5 0.5 0.5 0.5"].join("\n");

    const func = parsePlot3dFunctionAscii(fText);
    assert.strictEqual(func.blocks.length, 1);
    assert.strictEqual(func.blocks[0]!.nVars, 2);
    assert.strictEqual(func.blocks[0]!.fields.length, 2);

    const roundTrip = parsePlot3dFunctionAscii(serializePlot3dFunctionAscii(func));
    assert.strictEqual(roundTrip.blocks[0]!.fields[1]![0], 0.5);

    const nam = parsePlot3dNam("# Nozzle fields\nPressure\nMach_Number\n");
    assert.strictEqual(nam.title, "Nozzle fields");
    assert.deepStrictEqual(nam.variableNames, ["Pressure", "Mach_Number"]);

    const autoNam = parsePlot3dAuto("Density\nPressure\n", "fields.nam");
    assert.strictEqual(autoNam.kind, "nam");
    assert.strictEqual(autoNam.nam?.variableNames.length, 2);
  });
});
