// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { loadCfgToLbm } from "../src/cfd/index.js";
import { loadInpToFea } from "../src/fea/index.js";

describe("FEA and CFD Solver Ingestion (.inp / .cfg / .inpt / .cfgt)", () => {
  it("ingests a parametric .inpt deck directly into in-WASM FeaSolver and steps physics", () => {
    const deck = `*HEADING
In-WASM Beam FEA Test
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.0, 1.0, 0.0
4, 0.0, 0.0, 1.0
*ELEMENT, TYPE=C3D4, ELSET=PART1
1, 1, 2, 3, 4
*MATERIAL, NAME={{ Model.matName }}
*ELASTIC
 {{ Model.youngsModulus }}, {{ Model.poissonsRatio }}
*BOUNDARY
 1, 1, 3
*CLOAD
 2, 2, {{ Model.thrustForce }}
`;

    const parameters = {
      "Model.matName": "ALUMINUM",
      "Model.youngsModulus": 70e9,
      "Model.poissonsRatio": 0.33,
      "Model.thrustForce": -150.0,
    };

    const { mesh, material, bcs, solver } = loadInpToFea(deck, { evaluator: parameters });

    assert.strictEqual(mesh.numNodes, 4);
    assert.strictEqual(mesh.numElements, 1);
    assert.strictEqual(material.E, 70e9);
    assert.strictEqual(material.nu, 0.33);
    assert.ok(bcs.fixedNodes.has(0)); // node 1 is index 0
    assert.deepStrictEqual(bcs.nodalLoads.get(1), [0, -150, 0]); // node 2 is index 1

    // Step physics with FeaSolver
    const result = solver.step(bcs);

    assert.ok(result.maxDisplacement > 0, "Displacement should be greater than zero");
    assert.ok(result.maxVonMisesStress > 0, "Von Mises stress should be greater than zero");
    assert.strictEqual(result.displacements.length, 12); // 4 nodes * 3 DOF
  });

  it("ingests a parametric .cfgt config directly into in-WASM WebGPU LbmGridConfig", () => {
    const config = `% SU2 CFD Config for AeroStudy
MATH_PROBLEM= NAVIER_STOKES
FREESTREAM_VELOCITY= ( {{ Aero.vCruise }}, 0.0, 0.0 )
FREESTREAM_DENSITY= {{ Atmo.density }}
FREESTREAM_VISCOSITY= 1.8e-5
MARKER_INLET= ( inlet_patch, {{ Aero.vCruise }}, 1.0, 0.0, 0.0 )
MARKER_HEATFLUX= ( body_surface, 0.0 )
`;

    const parameters = {
      "Aero.vCruise": 22.5,
      "Atmo.density": 1.225,
    };

    const lbmConfig = loadCfgToLbm(config, {
      evaluator: parameters,
      nx: 128,
      ny: 64,
      nz: 64,
      domainSizeMeters: [1.0, 0.5, 0.5],
    });

    assert.strictEqual(lbmConfig.nx, 128);
    assert.strictEqual(lbmConfig.ny, 64);
    assert.strictEqual(lbmConfig.density, 1.225);
    assert.deepStrictEqual(lbmConfig.inletVelocity, [22.5, 0, 0]);
    assert.ok(lbmConfig.dx > 0);
    assert.ok(lbmConfig.dt > 0);
    assert.ok(lbmConfig.tau > 0.5, "LBM relaxation time must be > 0.5 for stability");
  });
});
