// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { Aga8Eos } from "../src/solver/eos/aga8-detailed.js";
import { PengRobinsonEos } from "../src/solver/eos/cubic-eos.js";

test("AGA-8 accurately evaluates natural gas compressibility Z and density", () => {
  const comp = {
    methane: 0.94,
    ethane: 0.04,
    propane: 0.01,
    nitrogen: 0.006,
    carbonDioxide: 0.004,
    hydrogen: 0.0,
    nButane: 0,
    iButane: 0,
    pentanes: 0,
    hexanePlus: 0,
  };

  // Standard pipeline operating point: 60 bar, 288.15 K (15 deg C)
  const res = Aga8Eos.evaluate(60e5, 288.15, comp);

  // Compressibility Z for pipeline natural gas at 60 bar is typically 0.85 - 0.90
  assert.ok(res.zFactor > 0.8 && res.zFactor < 0.95, `Z factor ${res.zFactor} out of range`);
  // Mass density at 60 bar is ~ 40 - 55 kg/m3
  assert.ok(res.massDensity > 35 && res.massDensity < 65, `Density ${res.massDensity} out of range`);
  // Speed of sound in natural gas is ~ 380 - 450 m/s
  assert.ok(res.speedOfSound > 350 && res.speedOfSound < 500, `Speed of sound ${res.speedOfSound} out of range`);
});

test("AGA-8 handles Hydrogen Blending correctly", () => {
  const pureGas = {
    methane: 1.0,
    ethane: 0,
    propane: 0,
    nButane: 0,
    iButane: 0,
    pentanes: 0,
    hexanePlus: 0,
    nitrogen: 0,
    carbonDioxide: 0,
    hydrogen: 0.0,
  };

  const blendedGas = {
    ...pureGas,
    methane: 0.8,
    hydrogen: 0.2, // 20% H2 blend
  };

  const resPure = Aga8Eos.evaluate(60e5, 288.15, pureGas);
  const resBlend = Aga8Eos.evaluate(60e5, 288.15, blendedGas);

  // Hydrogen has much lower molar mass (2.016 g/mol vs 16.04 g/mol)
  assert.ok(resBlend.massDensity < resPure.massDensity, "H2 blend must reduce mixture density");
  // Hydrogen increases speed of sound significantly
  assert.ok(resBlend.speedOfSound > resPure.speedOfSound, "H2 blend must increase speed of sound");
});

test("Peng-Robinson cubic EOS calculates reasonable supercritical and gas properties", () => {
  // Pure Methane at 70 bar, 300 K (Supercritical region, Tc=190.56K, Pc=45.99 bar)
  const res = PengRobinsonEos.evaluate(70e5, 300);
  assert.equal(res.phase, "SUPERCRITICAL");
  assert.ok(res.zFactor > 0.75 && res.zFactor < 0.95);
  assert.ok(res.massDensity > 45 && res.massDensity < 70);
});
