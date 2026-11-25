// SPDX-License-Identifier: AGPL-3.0-or-later

import { runHybridPhasorEmtCoSimulation } from "@modelscript/exchange";
import type { EmtNetlist } from "@modelscript/pscad";
import { PscadEmtParticipant } from "@modelscript/pscad";
import {
  computeMultiPortThevenin,
  extractEmtBufferZone,
  parseDyr,
  parseRaw,
  PssePhasorParticipant,
  psseToEmtNetlist,
} from "@modelscript/psse";
import assert from "node:assert/strict";
import test from "node:test";

const THREE_BUS_RAW = `0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0
3-BUS HYBRID TS-EMT TEST CASE
MODELICASCRIPT E-TRAN BENCHMARK
1,'SLACK_1     ', 230.0000,3, 1, 1, 1,1.02000,   0.0000,1.10000,0.90000,1.10000,0.90000
2,'GEN_2       ', 230.0000,2, 1, 1, 1,1.01000,  -2.0000,1.10000,0.90000,1.10000,0.90000
3,'POI_3       ', 230.0000,1, 1, 1, 1,1.00000,  -4.0000,1.10000,0.90000,1.10000,0.90000
0 / END OF BUS DATA, BEGIN LOAD DATA
3,'1 ',1, 1, 1,   60.000,   20.000,    0.000,    0.000,    0.000,    0.000, 1,1,0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1,'1 ',   40.000,   10.000,  100.000, -100.000,1.02000,    0,  100.000, 0.00300, 0.18000, 0.00000, 0.00000,1.00000,1, 100.0,  100.000,    0.000, 1,1.0000
2,'1 ',   25.000,    5.000,  100.000, -100.000,1.01000,    0,  100.000, 0.00300, 0.20000, 0.00000, 0.00000,1.00000,1, 100.0,  100.000,    0.000, 1,1.0000
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2,'1 ', 0.01000, 0.08000, 0.04000, 200.00, 200.00, 200.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1, 80.00, 1,1.0000
1, 3,'1 ', 0.01200, 0.10000, 0.05000, 200.00, 200.00, 200.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1, 100.00, 1,1.0000
2, 3,'1 ', 0.01500, 0.12000, 0.06000, 200.00, 200.00, 200.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1, 120.00, 1,1.0000
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA, BEGIN AREA DATA
0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA
0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA
0 / END OF VSC DC LINE DATA, BEGIN IMPEDANCE CORRECTION DATA
0 / END OF IMPEDANCE CORRECTION DATA, BEGIN MULTI-TERMINAL DC DATA
0 / END OF MULTI-TERMINAL DC DATA, BEGIN MULTI-SECTION LINE DATA
0 / END OF MULTI-SECTION LINE DATA, BEGIN ZONE DATA
0 / END OF ZONE DATA, BEGIN INTER-AREA TRANSFER DATA
0 / END OF INTER-AREA TRANSFER DATA, BEGIN OWNER DATA
0 / END OF OWNER DATA, BEGIN FACTS DEVICE DATA
0 / END OF FACTS DEVICE DATA, BEGIN SWITCHED SHUNT DATA
0 / END OF SWITCHED SHUNT DATA, BEGIN GNE DATA
0 / END OF GNE DATA, BEGIN INDUCTION MACHINE DATA
0 / END OF INDUCTION MACHINE DATA
Q
`;

const THREE_BUS_DYR = `1 'GENCLS' 1 5.0 2.0 /
2 'GENROU' 1 6.0 0.04 0.5 0.05 4.5 1.5 1.8 1.7 0.25 0.4 0.18 0.15 0.1 0.3 /
2 'SEXS' 1 0.1 10.0 50.0 0.05 -5.0 5.0 /
2 'TGOV1' 1 0.05 0.5 1.05 0.0 1.0 3.0 0.0 /
`;

