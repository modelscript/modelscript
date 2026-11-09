// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  EmtSolver,
  LineConstantsSolver,
  type CableGeometry,
  type EmtNetlist,
  type TowerGeometry,
} from "../src/index.js";

// Standard 500 kV Single-Circuit Flat Horizontal Transmission Tower:
// - Phase A at (-10.5m, 22.0m), Phase B at (0.0m, 22.0m), Phase C at (10.5m, 22.0m)
// - 2-bundle subconductors, spacing = 0.457 m (18 in), Drake ACSR (radius = 14.07 mm, Rdc = 0.072 Ohm/km)
// - Two continuous shield wires at (-6.5m, 32.0m) and (6.5m, 32.0m) with Rdc = 1.5 Ohm/km
// - Soil resistivity rho = 100 Ohm-m, mid-span sag = 7.5 m
const STANDARD_500KV_TOWER: TowerGeometry = {
  name: "500kV_Flat_Horizontal_Tower",
  earthResistivityOhmMeter: 100.0,
  conductors: [
    {
      id: "PHASE_A",
      phase: "A",
      xMeters: -10.5,
      yMeters: 22.0,
      sagMeters: 7.5,
      radiusMeters: 0.01407,
      rDcOhmPerKm: 0.072,
      subConductorCount: 2,
      bundleSpacingMeters: 0.457,
      isGroundWire: false,
    },
    {
      id: "PHASE_B",
      phase: "B",
      xMeters: 0.0,
      yMeters: 22.0,
      sagMeters: 7.5,
      radiusMeters: 0.01407,
      rDcOhmPerKm: 0.072,
      subConductorCount: 2,
      bundleSpacingMeters: 0.457,
      isGroundWire: false,
    },
    {
      id: "PHASE_C",
      phase: "C",
      xMeters: 10.5,
      yMeters: 22.0,
      sagMeters: 7.5,
      radiusMeters: 0.01407,
      rDcOhmPerKm: 0.072,
      subConductorCount: 2,
      bundleSpacingMeters: 0.457,
      isGroundWire: false,
    },
    // Ground / shield wire 1
    {
      id: "SHIELD_1",
      xMeters: -6.5,
      yMeters: 32.0,
      sagMeters: 5.0,
      radiusMeters: 0.0055,
      rDcOhmPerKm: 1.5,
      isGroundWire: true,
    },
    // Ground / shield wire 2
    {
      id: "SHIELD_2",
      xMeters: 6.5,
      yMeters: 32.0,
      sagMeters: 5.0,
      radiusMeters: 0.0055,
      rDcOhmPerKm: 1.5,
      isGroundWire: true,
    },
  ],
};

// 132 kV Single-Core XLPE Underground Cable:
// - Copper core radius = 18.0 mm, insulation radius = 38.0 mm (eps_r = 2.3)
// - Metallic sheath radius = 42.0 mm, outer jacket radius = 46.0 mm (eps_r = 2.5)
// - Burial depth = 1.2 m, earth resistivity = 50 Ohm-m
const XLPE_132KV_CABLE: CableGeometry = {
  name: "132kV_XLPE_SingleCore",
  earthResistivityOhmMeter: 50.0,
  burialDepthMeters: 1.2,
  coreRadiusMeters: 0.018,
  coreRdcOhmPerKm: 0.028,
  insulationRadiusMeters: 0.038,
  insulationRelativePermittivity: 2.3,
  sheathRadiusMeters: 0.042,
  sheathRdcOhmPerKm: 0.25,
  jacketRadiusMeters: 0.046,
  jacketRelativePermittivity: 2.5,
};

