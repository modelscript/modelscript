// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateReferenceEndf6Tape } from "../src/catalog/reference-tapes.js";
import { lowerEndf6ToDae } from "../src/dae/endf6-to-dae.js";
import { parseEndf6Tape } from "../src/parser/tape-parser.js";
import { DEFAULT_FOUR_GROUP_BOUNDS } from "../src/solver/multigroup.js";

describe("ENDF-6 Direct Linear-Memory DAEBuilder Lowering", () => {
  it("lowers U-235 ENDF-6 tape to 2-group neutron balance, reaction rates, and decay ODEs", () => {
    const tape = parseEndf6Tape(generateReferenceEndf6Tape("U-235"));
    const dae = lowerEndf6ToDae(tape);

    const varNames: string[] = [];
    for (let i = 0; i < dae.varCount; i++) {
      varNames.push(dae.getVarName(i));
    }

    // 2 group fluxes + 2*3 reaction rates (total, capture, fission) + 1 decay nuclide = 9 vars & 9 eqs
    assert.equal(dae.varCount, 9, `Expected 9 DAE variables, got ${dae.varCount}`);
    assert.equal(dae.eqCount, 9, `Expected 9 DAE equations, got ${dae.eqCount}`);
    assert.ok(varNames.includes("phi_g1"), "Expected group-1 neutron flux variable");
    assert.ok(varNames.includes("phi_g2"), "Expected group-2 neutron flux variable");
    assert.ok(varNames.includes("R_total_mat9228_g1"), "Expected total reaction rate variable");
    assert.ok(varNames.includes("R_capture_mat9228_g1"), "Expected capture reaction rate variable");
    assert.ok(varNames.includes("R_fission_mat9228_g1"), "Expected fission reaction rate variable");
    assert.ok(varNames.includes("N_decay_mat9228"), "Expected MF=8 radioactive decay state variable");
  });

  it("supports custom 4-group energy boundaries", () => {
    const tape = parseEndf6Tape(generateReferenceEndf6Tape("B-10"));
    const dae = lowerEndf6ToDae(tape, { groupBounds: DEFAULT_FOUR_GROUP_BOUNDS });

    const varNames: string[] = [];
    for (let i = 0; i < dae.varCount; i++) {
      varNames.push(dae.getVarName(i));
    }

    // 4 group fluxes + 4*3 reaction rates = 16 vars & 16 eqs (B-10 is stable -> no decay ODE)
    assert.equal(dae.varCount, 16);
    assert.equal(dae.eqCount, 16);
    assert.ok(varNames.includes("phi_g1"));
    assert.ok(varNames.includes("phi_g4"));
    assert.ok(varNames.includes("R_capture_mat525_g4"));
    assert.ok(!varNames.includes("N_decay_mat525"));
  });
});
