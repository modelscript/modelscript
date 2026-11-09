// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  computeFsplDb,
  evaluateFresnelClearance,
  lintAntennaPatternDeck,
  lintMicrowaveLink,
  parseNsmaAdf,
  solveMicrowaveLinkBudget,
  type MicrowaveLink,
} from "../src/index.js";

test("RAN microwave propagation solvers, Fresnel clearance, and linter rules", async (t) => {
  await t.test("computes Free Space Path Loss (FSPL) and rain fade budget", () => {
    // 15 km link at 11 GHz
    const fspl = computeFsplDb(11.0, 15.0);
    // Expected: 20*log10(15) + 20*log10(11) + 92.45 = 23.52 + 20.83 + 92.45 = ~136.8 dB
    assert.ok(Math.abs(fspl - 136.8) < 1.0, `Expected ~136.8 dB, got ${fspl}`);

    const link: MicrowaveLink = {
      id: "MW-SITE1-SITE2",
      txSiteName: "Ridge_Tower",
      rxSiteName: "Valley_Substation",
      frequencyGhz: 11.0,
      pathLengthKm: 15.0,
      txPowerDbm: 26.0,
      txAntennaGainDbi: 38.0,
      rxAntennaGainDbi: 38.0,
      txFeederLossDb: 1.5,
      rxFeederLossDb: 1.5,
      requiredMarginDb: 25.0,
      polarization: "V",
    };

    const budget = solveMicrowaveLinkBudget(link);
    assert.ok(budget.receivedPowerDbm > -50.0, "Should have strong received signal");
    assert.ok(budget.fadeMarginDb > 25.0, "Should have sufficient fade margin");
    assert.ok(budget.availabilityPercent >= 99.99, "Should achieve five-nines or near availability");
  });

  await t.test("evaluates Fresnel zone clearance and Earth curvature bulge", () => {
    // 20 km path at 11 GHz with 40m towers
    // Obstacle at midpoint (10 km) with hill height 35m
    const clearance = evaluateFresnelClearance(
      20.0,
      11.0,
      40.0,
      40.0,
      [{ distanceFromTxKm: 10.0, obstacleGroundElevationMeters: 30.0, obstacleHeightMeters: 10.0 }],
      1.333,
    );

    assert.equal(clearance.isObstructed, true, "Hill should obstruct ray when including Earth curvature");
    assert.ok(clearance.minClearanceRatio < 0.6, "Clearance ratio should be below 0.60");
  });

  await t.test("lints microwave links for FCC EIRP ceiling and Fresnel obstruction", () => {
    // High power link violating FCC Part 101 (EIRP > 55 dBm)
    const hotLink: MicrowaveLink = {
      id: "MW-HOT-LINK",
      txSiteName: "Alpha",
      rxSiteName: "Bravo",
      frequencyGhz: 11.0,
      pathLengthKm: 20.0,
      txPowerDbm: 35.0, // 35 dBm
      txAntennaGainDbi: 45.0, // 45 dBi -> EIRP = 80 dBm >> 55 dBm!
      rxAntennaGainDbi: 45.0,
      txFeederLossDb: 0.0,
      rxFeederLossDb: 0.0,
      requiredMarginDb: 20.0,
      polarization: "V",
    };

    const diags = lintMicrowaveLink(hotLink, [
      { distanceFromTxKm: 10.0, obstacleGroundElevationMeters: 60.0, obstacleHeightMeters: 15.0 },
    ]);

    const eirpDiag = diags.find((d) => d.code === 2003);
    assert.ok(eirpDiag, "Should trigger R2003 FCC EIRP limit exceeded");
    assert.equal(eirpDiag.severity, "error");

    const fresnelDiag = diags.find((d) => d.code === 2001);
    assert.ok(fresnelDiag, "Should trigger R2001 Fresnel zone obstruction");
    assert.equal(fresnelDiag.severity, "error");
  });

  await t.test("lints antenna patterns for abnormal electrical downtilt", () => {
    const rawPattern = `REVNUM: 1.01\nPATTYP: H\nMODEL: TILT-ERR\nGAIN: 15.0\nDTILTE: 25.0\n`;
    const deck = parseNsmaAdf(rawPattern, "tilt.adf");

    const diags = lintAntennaPatternDeck(deck);
    const tiltDiag = diags.find((d) => d.code === 2005);
    assert.ok(tiltDiag, "Should trigger R2005 antenna-downtilt-out-of-bounds");
    assert.equal(tiltDiag.severity, "warning");
  });
});
