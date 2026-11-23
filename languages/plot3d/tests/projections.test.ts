// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plot3dToModelica, plot3dToOpenFoamBlockMesh, plot3dToVtkStructuredGrid } from "../src/projections/index.js";
import { generateIsentropicNozzlePlot3d } from "../src/solver/nozzle.js";

describe("PLOT3D Polyglot Projections (VTK, OpenFOAM, Modelica)", () => {
  it("projects PLOT3D grid + solution to VTK Legacy ASCII STRUCTURED_GRID", () => {
    const { grid, solution } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 3, nk: 3, numBlocks: 1 });
    const vtk = plot3dToVtkStructuredGrid(grid, solution, { title: "Nozzle VTK Test" });

    assert.ok(vtk.includes("# vtk DataFile Version 3.0"));
    assert.ok(vtk.includes("DATASET STRUCTURED_GRID"));
    assert.ok(vtk.includes("DIMENSIONS 5 3 3"));
    assert.ok(vtk.includes("POINTS 45 double"));
    assert.ok(vtk.includes("POINT_DATA 45"));
    assert.ok(vtk.includes("SCALARS density double 1"));
    assert.ok(vtk.includes("SCALARS pressure double 1"));
    assert.ok(vtk.includes("SCALARS mach double 1"));
    assert.ok(vtk.includes("VECTORS velocity double"));
  });

  it("projects multi-block PLOT3D grid to OpenFOAM blockMeshDict", () => {
    const { grid } = generateIsentropicNozzlePlot3d({ ni: 7, nj: 3, nk: 3, numBlocks: 2 });
    const dict = plot3dToOpenFoamBlockMesh(grid);

    assert.ok(dict.includes("FoamFile"));
    assert.ok(dict.includes("object      blockMeshDict;"));
    assert.ok(dict.includes("vertices"));
    assert.ok(dict.includes("blocks"));
    assert.ok(dict.includes("hex (0 1 2 3 4 5 6 7)"));
    assert.ok(dict.includes("hex (8 9 10 11 12 13 14 15)"));
    assert.ok(dict.includes("boundary"));
    assert.ok(dict.includes("inlet"));
    assert.ok(dict.includes("outlet"));
  });

  it("projects PLOT3D grid + solution to Modelica Euler conservation model", () => {
    const { grid, solution } = generateIsentropicNozzlePlot3d({ ni: 7, nj: 2, nk: 2, numBlocks: 1 });
    const mo = plot3dToModelica(grid, solution, { modelName: "NozzleEuler", maxCellsPerBlock: 3 });

    assert.ok(mo.includes("model NozzleEuler"));
    assert.ok(mo.includes("parameter Real gamma = 1.4"));
    assert.ok(mo.includes("der(b0_c0_rho)"));
    assert.ok(mo.includes("der(b0_c0_rhou)"));
    assert.ok(mo.includes("der(b0_c0_E)"));
    assert.ok(mo.includes("end NozzleEuler;"));
  });
});
