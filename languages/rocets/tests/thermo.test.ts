// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateBartzHeatTransfer,
  DEFAULT_PUMP_MAP,
  DEFAULT_TURBINE_MAP,
  evaluateCombustionCEA,
  evaluateNozzlePerformance,
  getFluidProperties,
  interpolatePerformanceMap,
} from "../src/index.js";

describe("@modelscript/rocets Thermodynamics & Fluids Suite", () => {
  it("provides thermodynamic properties for cryogens and hydrocarbons", () => {
    const lox = getFluidProperties("LOX");
    assert.strictEqual(lox.name, "LOX");
    assert.strictEqual(lox.densityKgM3, 1141.0);
    assert.ok(lox.normalBoilingPointK > 85.0 && lox.normalBoilingPointK < 95.0);

    const lh2 = getFluidProperties("LH2");
    assert.strictEqual(lh2.densityKgM3, 70.85);

    const rp1 = getFluidProperties("RP1");
    assert.strictEqual(rp1.densityKgM3, 810.0);
  });

  it("computes CEA equilibrium combustion results", () => {
    const cea = evaluateCombustionCEA("LOX", "LH2", 10.0e6, 6.0);
    assert.ok(cea.tcK > 3000.0 && cea.tcK < 3800.0, `Combustion temp ${cea.tcK} K expected in 3000-3800 K range`);
    assert.ok(cea.cstar > 2000.0 && cea.cstar < 2500.0, `c* ${cea.cstar} m/s expected in 2000-2500 range`);
    assert.ok(cea.gamma > 1.15 && cea.gamma < 1.3);
  });

  it("calculates supersonic nozzle expansion gas dynamics", () => {
    const nozzle = evaluateNozzlePerformance(10.0e6, 0.05, 50.0, 1.22, 3400.0, 0.015);
    assert.ok(nozzle.exitMach > 3.0, `Exit Mach ${nozzle.exitMach} should be supersonic`);
    assert.ok(nozzle.exitVelocityMs > 3500.0, `Exit velocity ${nozzle.exitVelocityMs} m/s`);
    assert.ok(nozzle.exitPressurePa < 101325.0, `Exit pressure ${nozzle.exitPressurePa} Pa`);
  });

  it("calculates Bartz throat heat transfer coefficient", () => {
    const hg = calculateBartzHeatTransfer(10.0e6, 2300.0, 0.25, 0.15, 3400.0, 1.22);
    assert.ok(hg > 2000.0 && hg < 50000.0, `Bartz coefficient ${hg} W/(m^2 K)`);
  });

  it("interpolates turbomachinery performance maps", () => {
    const pt = interpolatePerformanceMap(DEFAULT_PUMP_MAP, 30000, 25);
    assert.ok(pt.headOrPr > 1000.0);
    assert.ok(pt.efficiency > 0.65 && pt.efficiency < 0.85);

    const turbPt = interpolatePerformanceMap(DEFAULT_TURBINE_MAP, 30000, 25);
    assert.ok(turbPt.headOrPr > 1.0);
    assert.ok(turbPt.efficiency > 0.6);
  });
});
