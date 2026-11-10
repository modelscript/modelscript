// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCableAmpacity,
  sizeCableCrossSection,
  type CableInstallationConditions,
  type CableSpecification,
} from "../src/solvers/cables/cable-sizing.js";

test("calculateCableAmpacity: IEC 60287 single-core 132 kV XLPE cable buried direct in trefoil", () => {
  const cable: CableSpecification = {
    nominalVoltageKv: 132,
    conductorMaterial: "copper",
    crossSectionMm2: 630,
    insulationMaterial: "xlpe",
    insulationThicknessMm: 15.0,
    sheathThicknessMm: 2.0,
    jacketThicknessMm: 4.0,
    numberOfCores: 1,
    sheathBonding: "cross_bonded",
    operatingFrequencyHz: 50,
  };

  const installation: CableInstallationConditions = {
    medium: "buried_direct",
    formation: "trefoil",
    burialDepthM: 1.0,
    soilThermalResistivityKmPerW: 1.0,
    ambientTemperatureC: 20.0,
    maxConductorTemperatureC: 90.0,
  };

  const result = calculateCableAmpacity(cable, installation);

  // Typical 132 kV 630 mm2 Cu XLPE cable ampacity in ground is between 800 A and 1100 A
  assert.ok(
    result.continuousAmpacityA > 750 && result.continuousAmpacityA < 1200,
    `Ampacity should be in realistic range [750, 1200] A, got ${result.continuousAmpacityA} A`,
  );

  // Rated MVA capacity sqrt(3) * 132 * I / 1000
  assert.ok(
    result.ratedPowerMva > 150 && result.ratedPowerMva < 280,
    `Rated power capacity should be realistic, got ${result.ratedPowerMva} MVA`,
  );

  // AC resistance must be slightly higher than DC resistance due to skin and proximity effects
  assert.ok(
    result.rAcOhmPerKm >= result.rDcOhmPerKm,
    `AC resistance (${result.rAcOhmPerKm}) must be >= DC resistance (${result.rDcOhmPerKm})`,
  );

  // Dielectric loss for 132 kV XLPE should be positive and small (< 5 W/m)
  assert.ok(
    result.dielectricLossWPerM > 0 && result.dielectricLossWPerM < 5.0,
    `Dielectric loss should be positive and reasonable, got ${result.dielectricLossWPerM} W/m`,
  );

  // Thermal resistances T1 and T4 should be positive
  assert.ok(result.thermalResistances.t1 > 0, "T1 must be positive");
  assert.ok(result.thermalResistances.t4 > 0, "T4 must be positive");

  // IEC 60949 1s short-circuit withstand for 630 mm2 Cu XLPE: 143 * 630 / 1000 ≈ 90.1 kA
  assert.ok(
    Math.abs(result.shortCircuitWithstandCurrentKa - 90.1) < 0.5,
    `Short circuit withstand should be ~90.1 kA, got ${result.shortCircuitWithstandCurrentKa}`,
  );
});

test("calculateCableAmpacity: solid bonding vs cross-bonding sheath losses", () => {
  const baseCable: CableSpecification = {
    nominalVoltageKv: 220,
    conductorMaterial: "copper",
    crossSectionMm2: 800,
    insulationMaterial: "xlpe",
    insulationThicknessMm: 21.0,
    numberOfCores: 1,
    sheathBonding: "both_ends",
  };

  const installation: CableInstallationConditions = {
    medium: "buried_direct",
    formation: "flat_spaced",
    axialSpacingMm: 300,
    burialDepthM: 1.2,
    soilThermalResistivityKmPerW: 1.0,
    ambientTemperatureC: 20.0,
  };

  const resSolid = calculateCableAmpacity(baseCable, installation);
  const resCross = calculateCableAmpacity({ ...baseCable, sheathBonding: "cross_bonded" }, installation);

  // Sheath circulating losses in solid bonding must be greater than eddy losses in cross-bonding
  assert.ok(
    resSolid.sheathLossFactorLambda1 > resCross.sheathLossFactorLambda1,
    `Solid bonding sheath loss (${resSolid.sheathLossFactorLambda1}) must exceed cross-bonded (${resCross.sheathLossFactorLambda1})`,
  );

  // Eliminating circulating currents with cross-bonding increases continuous ampacity
  assert.ok(
    resCross.continuousAmpacityA > resSolid.continuousAmpacityA,
    `Cross-bonding ampacity (${resCross.continuousAmpacityA}) must exceed solid-bonded (${resSolid.continuousAmpacityA})`,
  );
});

test("calculateCableAmpacity: soil thermal resistivity derating", () => {
  const cable: CableSpecification = {
    nominalVoltageKv: 33,
    conductorMaterial: "aluminum",
    crossSectionMm2: 400,
    insulationMaterial: "xlpe",
    insulationThicknessMm: 8.0,
    numberOfCores: 1,
    sheathBonding: "both_ends",
  };

  const instMoist: CableInstallationConditions = {
    medium: "buried_direct",
    formation: "trefoil",
    burialDepthM: 1.0,
    soilThermalResistivityKmPerW: 0.8, // Moist soil
    ambientTemperatureC: 20.0,
  };

  const instDry: CableInstallationConditions = {
    ...instMoist,
    soilThermalResistivityKmPerW: 2.5, // Dry sandy soil
  };

  const resMoist = calculateCableAmpacity(cable, instMoist);
  const resDry = calculateCableAmpacity(cable, instDry);

  // Dry soil has higher thermal resistance T4 and thus lower ampacity
  assert.ok(
    resDry.thermalResistances.t4 > resMoist.thermalResistances.t4,
    "Dry soil must have higher thermal resistance T4",
  );
  assert.ok(resDry.continuousAmpacityA < resMoist.continuousAmpacityA, "Dry soil must derate continuous ampacity");
});

test("sizeCableCrossSection: selects minimal standard cable size meeting target current", () => {
  const cableBase: Omit<CableSpecification, "crossSectionMm2"> = {
    nominalVoltageKv: 33,
    conductorMaterial: "copper",
    insulationMaterial: "xlpe",
    insulationThicknessMm: 8.0,
    numberOfCores: 1,
    sheathBonding: "both_ends",
  };

  const installation: CableInstallationConditions = {
    medium: "duct_bank",
    formation: "trefoil",
    burialDepthM: 1.0,
    soilThermalResistivityKmPerW: 1.2,
    ambientTemperatureC: 25.0,
  };

  const targetCurrentA = 600;
  const sized = sizeCableCrossSection(targetCurrentA, cableBase, installation);

  assert.ok(
    sized.ampacityA >= targetCurrentA,
    `Sized ampacity ${sized.ampacityA} A must be >= target ${targetCurrentA} A`,
  );
  assert.ok(sized.loadingPct <= 100, `Loading ${sized.loadingPct}% must be <= 100%`);
  assert.ok(
    [185, 240, 300, 400, 500, 630].includes(sized.recommendedCrossSectionMm2),
    `Recommended cross-section ${sized.recommendedCrossSectionMm2} mm2 must be a realistic standard size`,
  );
});
