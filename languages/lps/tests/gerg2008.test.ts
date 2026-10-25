// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { Gerg2008Eos } from "../src/solver/eos/gerg2008.js";
import type { GasComposition } from "../src/types.js";

const baselineGas: GasComposition = {
  methane: 0.94,
  ethane: 0.035,
  propane: 0.01,
  nitrogen: 0.005,
  carbonDioxide: 0.01,
};

test("GERG-2008: Evaluates natural gas thermophysical properties at transmission conditions", () => {
  const pPa = 60.0e5; // 60 bar
  const tK = 293.15; // 20 °C

  const res = Gerg2008Eos.evaluate(pPa, tK, baselineGas);

  // Natural gas Z factor at 60 bar, 20 C is typically ~ 0.86 - 0.89
  assert.ok(res.zFactor > 0.8 && res.zFactor < 0.95, `Z factor ${res.zFactor} in natural gas range`);
  // Density at 60 bar ~ 40 - 55 kg/m3
  assert.ok(res.massDensityKgM3 > 35.0 && res.massDensityKgM3 < 60.0, `Density ${res.massDensityKgM3} kg/m3 realistic`);
  // Speed of sound in natural gas ~ 390 - 440 m/s
  assert.ok(res.speedOfSoundMS > 350.0 && res.speedOfSoundMS < 480.0, `Sound speed ${res.speedOfSoundMS} m/s`);
  // Isobaric heat capacity > isochoric heat capacity
  assert.ok(res.isobaricHeatCapacityJouleMolK > res.isochoricHeatCapacityJouleMolK, "Cp > Cv");
  // Joule-Thomson cooling on expansion (positive coefficient)
  assert.ok(
    res.jouleThomsonCoeffKBar > 0.1 && res.jouleThomsonCoeffKBar < 0.8,
    `Joule-Thomson ${res.jouleThomsonCoeffKBar} K/bar`,
  );
});

test("GERG-2008: Handles Hydrogen Blending and captures physical shifts", () => {
  const pPa = 60.0e5;
  const tK = 293.15;

  const h2BlendedGas: GasComposition = {
    ...baselineGas,
    hydrogen: 0.2, // 20% H2 blend
    methane: 0.74,
  };

  const resBase = Gerg2008Eos.evaluate(pPa, tK, baselineGas);
  const resH2 = Gerg2008Eos.evaluate(pPa, tK, h2BlendedGas);

  // Hydrogen is much lighter, so density must decrease significantly
  assert.ok(resH2.massDensityKgM3 < resBase.massDensityKgM3, "H2 blend must reduce mixture density");
  // Sound speed in hydrogen is much higher (c ~ sqrt(gamma * R/M * T)), so it must increase
  assert.ok(resH2.speedOfSoundMS > resBase.speedOfSoundMS, "H2 blend must increase speed of sound");
  // Hydrogen pushes gas closer to ideal gas behavior (Z closer to 1.0)
  assert.ok(resH2.zFactor > resBase.zFactor, "H2 blend must increase Z factor towards 1.0");
});
