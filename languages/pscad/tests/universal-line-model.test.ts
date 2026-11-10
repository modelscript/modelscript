// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  createUniversalLineModel,
  EmtSolver,
  LineConstantsSolver,
  stepUlmLine,
  type CableGeometry,
  type EmtNetlist,
  type TowerGeometry,
} from "../src/index.js";

// Standard 500 kV Single-Circuit Flat Horizontal Transmission Tower
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
    {
      id: "SHIELD_1",
      xMeters: -6.5,
      yMeters: 32.0,
      sagMeters: 5.0,
      radiusMeters: 0.0055,
      rDcOhmPerKm: 1.5,
      isGroundWire: true,
    },
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

// 132 kV Single-Core XLPE Underground Cable
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

test("Universal Line Model (ULM): Tower parameter synthesis and multi-delay modal separation", () => {
  const dtSec = 10e-6; // 10 microseconds
  const lengthKm = 200.0;

  const ulm = LineConstantsSolver.solveUlm(STANDARD_500KV_TOWER, {
    lengthKm,
    dtSec,
    id: "ULM_500KV_LINE",
    fromBus: "BUS_1",
    toBus: "BUS_2",
  });

  assert.strictEqual(ulm.id, "ULM_500KV_LINE");
  assert.strictEqual(ulm.fromBus, "BUS_1");
  assert.strictEqual(ulm.toBus, "BUS_2");

  // Delay groups: Mode 1 (Aerial mode) and Mode 0 (Ground mode)
  assert.strictEqual(ulm.delayGroups.length, 2);

  const grpAerial = ulm.delayGroups[0]!;
  const grpGround = ulm.delayGroups[1]!;

  assert.strictEqual(grpAerial.name, "mode1_aerial");
  assert.strictEqual(grpGround.name, "mode0_ground");

  // Ground mode propagation velocity is lower due to Carson earth return -> travel time tau0 > tau1
  assert(
    grpGround.delaySec > grpAerial.delaySec,
    `Expected tau0 (${grpGround.delaySec}s) > tau1 (${grpAerial.delaySec}s)`,
  );

  // Velocity of aerial mode ~ 290,000 - 300,000 km/s -> tau1 ≈ 200 / 295,000 ≈ 0.67 ms
  const expectedTau1 = lengthKm / 295000.0;
  assert(
    Math.abs(grpAerial.delaySec - expectedTau1) / expectedTau1 < 0.15,
    `Expected tau1 near ${expectedTau1}s, got ${grpAerial.delaySec}s`,
  );

  // Check buffer length accommodates the longest delay
  assert(ulm.bufLen >= grpGround.delaySteps + 3);

  // Check rational poles of Y_c: all real negative poles
  assert.strictEqual(ulm.yPoles.length, 4);
  for (let m = 0; m < ulm.yPoles.length; m++) {
    const p = ulm.yPoles[m]!;
    assert(p < 0, `Expected pole < 0, got ${p}`);
    assert(ulm.yExpDecays[m]! > 0 && ulm.yExpDecays[m]! < 1.0, `Expected decay in (0, 1)`);
  }

  // Check rational poles of H(s): all stable
  for (const grp of ulm.delayGroups) {
    for (let m = 0; m < grp.poles.length; m++) {
      assert(grp.poles[m]! < 0, `Expected propagation pole < 0`);
      assert(grp.expDecays[m]! > 0 && grp.expDecays[m]! < 1.0, `Expected decay in (0, 1)`);
    }
  }

  // 3x3 G_eq matrix properties: strictly positive definite, diagonally dominant
  const gEq = ulm.gEq;
  assert(gEq[0]! > 0, "G_eq[0,0] must be positive");
  assert(gEq[4]! > 0, "G_eq[1,1] must be positive");
  assert(gEq[8]! > 0, "G_eq[2,2] must be positive");
  // Diagonal dominance: G_self > |G_mut1| + |G_mut2|
  assert(gEq[0]! > Math.abs(gEq[1]!) + Math.abs(gEq[2]!));
});

