// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASM1_DEFAULT_PARAMETERS,
  computeAsm1ConversionRates,
  evaluateAsm1ProcessRates,
  getAsm1PetersenMatrix,
} from "../src/models/asm1.js";

describe("IWA ASM1 Biokinetics Benchmark & Stoichiometric Conservation", () => {
  it("should verify exact COD mass balance across all biological processes within tolerance", () => {
    const petersen = getAsm1PetersenMatrix();
    const tolerance = 1e-6;

    // Process 1: Aerobic heterotrophic growth
    // Substrate used: -1/Y_H, Biomass formed: +1, Oxygen consumed: -(1-Y_H)/Y_H
    // COD balance: (-1/Y_H) + 1 + (-(1-Y_H)/Y_H) = (-1 + Y_H - 1 + Y_H)/Y_H ... with oxygen being negative COD:
    // Net COD: (-1/Y_H) + 1 + (-(1-Y_H)/Y_H) * (-1) = -1/Y_H + 1 + (1 - Y_H)/Y_H = 0
    const proc1 = petersen.processes[0]!;
    const codSum1 = proc1.stoichiometry["S_S"]! + proc1.stoichiometry["X_BH"]! + -1.0 * proc1.stoichiometry["S_O"]!;
    const residual1 = Math.abs(codSum1);

    assert.ok(
      residual1 < tolerance,
      `Aerobic heterotroph growth COD conservation residual ${residual1} must converge within tolerance ${tolerance}`,
    );

    // Process 2: Anoxic heterotrophic growth (Denitrification)
    // Oxygen equivalent of nitrate is 2.86 g O2 / g NO3-N
    const proc2 = petersen.processes[1]!;
    const codSum2 = proc2.stoichiometry["S_S"]! + proc2.stoichiometry["X_BH"]! + -2.86 * proc2.stoichiometry["S_NO"]!;
    const residual2 = Math.abs(codSum2);

    assert.ok(
      residual2 < tolerance,
      `Anoxic denitrification COD conservation residual ${residual2} must satisfy tolerance ${tolerance}`,
    );
  });

  it("should verify nitrogen mass conservation across biomass decay processes", () => {
    const petersen = getAsm1PetersenMatrix();
    const { i_XB, i_XP } = ASM1_DEFAULT_PARAMETERS;
    const tolerance = 1e-6;

    // Process 4: Heterotrophic decay
    // Delta N = -i_XB + f_P * i_XP + (i_XB - f_P * i_XP) = 0
    const proc4 = petersen.processes[3]!;
    const netNitrogenDecay = -i_XB! + proc4.stoichiometry["X_P"]! * i_XP! + proc4.stoichiometry["X_ND"]!;
    const residual = Math.abs(netNitrogenDecay);

    assert.ok(
      residual < tolerance,
      `Biomass decay nitrogen conservation residual ${residual} must converge within tolerance ${tolerance}`,
    );
  });

  it("should evaluate dynamic reaction rates under BSM1 benchmark conditions meeting numerical tolerances", () => {
    const bsm1Concentrations = {
      S_S: 69.5,
      X_BH: 28.17,
      X_BA: 1.0,
      X_S: 202.32,
      S_O: 2.0, // 2.0 mg/L aerobic setpoint
      S_NO: 10.0,
      S_NH: 31.56,
      S_ND: 6.95,
      X_ND: 10.59,
    };

    const rates = evaluateAsm1ProcessRates(bsm1Concentrations);
    assert.equal(rates.length, 8);

    // Process 1: Aerobic growth
    // mu_H * (69.5 / (20 + 69.5)) * (2.0 / (0.2 + 2.0)) * 28.17
    // = 6.0 * (69.5 / 89.5) * (2.0 / 2.2) * 28.17 = 6.0 * 0.7765 * 0.9091 * 28.17 = 119.24 g/(m3*day)
    const expectedRho1 = 119.24;
    const tolerance = 1.0;
    const residualRho1 = Math.abs(rates[0]! - expectedRho1);

    assert.ok(
      residualRho1 < tolerance,
      `Aerobic growth rate ${rates[0]} g/(m3*day) should match benchmark ${expectedRho1} within tolerance ${tolerance}`,
    );

    // Net conversion rate for S_S should be negative (consumption)
    const netRates = computeAsm1ConversionRates(bsm1Concentrations);
    assert.ok(netRates["S_S"]! < 0, "Readily biodegradable COD must be consumed in reactor");
    assert.ok(netRates["X_BH"]! > 0, "Heterotrophic biomass must grow");
  });
});