function createLocalEmtPlantNetlist(): EmtNetlist {
  return {
    buses: [
      { id: "POI_EMT", name: "POI_EMT", baseKv: 230.0, phases: 3 },
      { id: "LOCAL_LOAD", name: "LOCAL_LOAD", baseKv: 230.0, phases: 3 },
    ],
    branches: [
      {
        id: "TIE_LINE",
        name: "Tie Line",
        kind: "rlc",
        fromBus: "POI_EMT",
        toBus: "LOCAL_LOAD",
        rOhm: 2.0,
        lHenry: 0.02,
      },
      {
        id: "PLANT_LOAD",
        name: "Local Load",
        kind: "rlc",
        fromBus: "LOCAL_LOAD",
        toBus: "GND",
        rOhm: 800.0,
        lHenry: 0.1,
      },
    ],
    sources: [],
    switches: [],
    faults: [],
    nonlinearElements: [],
    controls: [],
    metadata: {
      projectName: "LocalEmtPlant",
      nominalFrequencyHz: 60.0,
      timeStepSec: 50e-6,
      durationSec: 0.05,
    },
  };
}

test("computeMultiPortThevenin, psseToEmtNetlist (Bergeron + DYR), and extractEmtBufferZone", () => {
  const psseCase = parseRaw(THREE_BUS_RAW);
  const dyrCase = parseDyr(THREE_BUS_DYR);

  // 1. Dynamic multi-port Thévenin equivalent at Bus 3
  const eq = computeMultiPortThevenin(psseCase, [3]);
  assert.deepEqual(eq.busIds, ["3"]);
  assert.equal(eq.yEqPos.length, 1);
  assert.ok(
    Math.hypot(eq.yEqPos[0]!.re, eq.yEqPos[0]!.im) > 1.0,
    "Expected realistic short-circuit admittance at Bus 3",
  );
  assert.ok(eq.yEqZero && Math.abs(eq.yEqZero[0]!.im) < Math.abs(eq.yEqPos[0]!.im));

  // 2. Richer psseToEmtNetlist with Bergeron auto-selection + DYR dynamic models
  const emtNet = psseToEmtNetlist(psseCase, { dyrCase, dtEmtSec: 50e-6, autoSelectBergeron: true });
  assert.equal(emtNet.buses.size, 3);
  assert.equal(emtNet.transmissionLines.length, 3);
  assert.ok(
    emtNet.transmissionLines.some((l) => l.modelType === "bergeron" && (l.travelTimeSec ?? 0) >= 50e-6),
    "Expected long EHV transmission line to auto-select Bergeron model",
  );
  assert.ok(emtNet.dynamicModels && emtNet.dynamicModels.length === 4, "Expected 4 projected DYR dynamic models");
  assert.ok(emtNet.dynamicModels.some((m) => m.emtTargetKind === "sync_generator"));
  assert.ok(emtNet.dynamicModels.some((m) => m.emtTargetKind === "exciter_csmf"));
  assert.ok(emtNet.dynamicModels.some((m) => m.emtTargetKind === "governor_csmf"));

  // 3. Buffer-zone extraction (0-hop around Bus 3 => boundary = [3], external Ward equiv)
  const buf = extractEmtBufferZone(psseCase, [3], 0, { dyrCase });
  assert.deepEqual(buf.emtBusNumbers, [3]);
  assert.deepEqual(buf.boundaryBusNumbers, [3]);
  assert.equal(buf.externalWardEquivalent.retainedBusCount, 1);
  assert.equal(buf.externalWardEquivalent.eliminatedBusCount, 2);
});