test("LCP Overhead Tower: Kron reduction eliminates shield wires and computes accurate 500 kV line constants", () => {
  const result = LineConstantsSolver.solveTower(STANDARD_500KV_TOWER, {
    lengthKm: 150.0,
  });

  assert.strictEqual(result.towerOrCableName, "500kV_Flat_Horizontal_Tower");
  assert.strictEqual(result.phaseCount, 3);
  assert.deepStrictEqual(result.phases, ["A", "B", "C"]);

  // Positive-sequence parameters at 60 Hz:
  // For 500 kV 2-bundle line:
  // - R1 ~ 0.03 - 0.05 Ohm/km (0.072 / 2 = 0.036 + skin effect)
  // - X1 ~ 0.25 - 0.38 Ohm/km
  // - Surge impedance Zc ~ 250 - 320 Ohm
  // - Propagation velocity ~ 285,000 - 300,000 km/s (close to c)
  assert(result.r1OhmPerKm > 0.03 && result.r1OhmPerKm < 0.06, `Expected R1 in [0.03, 0.06], got ${result.r1OhmPerKm}`);
  assert(result.x1OhmPerKm > 0.25 && result.x1OhmPerKm < 0.45, `Expected X1 in [0.25, 0.45], got ${result.x1OhmPerKm}`);
  assert(
    result.surgeImpedanceOhm > 240 && result.surgeImpedanceOhm < 340,
    `Expected Zc in [240, 340], got ${result.surgeImpedanceOhm}`,
  );
  assert(
    result.velocityKmPerSec > 280000 && result.velocityKmPerSec <= 300000,
    `Expected velocity near c, got ${result.velocityKmPerSec}`,
  );

  // Travel time: tau = 150 km / ~295,000 km/s ≈ 0.508 ms
  assert(
    result.travelTimeSec > 0.00045 && result.travelTimeSec < 0.0006,
    `Expected tau ~ 0.5 ms, got ${result.travelTimeSec}`,
  );

  // Zero-sequence earth return effect:
  // Zero-sequence resistance R0 must be significantly higher than R1 due to ground return dissipation (R0 ~ 3 to 6 * R1)
  assert(
    result.r0OhmPerKm > 2.0 * result.r1OhmPerKm,
    `Expected R0 > 2*R1, got R0=${result.r0OhmPerKm}, R1=${result.r1OhmPerKm}`,
  );
  assert(
    result.x0OhmPerKm > result.x1OhmPerKm,
    `Expected X0 > X1, got X0=${result.x0OhmPerKm}, X1=${result.x1OhmPerKm}`,
  );
});

test("LCP Skin Effect: High-frequency internal resistance growth matches physical penetration depth", () => {
  const rDc = 0.072; // Ohm/km
  const radius = 0.01407; // m

  const z60 = LineConstantsSolver.computeConductorInternalImpedance(rDc, radius, 1.0, 60.0);
  const z100k = LineConstantsSolver.computeConductorInternalImpedance(rDc, radius, 1.0, 100000.0);
  const z1M = LineConstantsSolver.computeConductorInternalImpedance(rDc, radius, 1.0, 1000000.0);

  // At 60 Hz, AC resistance is slightly above DC resistance (~0.072 - 0.075 Ohm/km)
  const r60 = z60.re * 1000.0;
  assert(r60 >= rDc * 0.99 && r60 < rDc * 1.15, `Expected r60 ~ rDc, got ${r60}`);

  // At 100 kHz and 1 MHz, skin effect forces current to conductor perimeter:
  // R_ac increases substantially (proportional to sqrt(f))
  const r100k = z100k.re * 1000.0;
  const r1M = z1M.re * 1000.0;

  assert(r100k > 3.0 * r60, `Expected r100k > 3*r60, got ${r100k}`);
  assert(r1M > 2.0 * r100k, `Expected r1M > 2*r100k, got ${r1M}`);
});

test("Cable Constants: Solves 132 kV XLPE single-core cable with coaxial dielectric surge impedance", () => {
  const result = LineConstantsSolver.solveCable(XLPE_132KV_CABLE, {
    lengthKm: 15.0,
  });

  assert.strictEqual(result.towerOrCableName, "132kV_XLPE_SingleCore");
  assert.strictEqual(result.phaseCount, 1);

  // Underground cables have higher capacitance and lower surge impedance than overhead lines:
  // - Surge impedance Zc ~ 30 - 60 Ohm (vs 250-400 Ohm for overhead lines)
  // - Velocity ~ c / sqrt(eps_r) ≈ 300,000 / sqrt(2.3) ≈ 197,000 km/s
  assert(
    result.surgeImpedanceOhm > 25.0 && result.surgeImpedanceOhm < 70.0,
    `Expected cable Zc in [25, 70], got ${result.surgeImpedanceOhm}`,
  );
  assert(
    result.velocityKmPerSec > 160000 && result.velocityKmPerSec < 220000,
    `Expected velocity in [160k, 220k], got ${result.velocityKmPerSec}`,
  );
});

