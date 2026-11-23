// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerScaleToDae } from "../src/dae/scale-to-dae.js";
import { parseScale } from "../src/parser/scale-parser.js";

describe("SCALE / ORIGEN Bateman Depletion Direct DAEBuilder Lowering", () => {
  it("lowers I-135 -> Xe-135 -> Cs-135 decay chain ODEs directly into DAEBuilder", () => {
    const src = `=origen
Iodine Xenon Decay Chain
case(decay) {
  mat { units=atoms iso=[ i135=1.0e16 ] }
  time { units=hours t=[ 1 6 12 24 ] }
  flux=[ 0 0 0 0 ]
}
end
`;
    const deck = parseScale(src);
    const dae = lowerScaleToDae(deck);
    const vars = dae.variables();
    const eqs = dae.equations();

    const varNames = vars.map((v) => v.name);
    assert.ok(varNames.includes("phi"), "Should declare neutron flux parameter phi");
    assert.ok(varNames.includes("N_I_135"), "Should declare state N_I_135");
    assert.ok(varNames.includes("N_Xe_135"), "Should declare daughter state N_Xe_135");
    assert.ok(varNames.includes("N_Cs_135"), "Should declare grand-daughter state N_Cs_135");
    assert.ok(varNames.includes("P_decay"), "Should declare output P_decay");
    assert.ok(varNames.includes("A_total"), "Should declare output A_total");

    // 3 ODEs (I-135, Xe-135, Cs-135) + 2 algebraic equations (P_decay, A_total) = 5 equations
    assert.equal(eqs.length, 5);
  });

  it("lowers U-235 irradiation network with fission products into balanced DAE", () => {
    const src = `=origen
U235 Burnup
case(burn) {
  mat { units=atoms iso=[ u235=1.0e21 u238=2.0e22 ] }
  time { units=days t=[ 30 90 180 ] }
  flux=[ 3.0e13 3.0e13 3.0e13 ]
}
end
`;
    const deck = parseScale(src);
    const dae = lowerScaleToDae(deck);
    const vars = dae.variables();
    const eqs = dae.equations();

    const varNames = vars.map((v) => v.name);
    assert.ok(varNames.includes("N_U_235"));
    assert.ok(varNames.includes("N_U_236"));
    assert.ok(varNames.includes("N_U_238"));
    assert.ok(varNames.includes("N_Pu_239"));
    assert.ok(varNames.includes("N_Cs_137"));
    assert.ok(varNames.includes("N_Sr_90"));
    assert.ok(varNames.includes("N_I_135"));
    assert.ok(varNames.includes("N_Xe_135"));

    // Number of equations must equal number of non-parameter variables (nuclide states + P_decay + A_total)
    const nonParamVars = vars.filter((v) => v.name !== "phi").length;
    assert.equal(eqs.length, nonParamVars);
  });
});
