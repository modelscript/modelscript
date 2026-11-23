// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plot3dToDae } from "../src/dae/plot3d-to-dae.js";
import { generateIsentropicNozzlePlot3d } from "../src/solver/nozzle.js";

describe("PLOT3D Finite-Volume Euler DAE Lowering", () => {
  it("lowers a multi-block PLOT3D grid + solution into DAEBuilder with balanced variables and equations", () => {
    const { grid, solution } = generateIsentropicNozzlePlot3d({
      ni: 11,
      nj: 3,
      nk: 3,
      numBlocks: 2,
    });

    const dae = plot3dToDae(grid, solution, {
      modelName: "NozzleEulerFVM",
      gamma: 1.4,
      maxCellsPerBlock: 4,
    });

    // 2 global parameters (gamma, total_volume) + 2 blocks * 4 cells * 5 vars (rho, rhou, E, u, p) = 42 vars
    const expectedVars = 2 + 2 * 4 * 5;
    assert.strictEqual(dae.getVarCount(), expectedVars);
    // 2 parameter equations + 2 blocks * 4 cells * 5 equations = 42 equations
    assert.strictEqual(dae.getEqCount(), expectedVars);
  });

  it("lowers a grid-only PLOT3D mesh with default sea-level thermodynamic initialization", () => {
    const { grid } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 2, nk: 2, numBlocks: 1 });
    const dae = plot3dToDae(grid, undefined, { maxCellsPerBlock: 3 });

    // 2 global params + 3 cells * 5 vars = 17
    assert.strictEqual(dae.getVarCount(), 17);
    assert.strictEqual(dae.getEqCount(), 17);
  });
});