test("End-to-end closed-loop PSS/E <-> PSCAD co-simulation (direct and FMI 3.0 modes + 3-seq SLG fault + FDNE)", async () => {
  const psseCase = parseRaw(THREE_BUS_RAW);
  const dyrCase = parseDyr(THREE_BUS_DYR);
  const emtNetlist = createLocalEmtPlantNetlist();

  const runScenario = async (mode: "direct" | "fmi") => {
    const phasor = new PssePhasorParticipant(psseCase, { id: "PSSE_3Bus", dyrCase });
    const emt = new PscadEmtParticipant(emtNetlist, { id: "PSCAD_Plant" });
    return runHybridPhasorEmtCoSimulation(
      phasor,
      [
        {
          id: "PSCAD_Plant",
          participant: emt,
          boundaryPorts: [{ phasorBusId: "3", emtBusId: "POI_EMT" }],
        },
      ],
      {
        durationSec: 0.05,
        dtTsSec: 0.005,
        dtEmtSec: 50e-6,
        mode,
        sequences: 3,
        useDynamicEquivalent: true,
        useFdne: true,
        fault: {
          busId: "2",
          startSec: 0.015,
          clearSec: 0.035,
          susceptancePu: -15.0,
          faultType: "slg",
        },
      },
    );
  };

  const directRes = await runScenario("direct");
  const fmiRes = await runScenario("fmi");

  assert.equal(directRes.totalMacroSteps, 10);
  assert.equal(directRes.totalEmtSubSteps, 1000);
  assert.equal(directRes.topologyUpdates, 2, "Expected topology update at fault inception and fault clearing");
  assert.equal(directRes.phasorTrajectory.summary.convergedPowerFlow, true);

  // Verify pre-fault steady-state voltage is near ~1.0 pu and dips during SLG fault
  const preFault = directRes.macroRecords[1]!; // t = 0.010s
  const duringFault = directRes.macroRecords[4]!; // t = 0.025s
  assert.ok(
    preFault.vTsMagPu > 0.95 && preFault.vTsMagPu < 1.05,
    `Expected steady pre-fault V~1.0, got ${preFault.vTsMagPu}`,
  );
  assert.ok(
    duringFault.vTsMagPu < preFault.vTsMagPu - 0.05,
    `Expected voltage dip during fault: ${duringFault.vTsMagPu} vs ${preFault.vTsMagPu}`,
  );
  assert.ok(
    duringFault.vNegMagPu > 0.01,
    `Expected non-zero negative sequence V during SLG fault, got ${duringFault.vNegMagPu}`,
  );
  assert.ok(
    duringFault.vZeroMagPu > 0.01,
    `Expected non-zero zero sequence V during SLG fault, got ${duringFault.vZeroMagPu}`,
  );

  // Verify Direct vs FMI 3.0 parity
  assert.equal(fmiRes.macroRecords.length, directRes.macroRecords.length);
  for (let i = 0; i < directRes.macroRecords.length; i++) {
    assert.ok(
      Math.abs(directRes.macroRecords[i]!.vTsMagPu - fmiRes.macroRecords[i]!.vTsMagPu) < 1e-4,
      `Direct vs FMI mismatch at step ${i}`,
    );
  }
});

