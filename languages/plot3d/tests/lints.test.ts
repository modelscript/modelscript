// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPlot3dDataset, lintPlot3dFunction, lintPlot3dGrid, lintPlot3dSolution } from "../src/lints/index.js";
import { generateIsentropicNozzlePlot3d } from "../src/solver/nozzle.js";
import type { Plot3dFunctionFile, Plot3dGrid, Plot3dSolution } from "../src/types.js";

describe("PLOT3D Lints & Diagnostics (P3D1001–P3D5006)", () => {
  it("reports zero diagnostics on a valid 3D multi-block nozzle grid + solution", () => {
    const { grid, solution } = generateIsentropicNozzlePlot3d({ ni: 9, nj: 3, nk: 3, numBlocks: 2 });
    const diags = lintPlot3dDataset({ kind: "combined", grid, solution });
    assert.strictEqual(diags.length, 0);
  });

  it("detects P3D5001 empty grid and P3D2001 non-positive dimensions", () => {
    const empty: Plot3dGrid = {
      format: "ascii",
      dimension: "3d",
      multiBlock: true,
      hasIblank: false,
      blocks: [],
    };
    assert.ok(lintPlot3dGrid(empty).some((d) => d.id === "P3D5001"));

    const badDim: Plot3dGrid = {
      format: "ascii",
      dimension: "3d",
      multiBlock: false,
      hasIblank: false,
      blocks: [
        {
          index: 0,
          ni: 0,
          nj: 2,
          nk: 2,
          x: new Float64Array(),
          y: new Float64Array(),
          z: new Float64Array(),
        },
      ],
    };
    assert.ok(lintPlot3dGrid(badDim).some((d) => d.id === "P3D2001"));
  });

  it("detects P3D2002 coordinate count mismatch and P3D5002 NaN values", () => {
    const badCount: Plot3dGrid = {
      format: "ascii",
      dimension: "3d",
      multiBlock: false,
      hasIblank: false,
      blocks: [
        {
          index: 0,
          ni: 2,
          nj: 2,
          nk: 2,
          x: new Float64Array([0, 1, 0]), // expected 8
          y: new Float64Array(8),
          z: new Float64Array(8),
        },
      ],
    };
    assert.ok(lintPlot3dGrid(badCount).some((d) => d.id === "P3D2002"));

    const nanGrid: Plot3dGrid = {
      format: "ascii",
      dimension: "3d",
      multiBlock: false,
      hasIblank: false,
      blocks: [
        {
          index: 0,
          ni: 2,
          nj: 2,
          nk: 2,
          x: new Float64Array([0, Number.NaN, 0, 1, 0, 1, 0, 1]),
          y: new Float64Array([0, 0, 1, 1, 0, 0, 1, 1]),
          z: new Float64Array([0, 0, 0, 0, 1, 1, 1, 1]),
        },
      ],
    };
    assert.ok(lintPlot3dGrid(nanGrid).some((d) => d.id === "P3D5002"));
  });

  it("detects P3D3001 negative Jacobian / inverted hexahedral cell volume", () => {
    // Flip z-axis (1 -> 0) so the cell is left-handed (negative volume)
    const invertedGrid: Plot3dGrid = {
      format: "ascii",
      dimension: "3d",
      multiBlock: false,
      hasIblank: false,
      blocks: [
        {
          index: 0,
          ni: 2,
          nj: 2,
          nk: 2,
          x: new Float64Array([0, 1, 0, 1, 0, 1, 0, 1]),
          y: new Float64Array([0, 0, 1, 1, 0, 0, 1, 1]),
          z: new Float64Array([1, 1, 1, 1, 0, 0, 0, 0]),
        },
      ],
    };
    const diags = lintPlot3dGrid(invertedGrid);
    assert.ok(diags.some((d) => d.id === "P3D3001"));
  });

  it("detects P3D3002 negative density, P3D3003 negative static pressure, P3D4001/P3D4002/P3D4003 invalid conditions, and P3D2003 block mismatch", () => {
    const { grid, solution } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 2, nk: 2, numBlocks: 1 });
    const badSol: Plot3dSolution = {
      ...solution,
      blocks: [
        {
          ...solution.blocks[0]!,
          conditions: { fsmach: -0.5, alpha: 250, re: -100, time: 0 },
          rho: new Float64Array(solution.blocks[0]!.rho),
          energy: new Float64Array(solution.blocks[0]!.energy),
        },
      ],
    };
    badSol.blocks[0]!.rho[0] = -1.0; // triggers P3D3002
    badSol.blocks[0]!.energy[1] = 0.0; // kinetic > energy => p <= 0 triggers P3D3003

    const diags = lintPlot3dSolution(badSol, grid);
    assert.ok(diags.some((d) => d.id === "P3D3002"));
    assert.ok(diags.some((d) => d.id === "P3D3003"));
    assert.ok(diags.some((d) => d.id === "P3D4001"));
    assert.ok(diags.some((d) => d.id === "P3D4002"));
    assert.ok(diags.some((d) => d.id === "P3D4003"));

    // Block count mismatch
    const { grid: grid2 } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 2, nk: 2, numBlocks: 2 });
    const mismatchDiags = lintPlot3dSolution(solution, grid2);
    assert.ok(mismatchDiags.some((d) => d.id === "P3D2003"));
  });

  it("detects P3D5006 function/.nam variable count mismatch", () => {
    const func: Plot3dFunctionFile = {
      format: "ascii",
      dimension: "3d",
      multiBlock: false,
      blocks: [
        {
          index: 0,
          ni: 2,
          nj: 2,
          nk: 1,
          nVars: 2,
          fields: [new Float64Array(4), new Float64Array(4)],
        },
      ],
    };
    const diags = lintPlot3dFunction(func, { variableNames: ["Pressure"] });
    assert.ok(diags.some((d) => d.id === "P3D5006"));
  });
});
