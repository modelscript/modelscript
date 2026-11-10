// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateConvectionHeatLoss,
  calculateDynamicLineRating,
  calculateRadiatedHeatLoss,
  calculateSolarHeatGain,
  solveConductorTemperature,
  STANDARD_ACSR_CONDUCTORS,
  type WeatherConditions,
} from "../src/solvers/powerflow/dynamic-line-rating.js";

test("calculateConvectionHeatLoss: evaluates forced and natural convection", () => {
  const drake = STANDARD_ACSR_CONDUCTORS.Drake!;
  const weather: WeatherConditions = {
    ambientTempC: 30.0,
    windSpeedMps: 2.0,
    windAngleDeg: 90.0,
  };

  const qc = calculateConvectionHeatLoss(drake, weather, 75.0);
  assert.ok(qc > 0, `Convection heat loss should be positive, got ${qc}`);

  // Higher wind speed should increase convective cooling
  const highWindWeather: WeatherConditions = { ...weather, windSpeedMps: 8.0 };
  const qcHigh = calculateConvectionHeatLoss(drake, highWindWeather, 75.0);
  assert.ok(qcHigh > qc, "Higher wind speed must increase convective cooling");

  // Zero wind (natural convection) should still yield cooling
  const zeroWindWeather: WeatherConditions = { ...weather, windSpeedMps: 0.0 };
  const qcZero = calculateConvectionHeatLoss(drake, zeroWindWeather, 75.0);
  assert.ok(qcZero > 0, "Natural convection should be positive");
  assert.ok(qcZero < qc, "Natural convection should be less than forced convection");
});

test("calculateRadiatedHeatLoss & calculateSolarHeatGain: Stefan-Boltzmann and solar flux", () => {
  const drake = STANDARD_ACSR_CONDUCTORS.Drake!;
  const qr = calculateRadiatedHeatLoss(drake, 25.0, 75.0);
  assert.ok(qr > 0, `Radiation loss should be positive, got ${qr}`);

  const qs = calculateSolarHeatGain(drake, 1000.0);
  assert.ok(qs > 0, `Solar gain should be positive, got ${qs}`);
  // Drake diameter = 28.1 mm -> projected area = 0.0281 m^2/m -> qs = 0.8 * 1000 * 0.0281 ≈ 22.48 W/m
  assert.ok(Math.abs(qs - 22.48) < 1.0, `Expected ~22.48 W/m, got ${qs}`);
});

test("calculateDynamicLineRating: computes dynamic ampacity uprate in cold windy conditions", () => {
  const drake = STANDARD_ACSR_CONDUCTORS.Drake!;
  // Favorable winter condition: 10°C ambient, 4 m/s wind
  const winterWeather: WeatherConditions = {
    ambientTempC: 10.0,
    windSpeedMps: 4.0,
    windAngleDeg: 90.0,
    solarIrradianceWpm2: 500.0,
  };

  const dlr = calculateDynamicLineRating(drake, winterWeather);
  assert.ok(dlr.ampacityA > 0, "Ampacity should be positive");
  assert.ok(dlr.staticAmpacityA > 0, "Static ampacity should be positive");

  // Dynamic ampacity in winter with 4 m/s wind should be significantly higher than conservative static rating
  assert.ok(
    dlr.ampacityA > dlr.staticAmpacityA,
    `Dynamic ampacity ${dlr.ampacityA}A should exceed static ${dlr.staticAmpacityA}A`,
  );
  assert.ok(dlr.upratePercent > 20.0, `Expected at least 20% uprate, got ${dlr.upratePercent}%`);
});

test("solveConductorTemperature: solves steady-state surface temperature given current", () => {
  const drake = STANDARD_ACSR_CONDUCTORS.Drake!;
  const weather: WeatherConditions = {
    ambientTempC: 25.0,
    windSpeedMps: 1.0,
    windAngleDeg: 90.0,
    solarIrradianceWpm2: 800.0,
  };

  // Moderate load current 600 A
  const temp600 = solveConductorTemperature(drake, weather, 600);
  assert.ok(temp600.conductorTempC > 25.0, "Conductor should be warmer than ambient");
  assert.ok(!temp600.overheated, "Conductor should not overheat at 600A");

  // Heavy overload current 1500 A
  const temp1500 = solveConductorTemperature(drake, weather, 1500);
  assert.ok(temp1500.conductorTempC > temp600.conductorTempC, "Higher current must increase temperature");
  assert.ok(temp1500.overheated, "1500A should overheat Drake conductor (>75°C)");
});
