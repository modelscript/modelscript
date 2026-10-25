// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateCrankSliderKinematics,
  calculateGasProperties,
  calculateWoschniHeatTransfer,
  calculateZeldovichNoxRate,
  evaluateBurnRate,
  evaluateLivengoodWuKnock,
  getFuelProperties,
} from "../src/index.js";

describe("@modelscript/gtsuite Thermo & Combustion Suite", () => {
  it("calculates crank-slider kinematics accurately", () => {
    const bore = 0.0825;
    const stroke = 0.0928;
    const rod = 0.144;
    const cr = 10.0;
    const rpm = 3000.0;

    // At TDC (crankAngle = 0), volume should equal clearance volume
    const tdc = calculateCrankSliderKinematics(0.0, bore, stroke, rod, cr, rpm);
    const disp = (Math.PI / 4) * bore * bore * stroke;
    const vClearance = disp / (cr - 1.0);
    assert.ok(Math.abs(tdc.volumeM3 - vClearance) < 1e-7);
    assert.ok(Math.abs(tdc.pistonVelocityMS) < 1e-4);

    // At BDC (crankAngle = 180), volume should equal clearance + displacement
    const bdc = calculateCrankSliderKinematics(180.0, bore, stroke, rod, cr, rpm);
    assert.ok(Math.abs(bdc.volumeM3 - (vClearance + disp)) < 1e-6);

    // Mean piston speed check: 2 * S * N / 60
    assert.strictEqual(tdc.meanPistonSpeedMS, (2.0 * stroke * rpm) / 60.0);
  });

  it("evaluates Wiebe burn profiles correctly", () => {
    const config = {
      type: "wiebe" as const,
      anchorAngleDeg: 10.0,
      durationDeg: 40.0,
      wiebeExponentM: 2.0,
      wiebeEfficiencyA: 5.0,
    };

    // Before anchor: mfb = 0
    const before = evaluateBurnRate(5.0, config);
    assert.strictEqual(before.mfb, 0.0);
    assert.strictEqual(before.burnRatePerDeg, 0.0);

    // Mid combustion (e.g. 30 deg): mfb between 0.3 and 0.8
    const mid = evaluateBurnRate(30.0, config);
    assert.ok(mid.mfb > 0.3 && mid.mfb < 0.9);
    assert.ok(mid.burnRatePerDeg > 0.0);

    // After duration: mfb = 1.0
    const after = evaluateBurnRate(55.0, config);
    assert.strictEqual(after.mfb, 1.0);
  });

  it("calculates Woschni convective heat transfer coefficient", () => {
    const res = calculateWoschniHeatTransfer(
      0.0825,
      60e5, // 60 bar
      2200.0, // 2200 K
      9.28, // 9.28 m/s
      0.0005,
      true, // combustion phase
      40e5, // 40 bar pressure rise
    );

    assert.ok(res.heatTransferCoeffWPerM2K > 500.0);
    assert.ok(res.heatFluxWPerM2 > 1e5);
    assert.ok(res.totalHeatLossW > 0.0);
  });

  it("computes Zeldovich thermal NOx and Livengood-Wu knock", () => {
    // High temperature combustion zone
    const nox = calculateZeldovichNoxRate(2400.0, 70e5, 0.95, 1.0);
    assert.ok(nox.noxPpm > 10.0);

    // Knock integral accumulation
    const knock = evaluateLivengoodWuKnock(900.0, 50e5, 0.001, 0.2, 95.0);
    assert.ok(knock.currentIntegral > 0.2);
    assert.strictEqual(typeof knock.knockDetected, "boolean");
  });

  it("provides fuel thermodynamic properties", () => {
    const gas = getFuelProperties("Gasoline");
    assert.strictEqual(gas.stoichiometricAfr, 14.7);
    assert.strictEqual(gas.lowerHeatingValueJPerKg, 44.0e6);

    const props = calculateGasProperties(1000.0, 0.5);
    assert.ok(props.gamma > 1.25 && props.gamma < 1.4);
    assert.ok(props.speedOfSoundMS > 550.0);
  });
});