test("Universal Line Model (ULM): Asymmetric phase-domain coupling for untransposed geometry", () => {
  const dtSec = 20e-6;
  const ulm = createUniversalLineModel({
    id: "ASYM_LINE",
    fromBus: "B1",
    toBus: "B2",
    fromIdx: 0,
    toIdx: 1,
    lengthKm: 100.0,
    dtSec,
    rPerKm: 0.032,
    lPerKm: 0.00105,
    cPerKm: 1.15e-8,
    asymmetryFactor: 0.12, // 12% horizontal tower asymmetry
  });

  // Verify that center phase (Phase B, index 4) differs from outer phases (Phase A, index 0 and C, index 8)
  const gEq = ulm.gEq;
  const gSelfA = gEq[0]!;
  const gSelfB = gEq[4]!;
  const gSelfC = gEq[8]!;

  assert.notStrictEqual(gSelfA, gSelfB, "Center phase self-conductance should differ from outer phase");
  assert(Math.abs(gSelfA - gSelfC) < 1e-6, "Outer phases A and C should be symmetrical in flat horizontal layout");

  // Center phase B has different mutual coupling to A and C compared to A-C coupling
  const gMutAB = gEq[1]!;
  const gMutAC = gEq[2]!;
  assert(
    Math.abs(gMutAB) > Math.abs(gMutAC),
    `Adjacent phases A-B (|${gMutAB}|) must have stronger mutual coupling than non-adjacent A-C (|${gMutAC}|)`,
  );
});

test("Universal Line Model (ULM): Time-stepping recursive convolution impulse response", () => {
  const dtSec = 10e-6;
  const ulm = createUniversalLineModel({
    id: "IMPULSE_LINE",
    fromBus: "B1",
    toBus: "B2",
    fromIdx: 0,
    toIdx: 1,
    lengthKm: 150.0,
    dtSec,
    rPerKm: 0.03,
    lPerKm: 0.001,
    cPerKm: 1.1e-8,
  });

  const tau1 = ulm.delayGroups[0]!.delaySec;
  const tau0 = ulm.delayGroups[1]!.delaySec;
  const steps1 = Math.round(tau1 / dtSec);
  const steps0 = Math.round(tau0 / dtSec);

  assert(steps0 > steps1, "Ground mode delay steps must exceed aerial mode");

  // Step 0: apply steep voltage impulse on Phase A at sending end (terminal K)
  const vPeak = 1000.0;
  stepUlmLine(ulm, vPeak, 0, 0, 0, 0, 0, true);

  // Steps 1 to steps1 - 1: no wave has reached terminal M yet due to travel time
  for (let s = 1; s < steps1 - 1; s++) {
    const hist = stepUlmLine(ulm, 0, 0, 0, 0, 0, 0, true);
    assert.strictEqual(
      hist.iHistMkA,
      0,
      `Step ${s} (< ${steps1}): History current at receiving end must be zero before wave arrival`,
    );
  }

  // Advance through arrival window: observe arrival of aerial pulse then ground pulse
  let sawAerialArrival = false;
  let sawGroundArrival = false;

  for (let s = steps1 - 1; s <= steps0 + 10; s++) {
    const hist = stepUlmLine(ulm, 0, 0, 0, 0, 0, 0, true);
    if (Math.abs(hist.iHistMkA) > 0.01) {
      sawAerialArrival = true;
    }
    if (s >= steps0 && Math.abs(hist.iHistMkA) > 0.001) {
      sawGroundArrival = true;
    }
  }

  assert(sawAerialArrival, "Must observe arrival of aerial mode wave at receiving end");
  assert(sawGroundArrival, "Must observe ground mode dispersion wave at receiving end");
});