test("Real EmtSolver Picard rollback, exact .seq zero-sequence network, multi-freq Y_bus(jw) FDNE scan, and multi-port coupling", async () => {
  const { scanExternalNetworkAdmittance } = await import("@modelscript/psse");
  const { EmtSolver } = await import("@modelscript/pscad");
  const psseCase = parseRaw(THREE_BUS_RAW);
  const dyrCase = parseDyr(THREE_BUS_DYR);

  // Explicit .seq sequence dataset with distinct zero-sequence impedances
  const seqCase = {
    generators: [
      {
        i: 1,
        id: "1",
        zrpos: 0.003,
        zxpos: 0.18,
        zrneg: 0.003,
        zxneg: 0.18,
        zr0: 0.002,
        zx0: 0.08,
        zrg: 0.0,
        zxg: 0.0,
      },
      { i: 2, id: "1", zrpos: 0.003, zxpos: 0.2, zrneg: 0.003, zxneg: 0.2, zr0: 0.002, zx0: 0.1, zrg: 0.0, zxg: 0.0 },
    ],
    branches: [
      { i: 1, j: 2, ckt: "1", r0: 0.03, x0: 0.24, b0: 0.02, gi0: 0, bi0: 0, gj0: 0, bj0: 0 },
      { i: 1, j: 3, ckt: "1", r0: 0.036, x0: 0.3, b0: 0.025, gi0: 0, bi0: 0, gj0: 0, bj0: 0 },
      { i: 2, j: 3, ckt: "1", r0: 0.045, x0: 0.36, b0: 0.03, gi0: 0, bi0: 0, gj0: 0, bj0: 0 },
    ],
    mutuals: [],
    transformers: [],
    shunts: [],
  };

  // 1. Multi-frequency Y_bus(jw) FDNE scan
  const scan = scanExternalNetworkAdmittance(psseCase, 3, [10, 60, 180, 600, 1500]);
  assert.equal(scan.length, 5);
  assert.ok(scan[1]!.ySiemens.re > 0, "60 Hz driving-point conductance must be positive");
  assert.ok(Math.abs(scan[4]!.ySiemens.im) !== Math.abs(scan[1]!.ySiemens.im), "Admittance must vary with frequency");

  // 2. Multi-port EMT plant (2 boundary buses in the same EMT plant -> exercises off-diagonal mutualCouplings + Picard rollback)
  const multiPortEmt: EmtNetlist = {
    buses: [
      { id: "PORT_2", name: "PORT_2", baseKv: 230.0, phases: 3 },
      { id: "PORT_3", name: "PORT_3", baseKv: 230.0, phases: 3 },
    ],
    branches: [
      {
        id: "LOCAL_TIE",
        name: "Local Tie",
        kind: "rlc",
        fromBus: "PORT_2",
        toBus: "PORT_3",
        rOhm: 5.0,
        lHenry: 0.03,
      },
      {
        id: "LOAD_3",
        name: "Load 3",
        kind: "rlc",
        fromBus: "PORT_3",
        toBus: "GND",
        rOhm: 900.0,
        lHenry: 0.1,
      },
    ],
    sources: [],
    switches: [],
    faults: [],
    nonlinearElements: [],
    controls: [],
    metadata: { projectName: "MultiPortPlant", nominalFrequencyHz: 60.0, timeStepSec: 50e-6, durationSec: 0.04 },
  };

  const phasor = new PssePhasorParticipant(psseCase, { id: "PSSE_Seq", dyrCase, seqCase });
  const emt = new PscadEmtParticipant(multiPortEmt, { id: "PSCAD_MultiPort" });

  const hybridRes = await runHybridPhasorEmtCoSimulation(
    phasor,
    [
      {
        id: "PSCAD_MultiPort",
        participant: emt,
        boundaryPorts: [
          { phasorBusId: "2", emtBusId: "PORT_2" },
          { phasorBusId: "3", emtBusId: "PORT_3" },
        ],
      },
    ],
    {
      durationSec: 0.04,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      mode: "direct",
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      maxIterations: 2, // Exercises real EmtSolver captureStepSessionState / restoreStepSessionState rollback!
      iterationTolerancePu: 1e-6,
      fault: {
        busId: "1",
        startSec: 0.015,
        clearSec: 0.03,
        susceptancePu: -15.0,
        faultType: "slg",
      },
    },
  );

  assert.equal(hybridRes.totalMacroSteps, 8);
  assert.ok(
    hybridRes.totalPicardIterations > hybridRes.totalMacroSteps,
    "Expected Picard rollback iterations > totalMacroSteps",
  );
  assert.equal(hybridRes.topologyUpdates, 2);

  // 3. Full-EMT vs Hybrid steady-state benchmark at Bus 3 (no fault)
  const fullEmtNet: EmtNetlist = {
    buses: [{ id: "BUS3", name: "BUS3", baseKv: 230.0, phases: 3 }],
    branches: [{ id: "LOAD3", name: "Load 3", kind: "rlc", fromBus: "BUS3", toBus: "GND", rOhm: 880.0, lHenry: 0.1 }],
    sources: [
      {
        id: "SRC_EQ",
        name: "Grid Eq",
        bus: "BUS3",
        vPeakKv: (230.0 * Math.SQRT2) / Math.sqrt(3),
        frequencyHz: 60.0,
        phaseDeg: -4.0,
        rSourceOhm: 1.5,
        lSourceH: 0.04,
      },
    ],
    switches: [],
    faults: [],
    nonlinearElements: [],
    controls: [],
    metadata: { projectName: "FullEmtRef", nominalFrequencyHz: 60.0, timeStepSec: 50e-6, durationSec: 0.04 },
  };
  const refSolver = new EmtSolver(fullEmtNet, { timeStepSec: 50e-6, durationSec: 0.04, initializeFromLoadFlow: true });
  const refRes = refSolver.solve();
  const refVa = refRes.busPhaseVoltages.get("BUS3")!.a;
  let refPeak = 0;
  for (let i = Math.floor(refVa.length / 2); i < refVa.length; i++) {
    refPeak = Math.max(refPeak, Math.abs(refVa[i]!));
  }
  const steadyHybPeakKv = hybridRes.macroRecords.find((r) => r.phasorBusId === "3" && r.timeSec === 0.01)!.vEmtPeakKv;
  const relDiff = Math.abs(steadyHybPeakKv * 1e3 - refPeak) / refPeak;
  assert.ok(
    relDiff < 0.08,
    `Expected Full-EMT vs Hybrid steady-state peak within 8%, got ${(relDiff * 100).toFixed(2)}%`,
  );
});

