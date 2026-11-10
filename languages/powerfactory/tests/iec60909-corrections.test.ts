// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import { powerFactoryToPsse } from "../src/projections/powerfactory-to-psse.js";
import {
  calculateBreakingDecayMu,
  calculateCertifiedIec60909,
  calculateGeneratorCorrectionFactor,
  calculatePeakFactorKappa,
  calculateThermalFactors,
  calculateTransformerCorrectionFactor,
} from "../src/solvers/iec60909-corrections.js";

test("calculateGeneratorCorrectionFactor: computes K_G per IEC 60909-0 Clause 6.3.1", () => {
  // Test case: 11kV generator with x''d = 0.20 pu, cos(phi) = 0.85
  const kg = calculateGeneratorCorrectionFactor(11.0, 11.0, 0.20, 0.85, 1.10);
  // sin(phi) = sqrt(1 - 0.85^2) = 0.52678
  // 1 + x''d * sin(phi) = 1 + 0.20 * 0.52678 = 1.10536
  // K_G = (11 / 11) * (1.10 / 1.10536) ≈ 0.99515
  assert.ok(Math.abs(kg - 0.99515) < 1e-3, `Expected K_G ≈ 0.99515, got ${kg}`);

  // Test case: generator rated 11.5kV connected to 11kV network
  const kgOffNom = calculateGeneratorCorrectionFactor(11.0, 11.5, 0.15, 0.80, 1.10);
  assert.ok(kgOffNom < 1.0, "K_G should be less than 1.0 when UrG > Un");
});

test("calculateTransformerCorrectionFactor: computes K_T per IEC 60909-0", () => {
  // Test case: xT = 0.10 pu, cMax = 1.10
  // K_T = 0.95 * (1.10 / (1 + 0.1 * 0.10)) = 0.95 * (1.10 / 1.01) ≈ 1.03465
  const kt = calculateTransformerCorrectionFactor(0.10, 1.10);
  assert.ok(Math.abs(kt - 1.03465) < 1e-3, `Expected K_T ≈ 1.03465, got ${kt}`);
});

test("calculatePeakFactorKappa: computes Method B peak factor", () => {
  // Purely inductive fault (R/X ≈ 0) -> kappa ≈ 2.0
  const kappaZero = calculatePeakFactorKappa(0.001);
  assert.ok(Math.abs(kappaZero - 2.0) < 0.05, `Expected kappa ≈ 2.0, got ${kappaZero}`);

  // R/X = 0.1 -> kappa = 1.02 + 0.98 * e^(-0.3) ≈ 1.746
  const kappa01 = calculatePeakFactorKappa(0.1);
  assert.ok(Math.abs(kappa01 - 1.746) < 1e-2, `Expected kappa ≈ 1.746, got ${kappa01}`);

  // High resistance R/X = 2.0 -> kappa -> 1.02
  const kappaHigh = calculatePeakFactorKappa(2.0);
  assert.ok(Math.abs(kappaHigh - 1.02) < 0.01, `Expected kappa ≈ 1.02, got ${kappaHigh}`);
});

test("calculateBreakingDecayMu: computes breaking current factor across contact parting times", () => {
  // Low fault ratio <= 2.0 -> no decay (mu = 1.0)
  assert.strictEqual(calculateBreakingDecayMu(1.5, 0.05), 1.0);

  // Near-generator fault with high ratio I''_k / I_rG = 5.0
  const mu20ms = calculateBreakingDecayMu(5.0, 0.02);
  const mu50ms = calculateBreakingDecayMu(5.0, 0.05);
  const mu100ms = calculateBreakingDecayMu(5.0, 0.10);
  const mu250ms = calculateBreakingDecayMu(5.0, 0.25);

  assert.ok(mu20ms <= 1.0 && mu20ms > 0);
  assert.ok(mu50ms <= 1.0 && mu50ms > 0);
  assert.ok(mu100ms <= 1.0 && mu100ms > 0);
  assert.ok(mu250ms <= 1.0 && mu250ms > 0);

  // Longer contact parting time leads to more decay (lower mu)
  assert.ok(mu20ms >= mu50ms, "Shorter contact parting delay should have higher breaking current");
  assert.ok(mu50ms >= mu100ms);
  assert.ok(mu100ms >= mu250ms);
});

test("calculateThermalFactors: computes m and n thermal equivalent withstand factors", () => {
  const kappa = 1.75;
  const mu = 0.85;
  const { m, n } = calculateThermalFactors(kappa, mu, 1.0, 50.0);

  assert.ok(m >= 0, `Thermal DC factor m should be >= 0, got ${m}`);
  assert.ok(n >= 0.1, `Thermal AC factor n should be >= 0.1, got ${n}`);
  // With mu = 0.85, n = 1 - 0.85 + (0.85^2)/3 ≈ 0.15 + 0.2408 ≈ 0.3908
  assert.ok(Math.abs(n - 0.3908) < 1e-2, `Expected n ≈ 0.3908, got ${n}`);
});

test("calculateCertifiedIec60909: executes full study on PowerFactory grid", () => {
  const gridXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="GridBus"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="LoadBus"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>

  <DataObject class="ElmLne" loc_name="Feeder">
    <bus1>GridBus</bus1>
    <bus2>LoadBus</bus2>
    <dline>15.0</dline>
    <r1>1.50</r1>
    <x1>4.50</x1>
    <b1>10.0</b1>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen1">
    <bus1>GridBus</bus1>
    <pgini>100.0</pgini>
    <qgini>20.0</qgini>
    <usetp>1.05</usetp>
  </DataObject>

  <DataObject class="ElmLod" loc_name="Load1">
    <bus1>LoadBus</bus1>
    <plini>40.0</plini>
    <qlini>10.0</qlini>
  </DataObject>
</PowerFactory>`;

  const model = parsePowerFactoryText(gridXml, "GridStudy");
  const { psseCase } = powerFactoryToPsse(model);

  const certified = calculateCertifiedIec60909(psseCase, {
    cMax: 1.10,
    tMinSec: 0.05,
    tKSec: 1.0,
  });

  assert.strictEqual(certified.cMax, 1.10);
  assert.strictEqual(certified.tMinSec, 0.05);
  assert.strictEqual(certified.tKSec, 1.0);
  assert.strictEqual(certified.buses.length, 2);

  assert.ok(certified.maxFaultCurrentKa > 0, "Max fault current should be positive");
  assert.ok(certified.maxFaultBus > 0, "Max fault bus should be valid");

  for (const b of certified.buses) {
    assert.ok(b.ikssKa > 0, `Bus ${b.busNumber} I''k should be > 0`);
    assert.ok(b.ipKa > b.ikssKa, `Bus ${b.busNumber} peak current ip should be > I''k`);
    assert.ok(b.ibKa <= b.ikssKa, `Bus ${b.busNumber} breaking current Ib should be <= I''k`);
    assert.ok(b.ithKa > 0, `Bus ${b.busNumber} Ith should be > 0`);
    assert.ok(b.ansiC37.duty2CycleKa >= b.ansiC37.duty3CycleKa);
    assert.ok(b.ansiC37.duty3CycleKa >= b.ansiC37.duty5CycleKa);
  }
});
