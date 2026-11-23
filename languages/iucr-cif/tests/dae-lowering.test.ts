// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_CIF_TEMPLATES } from "../src/catalog/iucr-cif-std-schemas.js";
import { cifToDae } from "../src/dae/index.js";

describe("IUCr CIF DAE Arena Lowering", () => {
  it("lowers Silicon unit-cell metric tensor, volume, density, and Bragg equations into DAEBuilder", () => {
    const { builder, result } = cifToDae(CANONICAL_CIF_TEMPLATES.silicon);

    assert.ok(result.variableCount >= 18, `Expected >= 18 DAE variables, got ${result.variableCount}`);
    assert.ok(result.equationCount >= 10, `Expected >= 10 DAE equations, got ${result.equationCount}`);

    // Verify key variables exist in the linear-memory DAE arena
    assert.ok(builder.lookupVariable("cell_a") !== -1);
    assert.ok(builder.lookupVariable("G_11") !== -1);
    assert.ok(builder.lookupVariable("det_G") !== -1);
    assert.ok(builder.lookupVariable("cell_volume") !== -1);
    assert.ok(builder.lookupVariable("crystal_density") !== -1);
    assert.ok(builder.lookupVariable("xrd_lambda") !== -1);
    assert.ok(builder.lookupVariable("bragg_d_1_1_1") !== -1);
    assert.ok(builder.lookupVariable("bragg_sin_theta_1_1_1") !== -1);

    // Check computed solution consistency
    const expectedVol = Math.pow(5.431, 3);
    assert.ok(Math.abs(result.solution.metric.volume - expectedVol) < 1e-6);
  });
});