test("Sparse Kron reduction & 24-frequency FDNE scan scale cleanly on a 500-bus meshed grid", async () => {
  const { scanExternalNetworkAdmittance } = await import("@modelscript/psse");
  const nBuses = 500;
  const lines: string[] = ["0, 100.00, 33, 0, 1, 60.00", "500-BUS SPARSE KRON BENCHMARK", "CASE"];
  for (let i = 1; i <= nBuses; i++) {
    const type = i === 1 ? 3 : i % 50 === 0 ? 2 : 1;
    lines.push(`${i}, 'BUS${i}', 230.0000, ${type}, 1, 1, 1, 1.00000, 0.0000`);
  }
  lines.push("0 / END OF BUS DATA");
  for (let i = 2; i <= nBuses; i += 5) {
    lines.push(`${i}, '1 ', 1, 1, 1, 10.0, 3.0, 0.0, 0.0, 0.0, 0.0, 1`);
  }
  lines.push("0 / END OF LOAD DATA");
  lines.push("0 / END OF FIXED SHUNT DATA");
  lines.push("1, '1 ', 100.0, 20.0, 500.0, -500.0, 1.020, 0, 100.0, 0.003, 0.15, 0, 0, 1, 1, 100, 500, 0");
  for (let i = 50; i <= nBuses; i += 50) {
    lines.push(`${i}, '1 ', 50.0, 10.0, 200.0, -200.0, 1.010, 0, 100.0, 0.003, 0.18, 0, 0, 1, 1, 100, 200, 0`);
  }
  lines.push("0 / END OF GENERATOR DATA");
  // Ring + cross-ties for realistic sparse meshed topology
  for (let i = 1; i < nBuses; i++) {
    lines.push(`${i}, ${i + 1}, '1 ', 0.01, 0.08, 0.02, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10`);
  }
  lines.push(`${nBuses}, 1, '1 ', 0.01, 0.08, 0.02, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10`);
  for (let i = 1; i <= nBuses - 25; i += 10) {
    lines.push(`${i}, ${i + 25}, '1 ', 0.015, 0.12, 0.03, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10`);
  }
  lines.push("0 / END OF BRANCH DATA");
  lines.push("0 / END OF TRANSFORMER DATA");
  lines.push("Q");

  const bigCase = parseRaw(lines.join("\n"));

  const t0 = Date.now();
  const eq = computeMultiPortThevenin(bigCase, [100, 250]);
  const kronMs = Date.now() - t0;

  assert.equal(eq.busIds.length, 2);
  assert.ok(Number.isFinite(eq.yEqPos[0]!.re) && eq.yEqPos[0]!.re > 0, "Expected finite positive Y_eq[0,0].re");
  assert.ok(Number.isFinite(eq.yEqPos[3]!.re) && eq.yEqPos[3]!.re > 0, "Expected finite positive Y_eq[1,1].re");
  assert.ok(kronMs < 3000, `Expected 500-bus sparse Kron reduction < 3000 ms, took ${kronMs} ms`);

  const freqs24 = Array.from({ length: 24 }, (_, k) => 10 * Math.pow(2500 / 10, k / 23));
  const t1 = Date.now();
  const scan = scanExternalNetworkAdmittance(bigCase, 100, freqs24);
  const scanMs = Date.now() - t1;

  assert.equal(scan.length, 24);
  for (const pt of scan) {
    assert.ok(Number.isFinite(pt.ySiemens.re) && Number.isFinite(pt.ySiemens.im), `Non-finite Y at ${pt.freqHz} Hz`);
  }
  assert.ok(scan[5]!.ySiemens.re > 0, "Expected positive driving-point conductance near fundamental");
  assert.ok(scanMs < 5000, `Expected 500-bus 24-frequency sparse scan < 5000 ms, took ${scanMs} ms`);
});