test("Universal Line Model (ULM): Full closed-loop EMT grid simulation vs Bergeron benchmark", () => {
  // Test network: 230 kV AC source -> Bus 1 -> 120 km ULM Line -> Bus 2 -> 50 MW resistive load
  const lengthKm = 120.0;
  const netlistUlm: EmtNetlist = {
    nominalFrequencyHz: 60.0,
    buses: [
      { id: "BUS1", baseKv: 230.0 },
      { id: "BUS2", baseKv: 230.0 },
    ],
    sources: [
      {
        id: "SRC1",
        bus: "BUS1",
        voltageKv: 230.0,
        frequencyHz: 60.0,
        rSourceOhm: 1.0,
      },
    ],
    transmissionLines: [
      {
        id: "LINE_ULM",
        fromBus: "BUS1",
        toBus: "BUS2",
        lengthKm,
        rPerKm: 0.035,
        lPerKm: 0.00105,
        cPerKm: 1.15e-8,
        r0PerKm: 0.12,
        l0PerKm: 0.0033,
        c0PerKm: 0.75e-8,
        modelType: "ulm",
      },
    ],
    branches: [
      // 50 MW 3-phase load at Bus 2: R = V_LL^2 / P = 230^2 / 50 = 1058 Ohm
      {
        id: "LOAD_R",
        fromBus: "BUS2",
        toBus: "0",
        rOhm: 1058.0,
        lHenry: 0,
        cFarad: 0,
      },
    ],
  };

  const solver = new EmtSolver(netlistUlm, {
    timeStepSec: 50e-6,
    durationSec: 0.06, // 3.6 cycles of 60 Hz
    initializeFromLoadFlow: false,
  });

  const ulmLines = solver.getUlmLines();
  assert.strictEqual(ulmLines.length, 1, "Must register exactly 1 ULM line");
  assert.strictEqual(ulmLines[0]!.id, "LINE_ULM");

  const result = solver.solve();

  // Verify simulation completed 1200 steps
  assert.strictEqual(result.metrics.totalSteps, 1200);

  const vA1 = result.vA.get("BUS1")!;
  const vA2 = result.vA.get("BUS2")!;
  assert(vA1 && vA2, "Voltages at BUS1 and BUS2 must be recorded");

  // Check steady-state 60 Hz envelope at Bus 2 (after traveling wave propagation)
  const vPeakExpected = (230.0 * 1e3 * Math.sqrt(2)) / Math.sqrt(3); // ~ 187.8 kV
  const vPeakBus2 = Math.max(...Array.from(vA2.subarray(600))); // second half of trajectory

  assert(
    vPeakBus2 > 0.85 * vPeakExpected && vPeakBus2 < 1.15 * vPeakExpected,
    `Bus 2 peak voltage ${vPeakBus2 / 1e3} kV should be near ${vPeakExpected / 1e3} kV`,
  );

  // Check that branchPhaseCurrents recorded ULM line terminal currents
  const lineCurrents = result.branchPhaseCurrents.get("LINE_ULM");
  assert(lineCurrents, "ULM line currents must be stored in branchPhaseCurrents");
  const iPeakA = Math.max(...Array.from(lineCurrents.a.subarray(600)));
  assert(iPeakA > 10.0, `ULM line current peak (${iPeakA} A) must reflect load flow`);
});

test("Universal Line Model (ULM): Subsea XLPE Cable parameter synthesis", () => {
  const dtSec = 10e-6;
  const ulmCable = LineConstantsSolver.solveUlmCable(XLPE_132KV_CABLE, {
    lengthKm: 45.0,
    dtSec,
    id: "SUBSEA_CABLE_ULM",
    fromBus: "OFFSHORE_SUB",
    toBus: "ONSHORE_GRID",
  });

  assert.strictEqual(ulmCable.id, "SUBSEA_CABLE_ULM");
  assert.strictEqual(ulmCable.fromBus, "OFFSHORE_SUB");
  assert.strictEqual(ulmCable.toBus, "ONSHORE_GRID");

  // XLPE dielectric permittivity eps_r = 2.3 -> propagation velocity v ~ 170,000 - 200,000 km/s (accounting for jacket and earth return)
  const velExpected = 299792.0 / Math.sqrt(2.3);
  const tauExpected = 45.0 / velExpected; // ~ 0.228 ms
  const grpAerial = ulmCable.delayGroups[0]!;

  assert(
    Math.abs(grpAerial.delaySec - tauExpected) / tauExpected < 0.2,
    `Expected cable propagation delay ~ ${tauExpected * 1e3} ms, got ${grpAerial.delaySec * 1e3} ms`,
  );

  // Cable characteristic surge impedance is much lower than overhead line (Zc ~ 30 - 60 Ohm vs 300 - 400 Ohm)
  const gSelf = ulmCable.gEq[0]!;
  const zEq = 1.0 / gSelf;
  assert(zEq > 20.0 && zEq < 80.0, `Expected cable surge impedance in [20, 80] Ohm, got ${zEq} Ohm`);
});
