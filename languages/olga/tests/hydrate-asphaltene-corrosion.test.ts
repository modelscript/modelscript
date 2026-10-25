// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  calculateHydrateKinetics,
  classifyAsphalteneStability,
  computeColloidalInstabilityIndex,
  evaluateAsphalteneRisk,
  evaluateCorrosionIntegrity,
} from "../src/index.js";

test("OLGA Advanced Physics: Hydrate Kinetics, Asphaltenes, and Corrosion", async (t) => {
  await t.test("1. Hydrate Slurry Formation Kinetics & Camargo-Mills Rheology", () => {
    // 100 bar, 4 C (277.15 K) deepwater seabed line -> strong subcooling
    const resultSubcooled = calculateHydrateKinetics({
      pressurePa: 100e5,
      temperatureK: 277.15,
      waterVolumeFraction: 0.15,
      mixtureVelocity: 1.5,
      pipeDiameter: 0.3,
      timeStepSeconds: 300, // 5 minutes
      liquidViscosity: 0.002,
    });

    assert.ok(resultSubcooled.isForming, "Hydrate crystals should form under 100 bar / 4 C");
    assert.ok(resultSubcooled.subcoolingK > 10.0, "Subcooling driving force should be > 10 K");
    assert.ok(resultSubcooled.massRateKgPerM3S > 0, "Hydrate mass generation rate should be positive");
    assert.ok(resultSubcooled.hydrateVolumeFraction > 0, "Hydrate volume fraction should be positive");
    assert.ok(resultSubcooled.slurryViscosityPaS > 0.002, "Slurry apparent viscosity must exceed base viscosity");
    assert.ok(resultSubcooled.relativeViscosity > 1.0, "Relative viscosity must exceed 1.0");

    // With 35 wt% MEG inhibitor -> subcooling suppressed, no hydrate formation
    const resultInhibited = calculateHydrateKinetics({
      pressurePa: 100e5,
      temperatureK: 277.15,
      waterVolumeFraction: 0.15,
      mixtureVelocity: 1.5,
      pipeDiameter: 0.3,
      timeStepSeconds: 300,
      liquidViscosity: 0.002,
      inhibitorWeightFraction: 0.35,
    });

    assert.equal(resultInhibited.isForming, false, "35 wt% MEG should inhibit hydrate crystal growth");
    assert.equal(resultInhibited.hydrateVolumeFraction, 0.0, "Zero hydrate formation when properly inhibited");
    assert.ok(resultInhibited.pluggingRiskIndex < 0.2, "Plugging risk should be low with chemical inhibitor");
  });

  await t.test("2. Asphaltene De Boer CII & AOP Envelope Deposition", () => {
    // Unstable high-saturates crude: 60% Saturates, 20% Aromatics, 12% Resins, 8% Asphaltenes
    const unstableSara = {
      saturatesPercent: 60.0,
      aromaticsPercent: 20.0,
      resinsPercent: 12.0,
      asphaltenesPercent: 8.0,
    };

    const ciiUnstable = computeColloidalInstabilityIndex(unstableSara);
    assert.ok(ciiUnstable > 0.9, `CII should be > 0.9 for unstable crude, got ${ciiUnstable}`);
    assert.equal(classifyAsphalteneStability(ciiUnstable), "UNSTABLE");

    // Stable light crude: 35% Saturates, 45% Aromatics, 18% Resins, 2% Asphaltenes
    const stableSara = {
      saturatesPercent: 35.0,
      aromaticsPercent: 45.0,
      resinsPercent: 18.0,
      asphaltenesPercent: 2.0,
    };
    const ciiStable = computeColloidalInstabilityIndex(stableSara);
    assert.ok(ciiStable < 0.7, `CII should be < 0.7 for stable crude, got ${ciiStable}`);
    assert.equal(classifyAsphalteneStability(ciiStable), "STABLE");

    // Test deposition in AOP envelope
    const asphEval = evaluateAsphalteneRisk({
      sara: unstableSara,
      operatingPressurePa: 160e5, // In between bubble point 120 bar and upper AOP 200 bar
      operatingTemperatureK: 340.15,
      bubblePointPressurePa: 120e5,
      mixtureVelocity: 1.2,
      pipeDiameter: 0.25,
      exposureTimeHours: 720, // 30 days
    });

    assert.ok(asphEval.isInPrecipitationEnvelope, "Should detect operation within AOP precipitation envelope");
    assert.ok(asphEval.depositionRateUmPerHour > 0, "Deposition rate should be positive");
    assert.ok(asphEval.accumulatedThicknessMm > 0, "Accumulated deposit thickness should be positive");
    assert.ok(asphEval.hydraulicPenaltyFactor > 1.0, "Hydraulic resistance penalty should increase");
    assert.ok(asphEval.mitigationRecommendation.includes("CRITICAL"), "Recommendation should flag critical mitigation");
  });

  await t.test("3. Sweet CO2 Corrosion (De Waard & Milliams, NORSOK M-506, ASME B31G)", () => {
    // 80 bar total, 5% CO2 (P_CO2 = 4 bar), 65 C, 12" pipe (0.3048m), 19.1mm wall, 3mm allowance, 25 years
    const corrosionResult = evaluateCorrosionIntegrity({
      operatingPressurePa: 80e5,
      operatingTemperatureK: 338.15, // 65 C -> siderite scale active
      co2MoleFraction: 0.05,
      pH: 5.2,
      mixtureVelocity: 2.0,
      pipeDiameterM: 0.3048,
      nominalWallThicknessMm: 19.1,
      corrosionAllowanceMm: 3.0,
      designServiceLifeYears: 25,
      inhibitorEfficiencyPercent: 97.0, // 97% high-reliability continuous chemical inhibitor
      steelGradeSmysMpa: 450.0, // X65
    });

    assert.ok(corrosionResult.co2PartialPressureBar > 3.9 && corrosionResult.co2PartialPressureBar < 4.1);
    assert.ok(
      corrosionResult.unmitigatedCorrosionRateMmPerYear > 2.0,
      "Unmitigated corrosion rate should be > 2 mm/yr",
    );
    assert.ok(corrosionResult.protectiveScaleFactor < 0.5, "FeCO3 scale should offer protection at 65 C");
    assert.ok(
      corrosionResult.effectiveCorrosionRateMmPerYear < 0.2,
      "Mitigated rate with 95% inhibitor should be < 0.2 mm/yr",
    );
    assert.ok(
      corrosionResult.cumulativeMetalLossMm < 3.0,
      "Cumulative 25-yr metal loss should stay within 3mm allowance",
    );
    assert.ok(corrosionResult.isIntegrityMaintained, "Structural integrity must be maintained");
    assert.ok(corrosionResult.deratedMaopBar > 80.0, "Derated MAOP must remain comfortably above operating pressure");
  });
});