test("PssePhasorParticipant full DYR controls (SEXS + TGOV1 + REGC_A), fmi-ls-rms companion, COI freqHz, and rollback", () => {
  const psseCase = parseRaw(THREE_BUS_RAW);
  // Add a 3rd generator (IBR) on Bus 3 for REGC_A test
  psseCase.generators.push({
    i: 3,
    id: "1",
    pg: 10.0,
    qg: 2.0,
    qt: 50.0,
    qb: -50.0,
    vs: 1.0,
    ireg: 0,
    mbase: 100.0,
    zr: 0.0,
    zx: 0.2,
    rt: 0.0,
    xt: 0.0,
    gtap: 1.0,
    stat: 1,
    rmpct: 100.0,
    pt: 100.0,
    pb: 0.0,
    o1: 1,
    f1: 1.0,
    o2: 0,
    f2: 0,
    o3: 0,
    f3: 0,
    o4: 0,
    f4: 0,
    wmod: 0,
    wpf: 1.0,
  });

  const dyrText = `${THREE_BUS_DYR}3 'REGC_A' 1 0.02 10.0 0.9 0.5 1.22 1.2 0.8 0.4 -1.3 0.02 0.7 999.0 -999.0 1.0 /
`;
  const dyrCase = parseDyr(dyrText);

  // Stateful fmi-ls-rms Norton companion on Bus 3
  let companionSteps = 0;
  let companionState = 0.0;
  const companion = {
    busNumber: 3,
    stampNorton: () => ({ gEq: 0.02, bEq: -0.01, irHist: 0.001 * companionState, iiHist: 0.0 }),
    doStep: (_t: number, dt: number, vr: number, vi: number) => {
      companionSteps++;
      companionState += dt * Math.hypot(vr, vi);
    },
    captureState: () => ({ companionSteps, companionState }),
    restoreState: (snap: unknown) => {
      const s = snap as { companionSteps: number; companionState: number };
      companionSteps = s.companionSteps;
      companionState = s.companionState;
    },
  };

  const phasor = new PssePhasorParticipant(psseCase, {
    id: "PSSE_FullDYR",
    dyrCase,
    nortonCompanions: [companion],
  });

  const init = phasor.initialize({
    durationSec: 0.04,
    dtMacroSec: 0.005,
    boundaryBusIds: ["3"],
    sequences: 1,
    fault: { busId: "2", startSec: 0.01, clearSec: 0.025, susceptancePu: -15.0, faultType: "3ph" },
  });
  assert.equal(init.boundaryVoltages.get("3")?.freqHz, 60.0);

  // Step to t = 0.015 (during fault)
  phasor.stepMacro(0.0, 0.005, []);
  phasor.stepMacro(0.005, 0.005, []);
  const snapBeforeFaultStep = phasor.getState();
  const stepsBefore = companionSteps;

  const step1 = phasor.stepMacro(0.01, 0.005, []);
  const v3Fault = step1.boundaryVoltages.get("3")!;
  assert.ok(v3Fault.freqHz !== undefined && Number.isFinite(v3Fault.freqHz), "Expected finite COI freqHz");
  assert.ok(companionSteps === stepsBefore + 1, "Expected fmi-ls-rms companion doStep to execute");

  // Roll back and re-execute -> must reproduce identical voltage, COI freqHz, and companion state
  phasor.setState(snapBeforeFaultStep);
  assert.equal(companionSteps, stepsBefore, "Expected fmi-ls-rms companion state to roll back");
  const step1Replay = phasor.stepMacro(0.01, 0.005, []);
  const v3Replay = step1Replay.boundaryVoltages.get("3")!;
  assert.ok(Math.abs(v3Replay.voltagePu.pos.re - v3Fault.voltagePu.pos.re) < 1e-12);
  assert.ok(Math.abs(v3Replay.voltagePu.pos.im - v3Fault.voltagePu.pos.im) < 1e-12);
  assert.ok(Math.abs((v3Replay.freqHz ?? 0) - (v3Fault.freqHz ?? 0)) < 1e-12);
});