test("Vector Fitting: Approximates frequency-dependent characteristic admittance Yc(s) with stable rational poles", () => {
  const result = LineConstantsSolver.solveTower(STANDARD_500KV_TOWER, {
    lengthKm: 100.0,
    numPoles: 6,
  });

  const fit = result.rationalFit;
  assert(fit !== undefined);
  assert.strictEqual(fit.poles.length, 6);
  assert.strictEqual(fit.residues.length, 6);

  // All poles must have negative real parts for numerical stability in time domain
  for (const pole of fit.poles) {
    assert(pole < 0, `Pole must be strictly negative for stability, got ${pole}`);
  }

  // Direct term d0 must be positive
  assert(fit.d0 > 0, `d0 must be positive, got ${fit.d0}`);

  // RMS error should be small (< 25% over 6 decades)
  assert(fit.rmsError < 0.25, `Expected RMS error < 25%, got ${fit.rmsError}`);
});

test("EmtSolver Integration: Simulates Phase-Domain Frequency-Dependent Line (FDPM) companion stepping", () => {
  // Obtain rational parameters from physical tower geometry
  const lcp = LineConstantsSolver.solveTower(STANDARD_500KV_TOWER, {
    lengthKm: 100.0,
    numPoles: 4,
  });

  // Build an EMT netlist with an FDPM transmission line
  const netlist: EmtNetlist = {
    buses: [
      { id: "SENDING", nominalKv: 500.0 },
      { id: "RECEIVING", nominalKv: 500.0 },
    ],
    branches: [],
    sources: [
      {
        id: "SRC1",
        bus: "SENDING",
        voltageKv: 500.0,
        frequencyHz: 60.0,
        phaseDeg: 0.0,
        rSourceOhm: 1.0,
        lSourceHenry: 0.01,
      },
    ],
    transformers: [],
    lines: [
      {
        id: "LINE_500KV_FDPM",
        from: "SENDING",
        to: "RECEIVING",
        lengthKm: 100.0,
        rTotalOhm: lcp.r1OhmPerKm * 100.0,
        lTotalHenry: (lcp.x1OhmPerKm * 100.0) / (2.0 * Math.PI * 60.0),
        cTotalFarad: (lcp.b1MicroSiemensPerKm * 1e-6 * 100.0) / (2.0 * Math.PI * 60.0),
        modelType: "fdpm",
        poles: lcp.rationalFit.poles,
        residues: lcp.rationalFit.residues,
        d0: lcp.rationalFit.d0,
      },
    ],
    loads: [
      {
        id: "LOAD1",
        bus: "RECEIVING",
        pMw: 300.0,
        qMvar: 50.0,
        nominalKv: 500.0,
      },
    ],
  };

  const solver = new EmtSolver(netlist, {
    timeStepSec: 50e-6,
    durationSec: 0.05,
    nominalFrequencyHz: 60.0,
  });

  const simResult = solver.solve();

  assert(simResult.time.length > 500);
  assert(simResult.busVoltages.has("RECEIVING"));

  const vRec = simResult.busVoltages.get("RECEIVING")!;
  const vPeakVolts = Math.max(...Array.from(vRec));
  const vPeakKv = vPeakVolts / 1000.0;

  // 500 kV LL -> line-to-neutral peak is 500 * sqrt(2)/sqrt(3) ≈ 408 kV
  // Receiving end with 300 MW load should achieve near-nominal voltage
  assert(
    vPeakKv > 350.0 && vPeakKv < 600.0,
    `Expected receiving end peak voltage ~ 408-550 kV, got ${vPeakKv.toFixed(1)} kV`,
  );
});
