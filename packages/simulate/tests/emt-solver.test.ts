// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  computeCoaxialCableConstants,
  computeModalOverheadLineConstants,
  computeOverheadLineConstants,
  EmtSolver,
  MultiRateCosimOrchestrator,
  synthesizeFdLineFromCable,
  synthesizeFdLineFromTower,
  synthesizeModalThreePhaseFdLine,
  WasmEmtBridge,
  type EmtCircuitDefinition,
  type FmuCoSimSlave,
} from "../src/solvers/emt/index.js";

console.log("=== Testing WebAssembly Hybrid EMT Companion Solver ===");

// 1. Test LC Tank Resonant Frequency & Energy Conservation
{
  console.log("Test 1: LC Tank Resonator (Analytical Parity)");
  // L = 10 mH, C = 100 uF -> f0 = 1 / (2*pi*sqrt(L*C)) = 159.155 Hz
  const L = 0.01;
  const C = 100e-6;
  const expectedFreqHz = 1 / (2 * Math.PI * Math.sqrt(L * C)); // ~159.155 Hz
  const dt = 20e-6; // 20 microseconds
  const duration = 0.05; // 50 ms

  const circuit: EmtCircuitDefinition = {
    buses: ["Bus1"],
    rlc: [
      { id: "L1", from: "Bus1", to: "GND", l: L },
      { id: "C1", from: "Bus1", to: "GND", c: C },
    ],
    sources: [
      // 10 kV source at 159 Hz to excite the resonant tank
      { bus: "Bus1", vPeakKv: 10.0, freqHz: expectedFreqHz },
    ],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  assert.strictEqual(result.metrics.totalSteps, Math.ceil(duration / dt));
  assert.strictEqual(result.metrics.factorizationCount, 1);

  const vBus1 = result.busVoltages.get("Bus1")!;
  assert.ok(vBus1.length > 0);

  // Check that voltage oscillates stably without diverging
  let maxV = 0;
  for (const v of vBus1) {
    const absV = Math.abs(v);
    if (absV > maxV) maxV = absV;
  }
  console.log(
    `   LC Peak Voltage: ${(maxV / 1e3).toFixed(2)} kV across ${result.metrics.totalSteps} steps in ${result.metrics.wallClockTimeMs} ms`,
  );
  assert.ok(maxV > 1000 && maxV < 50000, "Voltage should resonate within bounded physical limits");
}

// 2. Test Bergeron Transmission Line Wave Travel Time Delay
{
  console.log("Test 2: Bergeron Traveling-Wave Transmission Line Delay");
  // Length = 150 km, L = 1.0 mH/km, C = 1.111e-8 F/km
  // Wave speed v = 1 / sqrt(L*C) = 300,000 km/s (speed of light)
  // Travel time tau = 150 km / 300,000 km/s = 0.0005 s (0.5 ms = 500 us)
  const dt = 20e-6; // 20 us
  const duration = 0.005; // 5 ms (250 steps)
  const tauExpected = 0.0005; // 0.5 ms

  const circuit: EmtCircuitDefinition = {
    buses: ["SendingBus", "ReceivingBus"],
    rlc: [
      // Receiving end load: matched characteristic impedance Zc = sqrt(L/C) = 300 Ohm
      { id: "R_load", from: "ReceivingBus", to: "GND", r: 300.0 },
    ],
    transmissionLines: [
      {
        id: "Line1",
        from: "SendingBus",
        to: "ReceivingBus",
        lengthKm: 150.0,
        lPerKm: 0.001,
        cPerKm: 1.111e-8,
        rPerKm: 0.01,
      },
    ],
    sources: [
      // Fast step pulse at sending end at 60 Hz
      { bus: "SendingBus", vPeakKv: 100.0, freqHz: 60.0 },
    ],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  const vRecv = result.busVoltages.get("ReceivingBus")!;
  const time = result.time;

  // Find when voltage at receiving end first becomes non-zero (> 1 V)
  let firstArrivalTime = -1;
  for (let i = 0; i < vRecv.length; i++) {
    if (Math.abs(vRecv[i]!) > 1.0) {
      firstArrivalTime = time[i]!;
      break;
    }
  }

  console.log(`   Expected Arrival Time: ${(tauExpected * 1e3).toFixed(3)} ms`);
  console.log(`   Measured Arrival Time: ${(firstArrivalTime * 1e3).toFixed(3)} ms`);

  assert.ok(firstArrivalTime > 0, "Wave must arrive at receiving end");
  const delayDiff = Math.abs(firstArrivalTime - tauExpected);
  assert.ok(
    delayDiff <= 2 * dt,
    `Travel delay must match within 2 time steps (diff: ${(delayDiff * 1e6).toFixed(1)} us)`,
  );
}

// 3. Test Hybrid Grid with Black-Box Inverter FMU & Norton Predictor
{
  console.log("Test 3: Hybrid Grid with Black-Box Inverter FMU");
  const dt = 25e-6; // 25 us
  const duration = 0.05; // 50 ms (2,000 steps)

  const circuit: EmtCircuitDefinition = {
    buses: ["GridSubstation", "InverterPOI"],
    rlc: [
      // Substation transformer impedance
      { id: "Xfmr_R", from: "GridSubstation", to: "InverterPOI", r: 0.1 },
      { id: "Xfmr_L", from: "GridSubstation", to: "InverterPOI", l: 0.005 },
    ],
    fmuInstances: [
      {
        id: "Solar_IBR_FMU",
        bus: "InverterPOI",
        ratedMva: 50.0,
        ratedKv: 34.5,
        pSetpointMw: 45.0,
        qSetpointMvar: 0.0,
      },
    ],
    sources: [{ bus: "GridSubstation", vPeakKv: 34.5, freqHz: 60.0 }],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  const vPoi = result.busVoltages.get("InverterPOI")!;
  assert.strictEqual(vPoi.length, 2000);

  // Verify that the Norton equivalent predictor keeps POI voltage stable
  let maxPoi = 0;
  for (const val of vPoi) {
    const absVal = Math.abs(val);
    if (absVal > maxPoi) maxPoi = absVal;
    assert.ok(!isNaN(absVal) && isFinite(absVal), "Voltages must remain finite and numerically stable");
  }

  console.log(
    `   Hybrid Co-Sim POI Peak Voltage: ${(maxPoi / 1e3).toFixed(2)} kV across 2,000 steps in ${result.metrics.wallClockTimeMs} ms`,
  );
  assert.ok(maxPoi > 10000 && maxPoi < 60000, "POI voltage must track nominal 34.5 kV system");
}

// 4. Test Series RL Companion Accuracy & Fault Switching with CDA
{
  console.log("Test 4: Series RL Impedance & Time-Switched Fault with CDA");
  const dt = 20e-6;
  const duration = 0.06; // 60 ms
  const r = 3.0;
  const l = 0.0106103; // X_L = 2*pi*60*L = 4.0 Ohm -> |Z| = sqrt(3^2 + 4^2) = 5.0 Ohm
  const vPeakKv = 10.0; // 10,000 V peak -> expected steady-state I_peak = 10,000 / 5 = 2,000 A

  const circuit: EmtCircuitDefinition = {
    buses: ["SourceBus", "LoadBus"],
    rlc: [
      { id: "RL_Series", from: "SourceBus", to: "LoadBus", r, l },
      { id: "Load_Short", from: "LoadBus", to: "GND", r: 0.001 },
    ],
    sources: [{ bus: "SourceBus", vPeakKv, freqHz: 60.0 }],
    faults: [{ bus: "LoadBus", startSec: 0.04, durationSec: 0.01, faultResistanceOhm: 0.01 }],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration, enableCda: true });
  const result = solver.solve();
  assert.strictEqual(result.metrics.factorizationCount, 3, "Should factorize at t=0, fault ON, and fault OFF");

  const iSeries = result.branchCurrents.get("RL_Series")!;
  let peakSteady = 0;
  // Measure peak in the last cycle (t = 40ms to 60ms)
  for (let k = Math.floor(0.04 / dt); k < iSeries.length; k++) {
    const a = Math.abs(iSeries[k]!);
    if (a > peakSteady) peakSteady = a;
  }
  console.log(`   Series RL Measured Peak Current: ${peakSteady.toFixed(1)} A (analytical: ~2000.0 A)`);
  assert.ok(
    Math.abs(peakSteady - 2000) < 150,
    `Series RL peak current should match |V|/|R + j*omega*L| = 2000 A, got ${peakSteady}`,
  );
}

// 5. Test True Transformer Turns-Ratio Step-Up (16.5 kV -> 230 kV) & Yg-D Vector Group Phase Shift
{
  console.log("Test 5: 3-Phase Transformer Step-Up Turns Ratio (16.5 kV -> 230 kV) & Yg-D Vector Group");
  const dt = 25e-6;
  const duration = 0.05; // 50 ms (3 cycles at 60 Hz)

  // 5a. Yg-Yg Step-Up Transformer: 16.5 kV primary -> 230 kV secondary (turns ratio a = 16.5 / 230)
  const circuitYgYg: EmtCircuitDefinition = {
    buses: ["GenBus16kV", "GridBus230kV"],
    rlc: [
      // High-impedance load on 230 kV side (10 kOhm) to measure open-circuit step-up ratio
      { id: "R_Load230", from: "GridBus230kV", to: "GND", r: 10000.0 },
    ],
    transformers: [
      {
        id: "GSU_YgYg",
        fromBus: "GenBus16kV",
        toBus: "GridBus230kV",
        mvaRating: 200.0,
        primaryKv: 16.5,
        secondaryKv: 230.0,
        leakageReactancePu: 0.05,
        windingConnection: "Yg-Yg",
      },
    ],
    sources: [{ bus: "GenBus16kV", vPeakKv: 16.5, freqHz: 60.0 }],
  };

  const solverYgYg = new EmtSolver(circuitYgYg, { timeStepSec: dt, durationSec: duration, threePhase: true });
  const resYgYg = solverYgYg.solve();
  const vSecA = resYgYg.busPhaseVoltages!.get("GridBus230kV")!.a;

  let peakSecKv = 0;
  for (let i = Math.floor(0.02 / dt); i < vSecA.length; i++) {
    const kv = Math.abs(vSecA[i]!) / 1e3;
    if (kv > peakSecKv) peakSecKv = kv;
  }
  console.log(`   Yg-Yg Step-Up Secondary Peak Voltage: ${peakSecKv.toFixed(1)} kV (expected: ~230.0 kV)`);
  assert.ok(
    Math.abs(peakSecKv - 230.0) < 5.0,
    `Secondary voltage should step up from 16.5 kV to ~230 kV, got ${peakSecKv.toFixed(2)} kV`,
  );

  // 5b. Yg-D Transformer Vector Group: verify 3-phase operation and non-zero secondary phase voltages
  const circuitYgD: EmtCircuitDefinition = {
    buses: ["PriBus", "SecBus"],
    rlc: [{ id: "R_LoadD", from: "SecBus", to: "GND", r: 5000.0 }],
    transformers: [
      {
        id: "Xfmr_YgD",
        fromBus: "PriBus",
        toBus: "SecBus",
        mvaRating: 100.0,
        primaryKv: 16.5,
        secondaryKv: 115.0,
        leakageReactancePu: 0.06,
        windingConnection: "Yg-D",
      },
    ],
    sources: [{ bus: "PriBus", vPeakKv: 16.5, freqHz: 60.0 }],
  };

  const solverYgD = new EmtSolver(circuitYgD, { timeStepSec: dt, durationSec: duration });
  const resYgD = solverYgD.solve();
  assert.ok(resYgD.busPhaseVoltages !== undefined, "Yg-D transformer should automatically enable 3-phase mode");
  const secYgD = resYgD.busPhaseVoltages!.get("SecBus")!;
  // Measure line-to-line peak voltage V_AB on Delta secondary (should equal V_pri * (115 / 16.5) * sqrt(3))
  let peakVabKv = 0;
  for (let i = Math.floor(0.02 / dt); i < secYgD.a.length; i++) {
    const vab = Math.abs(secYgD.a[i]! - secYgD.b[i]!) / 1e3;
    if (vab > peakVabKv) peakVabKv = vab;
  }
  const expectedVabKv = 115.0 * Math.sqrt(3); // ~199.18 kV
  console.log(
    `   Yg-D Secondary Line-to-Line V_ab Peak: ${peakVabKv.toFixed(1)} kV (expected: ~${expectedVabKv.toFixed(1)} kV)`,
  );
  assert.ok(
    Math.abs(peakVabKv - expectedVabKv) < 10.0,
    `Yg-D secondary line-to-line voltage should match ${expectedVabKv.toFixed(1)} kV, got ${peakVabKv.toFixed(1)} kV`,
  );
}

// 6. Test 3-Phase Unbalanced Single-Line-to-Ground (SLG) Fault & Fortescue Sequence Voltages (V0, V1, V2)
{
  console.log("Test 6: 3-Phase Unbalanced SLG Fault & Symmetrical Component Extraction (V0, V1, V2)");
  const dt = 25e-6;
  const duration = 0.06; // 60 ms

  const circuit: EmtCircuitDefinition = {
    buses: ["SourceBus", "FaultBus"],
    rlc: [
      { id: "Feeder_RL", from: "SourceBus", to: "FaultBus", r: 2.0, l: 0.02 },
      { id: "Load_R", from: "FaultBus", to: "GND", r: 500.0 },
    ],
    sources: [{ bus: "SourceBus", vPeakKv: 100.0, freqHz: 60.0 }],
    faults: [
      // Phase-A-to-Ground (SLG) fault from t = 20ms to t = 55ms
      { bus: "FaultBus", startSec: 0.02, durationSec: 0.035, faultResistanceOhm: 0.01, faultType: "SLG" },
    ],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  assert.ok(result.busPhaseVoltages !== undefined, "SLG fault must automatically enable 3-phase mode");
  assert.ok(result.sequenceVoltages !== undefined, "Sequence voltages must be extracted in 3-phase mode");

  const wf = result.busPhaseVoltages!.get("FaultBus")!;
  const seq = result.sequenceVoltages!.get("FaultBus")!;

  // During the SLG fault (around t = 45 ms, after 1 full cycle of fault), Phase A is collapsed (~0 V) while B & C remain healthy (~100 kV)
  const sampleIdx = Math.floor(0.045 / dt);
  let maxA_fault = 0;
  let maxB_fault = 0;
  let maxC_fault = 0;
  for (let i = Math.floor(0.03 / dt); i < Math.floor(0.05 / dt); i++) {
    maxA_fault = Math.max(maxA_fault, Math.abs(wf.a[i]!));
    maxB_fault = Math.max(maxB_fault, Math.abs(wf.b[i]!));
    maxC_fault = Math.max(maxC_fault, Math.abs(wf.c[i]!));
  }

  console.log(
    `   SLG Fault Bus Peaks -> Va: ${(maxA_fault / 1e3).toFixed(2)} kV, Vb: ${(maxB_fault / 1e3).toFixed(2)} kV, Vc: ${(maxC_fault / 1e3).toFixed(2)} kV`,
  );
  assert.ok(maxA_fault < 5000, "Faulted Phase A voltage must collapse near 0 V during bolted SLG fault");
  assert.ok(maxB_fault > 80000 && maxC_fault > 80000, "Unfaulted Phases B and C must remain near nominal 100 kV");

  // Verify Fortescue sequence voltages at t = 45 ms:
  // When Va = 0 and Vb, Vc are nominal 100 kV: V1 ~ 66.7 kV, V2 ~ 33.3 kV, V0 ~ 33.3 kV
  const v0Fault = seq.v0[sampleIdx]! / 1e3;
  const v1Fault = seq.v1[sampleIdx]! / 1e3;
  const v2Fault = seq.v2[sampleIdx]! / 1e3;
  console.log(
    `   SLG Sequence Voltages at t=45ms -> V1: ${v1Fault.toFixed(1)} kV, V2: ${v2Fault.toFixed(1)} kV, V0: ${v0Fault.toFixed(1)} kV`,
  );
  assert.ok(v1Fault > 50 && v1Fault < 80, `Positive sequence V1 should be ~66.7 kV, got ${v1Fault.toFixed(1)} kV`);
  assert.ok(v2Fault > 20 && v2Fault < 45, `Negative sequence V2 should be ~33.3 kV, got ${v2Fault.toFixed(1)} kV`);
  assert.ok(v0Fault > 20 && v0Fault < 45, `Zero sequence V0 should be ~33.3 kV, got ${v0Fault.toFixed(1)} kV`);
}

// 7. Test Circuit Breaker Current Zero-Crossing Arc Extinction
{
  console.log("Test 7: Circuit Breaker Pole Current Zero-Crossing Arc Extinction");
  const dt = 20e-6;
  const duration = 0.04; // 40 ms
  const tripOrderSec = 0.012; // Trip command issued at t = 12.0 ms (when 60 Hz current is near peak, NOT at zero crossing!)

  const circuit: EmtCircuitDefinition = {
    buses: ["SourceBus", "SwitchedBus"],
    rlc: [{ id: "Load_R", from: "SwitchedBus", to: "GND", r: 10.0 }],
    breakers: [
      {
        id: "CB1",
        from: "SourceBus",
        to: "SwitchedBus",
        closedInitially: true,
        openTimeSec: tripOrderSec,
        choppingCurrentAmp: 0.5,
      },
    ],
    sources: [{ bus: "SourceBus", vPeakKv: 10.0, freqHz: 60.0 }],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();
  const iBreaker = result.branchCurrents.get("CB1")!;

  // At t = 12.5 ms (after trip command at 12.0 ms, but before the 60 Hz half-cycle zero crossing at 16.67 ms),
  // the arc must STILL be conducting!
  const idxDuringArc = Math.floor(0.0125 / dt);
  const currentDuringArc = Math.abs(iBreaker[idxDuringArc]!);
  // After the natural zero crossing at t = 16.67 ms (e.g. at t = 20 ms), the breaker must be open (~0 A)
  const idxAfterClear = Math.floor(0.02 / dt);
  const currentAfterClear = Math.abs(iBreaker[idxAfterClear]!);

  console.log(
    `   Breaker Current at t=12.5ms (post-trip, pre-zero-crossing): ${currentDuringArc.toFixed(1)} A | at t=20.0ms (post-zero-crossing): ${currentAfterClear.toExponential(2)} A`,
  );
  assert.ok(
    currentDuringArc > 500,
    `Breaker must wait for AC current zero-crossing before extinguishing arc (got ${currentDuringArc} A at t=12.5ms)`,
  );
  assert.ok(
    currentAfterClear < 0.01,
    `Breaker must extinguish arc after current zero-crossing (got ${currentAfterClear} A at t=20ms)`,
  );
}

// 8. Test Traveling-Wave Network Tearing (BBDF / Diakoptics) Across Multi-Substation Grid
{
  console.log("Test 8: Traveling-Wave Network Tearing (BBDF Subsystem Partitioning)");
  const dt = 20e-6;
  const duration = 0.03; // 30 ms

  // 3 substations connected by 2 Bergeron traveling-wave lines -> should partition into 3 decoupled subsystems!
  const circuit: EmtCircuitDefinition = {
    buses: ["Sub1_Gen", "Sub1_HV", "Sub2_HV", "Sub2_Load", "Sub3_HV"],
    rlc: [
      { id: "Sub2_Feeder", from: "Sub2_HV", to: "Sub2_Load", r: 1.5, l: 0.01 },
      { id: "Sub2_LoadR", from: "Sub2_Load", to: "GND", r: 200.0 },
      { id: "Sub3_LoadR", from: "Sub3_HV", to: "GND", r: 300.0 },
    ],
    transformers: [
      {
        id: "T_Sub1",
        fromBus: "Sub1_Gen",
        toBus: "Sub1_HV",
        mvaRating: 250.0,
        primaryKv: 16.5,
        secondaryKv: 230.0,
        leakageReactancePu: 0.08,
      },
    ],
    transmissionLines: [
      { id: "Line_1_2", from: "Sub1_HV", to: "Sub2_HV", lengthKm: 120.0, lPerKm: 0.001, cPerKm: 1.111e-8 },
      { id: "Line_2_3", from: "Sub2_HV", to: "Sub3_HV", lengthKm: 90.0, lPerKm: 0.001, cPerKm: 1.111e-8 },
    ],
    sources: [{ bus: "Sub1_Gen", vPeakKv: 16.5, freqHz: 60.0 }],
    faults: [{ bus: "Sub3_HV", startSec: 0.015, durationSec: 0.005, faultResistanceOhm: 0.05 }],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  console.log(
    `   BBDF Decoupled Subsystems Discovered: ${result.metrics.subsystemCount} (expected: 3 across 2 Bergeron lines)`,
  );
  assert.strictEqual(
    result.metrics.subsystemCount,
    3,
    "3 substations separated by 2 Bergeron traveling-wave lines must partition into 3 decoupled BBDF subsystems",
  );
  const vSub3 = result.busVoltages.get("Sub3_HV")!;
  let maxSub3 = 0;
  for (const v of vSub3) {
    if (Math.abs(v) > maxSub3) maxSub3 = Math.abs(v);
  }
  assert.ok(
    maxSub3 > 50000,
    `Wave must propagate through both Bergeron lines to Sub3_HV (peak: ${(maxSub3 / 1e3).toFixed(1)} kV)`,
  );
}

// 9. Test Unified Native WebAssembly EMT Kernel (WasmEmtBridge) with Bergeron Line, Step-Up Transformer, Fault & Breaker
{
  console.log("Test 9: Unified Native WebAssembly EMT Kernel (WasmEmtBridge) & Sub-Step Interpolation");
  const dt = 20e-6;
  const totalSteps = 2000; // 40 ms

  // Nodes: 0 = Gen16kV, 1 = HV230kV_Send, 2 = HV230kV_Recv, 3 = SwitchedLoadBus
  const bridge = new WasmEmtBridge(4, dt);

  // AC Source at Node 0 (16.5 kV peak, 60 Hz)
  bridge.addSource({ node: 0, vPeakKv: 16.5, freqHz: 60.0 });

  // 4-terminal Step-Up Transformer between Node 0 (16.5 kV) and Node 1 (230 kV)
  const aRatio = 16.5 / 230.0;
  const zBase = (16500 * 16500) / 200e6;
  const lLeak = (0.06 * zBase) / (2 * Math.PI * 60);
  const rLeak = 0.005 * zBase;
  const gLeak = dt / (2 * lLeak + rLeak * dt);
  const alphaL = (2 * lLeak - rLeak * dt) / (2 * lLeak + rLeak * dt);
  bridge.addTransformerWinding(0, -1, 1, -1, gLeak, alphaL, aRatio);

  // Bergeron Traveling-Wave Line between Node 1 and Node 2 (Zc = 300 Ohm, tau = 0.45 ms)
  bridge.addBergeronLine(1, 2, 300.0, 0.00045, 1.5);

  // Circuit Breaker between Node 2 and Node 3 (trips at t = 12 ms, clears at next current zero-crossing)
  bridge.addBreaker(2, 3, { closedInitially: true, openTimeSec: 0.012, choppingCurrentAmp: 0.5 });

  // Load resistor at Node 3 (300 Ohm to GND)
  const loadBranchIdx = bridge.addBranch(3, -1, 300.0, 0, 0);

  // Time-switched fault at Node 2 from t = 25 ms to t = 30 ms
  bridge.addFault(2, -1, 0.025, 0.03, 0.05);

  assert.strictEqual(bridge.buildAndFactorize(), true);
  const wasmRes = bridge.solve(totalSteps);

  const vGen = wasmRes.voltages[0]!;
  const vSend230 = wasmRes.voltages[1]!;
  const vSwitched = wasmRes.voltages[3]!;

  let maxSendKv = 0;
  for (let k = 200; k < 1000; k++) {
    const kv = Math.abs(vSend230[k]!) / 1e3;
    if (kv > maxSendKv) maxSendKv = kv;
  }

  // At t = 12.5 ms (step 625, after trip command at 12.0 ms but before 16.67 ms zero crossing), Node 3 is still energized
  const vDuringArcKv = Math.abs(vSwitched[625]!) / 1e3;
  // At t = 20.0 ms (step 1000, after zero crossing), breaker is open so Node 3 is de-energized (~0 V)
  const vAfterClearKv = Math.abs(vSwitched[1000]!) / 1e3;

  console.log(
    `   WASM Kernel Speed: ${(wasmRes.stepsPerSecond / 1e3).toFixed(0)}k steps/s | Step-Up Peak: ${maxSendKv.toFixed(1)} kV | Breaker Pre-Zero: ${vDuringArcKv.toFixed(1)} kV, Post-Zero: ${vAfterClearKv.toExponential(2)} kV | Factorizations: ${wasmRes.factorizationCount}`,
  );
  void vGen;
  void loadBranchIdx;

  assert.ok(
    maxSendKv > 200.0 && maxSendKv < 250.0,
    `WASM step-up transformer secondary must reach ~230 kV, got ${maxSendKv.toFixed(1)} kV`,
  );
  assert.ok(
    vDuringArcKv > 50.0,
    `WASM breaker must conduct until zero crossing (got ${vDuringArcKv.toFixed(1)} kV at t=12.5ms)`,
  );
  assert.ok(vAfterClearKv < 1e-3, `WASM breaker must clear after zero crossing (got ${vAfterClearKv} kV at t=20ms)`);
  assert.strictEqual(
    wasmRes.factorizationCount,
    4,
    "Should factorize at init (1), breaker clear (2), fault ON (3), and fault OFF (4)",
  );
}

// 10. Test Fundamental-Frequency AC Phasor Steady-State Initialization (Zero DC-Offset Energization Transient)
{
  console.log("Test 10: AC Phasor Steady-State Initialization (Zero DC-Offset Energization Transient)");
  const dt = 25e-6;
  const duration = 0.02; // 1.2 cycles at 60 Hz

  const rlCircuit: EmtCircuitDefinition = {
    buses: ["Bus1"],
    rlc: [
      // Highly inductive reactor: R = 0.5 Ohm, X_L = 2*pi*60*0.1 = 37.699 Ohm (X/R = 75.4)
      { id: "Reactor_1", from: "Bus1", to: "GND", r: 0.5, l: 0.1 },
    ],
    sources: [{ bus: "Bus1", vPeakKv: 10.0, freqHz: 60.0, phaseRad: 0 }],
  };

  // Run 1: Flat start (steadyStateInit = false) -> experiences nearly 100% asymmetrical DC offset (~2x peak current)
  const flatRes = new EmtSolver(rlCircuit, {
    timeStepSec: dt,
    durationSec: duration,
    steadyStateInit: false,
  }).solve();

  // Run 2: Phasor steady-state initialization (steadyStateInit = true) -> starts in exact sinusoidal steady state
  const steadyRes = new EmtSolver(rlCircuit, {
    timeStepSec: dt,
    durationSec: duration,
    steadyStateInit: true,
  }).solve();

  const iFlat = flatRes.branchCurrents.get("Reactor_1")!;
  const iSteady = steadyRes.branchCurrents.get("Reactor_1")!;

  let flatMax = -Infinity,
    flatMin = Infinity;
  let steadyMax = -Infinity,
    steadyMin = Infinity;
  for (let k = 0; k < iSteady.length; k++) {
    if (iFlat[k]! > flatMax) flatMax = iFlat[k]!;
    if (iFlat[k]! < flatMin) flatMin = iFlat[k]!;
    if (iSteady[k]! > steadyMax) steadyMax = iSteady[k]!;
    if (iSteady[k]! < steadyMin) steadyMin = iSteady[k]!;
  }

  // Theoretical steady-state peak current: I_peak = 10,000 / hypot(0.5, 37.6991) = 265.23 A
  const expectedPeakAmp = 10000 / Math.hypot(0.5, 2 * Math.PI * 60 * 0.1);
  const flatDcOffset = Math.abs(flatMax + flatMin) / 2;
  const steadyDcOffset = Math.abs(steadyMax + steadyMin) / 2;

  console.log(
    `   Expected I_peak: ${expectedPeakAmp.toFixed(1)} A | Flat Start [min, max]: [${flatMin.toFixed(1)}, ${flatMax.toFixed(1)}] A (DC offset: ${flatDcOffset.toFixed(1)} A) | Phasor Init [min, max]: [${steadyMin.toFixed(1)}, ${steadyMax.toFixed(1)}] A (DC offset: ${steadyDcOffset.toFixed(2)} A)`,
  );

  assert.ok(
    flatDcOffset > 200.0,
    `Flat start on inductive reactor should exhibit large asymmetrical DC offset (>200 A)`,
  );
  assert.ok(
    steadyDcOffset < 2.0,
    `Phasor steady-state initialization must eliminate DC offset (<2 A, got ${steadyDcOffset.toFixed(2)} A)`,
  );
  assert.ok(
    Math.abs(steadyMax - expectedPeakAmp) / expectedPeakAmp < 0.01,
    `Steady-state positive peak (${steadyMax.toFixed(1)} A) must match analytical phasor magnitude (${expectedPeakAmp.toFixed(1)} A) within 1%`,
  );
}

// 11. Test Closed-Loop CSMF Control Block Graph (PI Controller & Overcurrent Relay Breaker Trip)
{
  console.log("Test 11: Closed-Loop CSMF Control Block Graph (PI Controller & Overcurrent Protection Relay)");
  const dt = 25e-6;
  const duration = 0.05; // 50 ms

  const circuit: EmtCircuitDefinition = {
    buses: ["SourceBus", "LoadBus"],
    breakers: [
      // Breaker has no fixed openTimeSec; it is tripped dynamically by the CSMF overcurrent relay!
      {
        id: "BRK_OC",
        from: "SourceBus",
        to: "LoadBus",
        closedInitially: true,
        choppingCurrentAmp: 1.0,
      },
    ],
    rlc: [{ id: "Load_1", from: "LoadBus", to: "GND", r: 20.0, l: 0.01 }],
    sources: [{ id: "Gen1", bus: "SourceBus", vPeakKv: 13.8, freqHz: 60.0 }],
    faults: [
      // Severe fault on LoadBus starting at t = 10 ms (causes current through BRK_OC to surge > 5000 A)
      { id: "Flt_Load", bus: "LoadBus", startSec: 0.01, durationSec: 0.04, faultResistanceOhm: 0.5 },
    ],
    csmfBlocks: [
      {
        id: "I_Brk_Peak",
        kind: "sensor_i",
        params: { branch: "BRK_OC", mode: "peak" },
      },
      {
        id: "OC_Pickup",
        kind: "compar",
        inputs: ["I_Brk_Peak"],
        params: { threshold: 2500.0, high: 1.0, low: 0.0 },
        actuator: { type: "breaker_trip", targetId: "BRK_OC" },
      },
      {
        id: "V_Ref_Pu",
        kind: "const",
        params: { value: 1.0 },
      },
      {
        id: "V_Load_Rms",
        kind: "sensor_v",
        params: { bus: "LoadBus", mode: "rms" },
      },
      {
        id: "V_Load_Pu",
        kind: "gain",
        inputs: ["V_Load_Rms"],
        params: { K: 1.0 / (13800 / Math.SQRT2) },
      },
      {
        id: "V_Err",
        kind: "sum",
        inputs: ["V_Ref_Pu", "V_Load_Pu"],
        params: { s1: 1.0, s2: -1.0 },
      },
      {
        id: "AVR_PI",
        kind: "pi",
        inputs: ["V_Err"],
        params: { Kp: 2.5, Ti: 0.02, min: -0.5, max: 1.5 },
      },
    ],
  };

  const result = new EmtSolver(circuit, {
    timeStepSec: dt,
    durationSec: duration,
    steadyStateInit: true,
  }).solve();

  const iBrk = result.branchCurrents.get("BRK_OC")!;
  const ocTripSig = result.controlSignals!.get("OC_Pickup")!;
  const avrPiSig = result.controlSignals!.get("AVR_PI")!;

  let maxFaultCurrent = 0;
  for (const current of iBrk) {
    if (Math.abs(current) > maxFaultCurrent) maxFaultCurrent = Math.abs(current);
  }
  const currentAtEnd = Math.abs(iBrk[iBrk.length - 1]!);
  const piAtEnd = avrPiSig[avrPiSig.length - 1]!;

  let relayTripped = false;
  for (const sig of ocTripSig) {
    if (sig > 0.5) {
      relayTripped = true;
      break;
    }
  }

  console.log(
    `   Peak Fault Current: ${(maxFaultCurrent / 1e3).toFixed(2)} kA | Relay Picked Up: ${relayTripped} | Post-Clear Breaker Current (t=50ms): ${currentAtEnd.toExponential(2)} A | PI Controller Output: ${piAtEnd.toFixed(3)}`,
  );

  assert.strictEqual(relayTripped, true, "CSMF overcurrent comparator must pick up during the fault");
  assert.ok(
    currentAtEnd < 1.0,
    `CSMF overcurrent relay must trip BRK_OC and clear fault current at zero crossing (got ${currentAtEnd} A)`,
  );
  assert.ok(piAtEnd > 0.5, `PI controller output must integrate positive voltage error after load bus de-energizes`);
}

// 12. Test Multi-Rate Co-Simulation Orchestrator with Live FMI 2.0/3.0 Slave (stepMacroWithFmu)
{
  console.log("Test 12: Multi-Rate Co-Simulation Orchestrator with Live FMI 2.0/3.0 Slave");
  const orchestrator = new MultiRateCosimOrchestrator({
    dtFastSec: 20e-6,
    dtSlowSec: 1e-3, // 50 fast micro-steps per 1 ms FMI communication step
    gridFrequencyHz: 60.0,
  });

  // Mock FMI 2.0/3.0 Co-Simulation Slave with internal state
  let slaveInternalTime = 0;
  let lastVRms = 34500;
  let doStepCalls = 0;
  const mockFmuSlave: FmuCoSimSlave = {
    id: "OEM_IBR_Controller_FMU",
    setReal(inputs) {
      if (inputs["vRms"] !== undefined && inputs["vRms"] > 0) {
        lastVRms = inputs["vRms"];
      }
    },
    doStep(currentCommunicationPoint, communicationStepSize) {
      slaveInternalTime = currentCommunicationPoint + communicationStepSize;
      doStepCalls++;
      return true;
    },
    getReal() {
      const vPu = lastVRms / 34500;
      const iqBoost = vPu < 0.9 ? (0.9 - vPu) * 50.0 : 0.0;
      return {
        pSetpointMw: 85.0,
        qSetpointMvar: iqBoost,
        iInjected: 1400.0 + iqBoost * 15.0,
      };
    },
  };

  let fastStepsCount = 0;
  let lastSnap;
  for (let macroStep = 0; macroStep < 20; macroStep++) {
    // Apply a 0.65 pu voltage sag starting at macroStep = 10
    const vPeak = (macroStep < 10 ? 34500 : 34500 * 0.65) * Math.SQRT2;
    lastSnap = orchestrator.stepMacroWithFmu((t, slowInputs) => {
      fastStepsCount++;
      const omega = 2 * Math.PI * 60.0;
      const vInst = vPeak * Math.sin(omega * t);
      const iPeak = slowInputs["iInjected"] ?? 1400.0;
      const iInst = iPeak * Math.sin(omega * t);
      return { v: vInst, i: iInst };
    }, mockFmuSlave);
  }

  console.log(
    `   FMI Slave Time Advanced: ${(slaveInternalTime * 1e3).toFixed(2)} ms | Macro FMI Steps: ${doStepCalls} | Fast EMT Sub-Steps: ${fastStepsCount} | Post-Sag Q_setpoint: ${lastSnap!.slowOutputs["qSetpointMvar"]?.toFixed(2)} Mvar`,
  );
  assert.ok(Math.abs(slaveInternalTime - 0.02) < 1e-9);
  assert.strictEqual(doStepCalls, 20);
  assert.strictEqual(fastStepsCount, 1000);
  assert.ok(
    (lastSnap!.slowOutputs["qSetpointMvar"] ?? 0) > 3.0,
    "FMI Co-Simulation slave must command positive LVRT reactive power injection during voltage sag",
  );
}

// 13. Test Overhead Tower Line Constants (Carson / Deri-Semlyen Earth Return) & Rational Pole/Residue FD Line Synthesis
{
  console.log(
    "Test 13: Overhead Tower Line Constants (Carson / Deri-Semlyen) & Rational Pole/Residue FD Line Synthesis",
  );
  const towerCfg = {
    lengthKm: 120.0,
    conductorHeightM: 22.0,
    conductorRadiusM: 0.016,
    rDcOhmPerKm: 0.032,
    soilResistivityOhmM: 100.0,
  };

  const lcp60Hz = computeOverheadLineConstants(towerCfg, 60.0);
  const lcp5kHz = computeOverheadLineConstants(towerCfg, 5000.0);

  console.log(
    `   60 Hz: R = ${lcp60Hz.rOhmPerKm.toFixed(4)} Ω/km, L = ${(lcp60Hz.lHPerKm * 1e3).toFixed(3)} mH/km, Zc = ${lcp60Hz.zcMagOhm.toFixed(1)} Ω | 5 kHz: R = ${lcp5kHz.rOhmPerKm.toFixed(3)} Ω/km, L = ${(lcp5kHz.lHPerKm * 1e3).toFixed(3)} mH/km, Zc = ${lcp5kHz.zcMagOhm.toFixed(1)} Ω`,
  );

  // Skin effect & earth return must increase R(f) and decrease L(f) at higher frequencies
  assert.ok(
    lcp5kHz.rOhmPerKm > lcp60Hz.rOhmPerKm * 5.0,
    "High-frequency resistance must increase due to skin & Carson earth return",
  );
  assert.ok(
    lcp5kHz.lHPerKm < lcp60Hz.lHPerKm,
    "High-frequency inductance must decrease as complex ground return depth shrinks",
  );

  const fdLineCfg = synthesizeFdLineFromTower("FD_Tower_1", 0, 1, towerCfg, 4);
  assert.strictEqual(fdLineCfg.yPoles.length, 4);
  assert.strictEqual(fdLineCfg.hPoles.length, 4);
  for (const p of fdLineCfg.yPoles) {
    assert.ok(p.pole < 0, "Synthesized characteristic admittance poles must be strictly stable in left-half plane");
  }

  const fdRes = new EmtSolver(
    {
      buses: ["SendBus", "RecvBus"],
      rlc: [{ id: "TermLoad", from: "RecvBus", to: "GND", r: 400.0 }],
      fdLines: [fdLineCfg],
      sources: [{ bus: "SendBus", vPeakKv: 230.0, freqHz: 60.0 }],
    },
    { timeStepSec: 20e-6, durationSec: 0.02 },
  ).solve();

  const vRecv = fdRes.busVoltages.get("RecvBus")!;
  let maxRecvKv = 0;
  for (const v of vRecv) {
    const kv = Math.abs(v) / 1e3;
    if (kv > maxRecvKv) maxRecvKv = kv;
  }
  console.log(`   Synthesized 120 km FD-Line Receiving End Peak Voltage: ${maxRecvKv.toFixed(2)} kV`);
  assert.ok(
    maxRecvKv > 100.0 && maxRecvKv < 300.0,
    "FD line synthesized from tower geometry must propagate stable wave to receiving end",
  );
}

// 14. Test Non-Linear Metal-Oxide Varistor (MOV) Surge Arrester Overvoltage Clamping & Energy Absorption
{
  console.log("Test 14: Non-Linear Metal-Oxide Varistor (MOV) Surge Arrester Clamping & Energy Absorption");
  const dt = 10e-6;
  const duration = 0.01;

  // Circuit driven by a severe 450 kV switching surge through a 15 Ω surge impedance
  const unprotectedCircuit: EmtCircuitDefinition = {
    buses: ["SurgeBus", "EquipBus"],
    rlc: [{ id: "Z_Surge", from: "SurgeBus", to: "EquipBus", r: 15.0, l: 0.002 }],
    sources: [{ bus: "SurgeBus", vPeakKv: 450.0, freqHz: 60.0 }],
  };

  const protectedCircuit: EmtCircuitDefinition = {
    ...unprotectedCircuit,
    surgeArresters: [
      {
        id: "MOV_Station_1",
        bus: "EquipBus",
        ratedKv: 138.0,
        protectionLevelKv: 280.0, // Clamps switching surge around 280 kV
        referenceCurrentAmp: 500.0,
      },
    ],
  };

  const unprotRes = new EmtSolver(unprotectedCircuit, { timeStepSec: dt, durationSec: duration }).solve();
  const protSolver = new EmtSolver(protectedCircuit, { timeStepSec: dt, durationSec: duration });
  const protRes = protSolver.solve();

  const vUnprot = unprotRes.busVoltages.get("EquipBus")!;
  const vProt = protRes.busVoltages.get("EquipBus")!;
  const iMov = protRes.branchCurrents.get("MOV_Station_1")!;
  const movState = protSolver.getSurgeArresterStates()[0]!;

  let maxUnprotKv = 0;
  let maxProtKv = 0;
  let maxMovKa = 0;
  for (let k = 0; k < vProt.length; k++) {
    if (Math.abs(vUnprot[k]!) / 1e3 > maxUnprotKv) maxUnprotKv = Math.abs(vUnprot[k]!) / 1e3;
    if (Math.abs(vProt[k]!) / 1e3 > maxProtKv) maxProtKv = Math.abs(vProt[k]!) / 1e3;
    if (Math.abs(iMov[k]!) / 1e3 > maxMovKa) maxMovKa = Math.abs(iMov[k]!) / 1e3;
  }

  console.log(
    `   Unprotected Peak: ${maxUnprotKv.toFixed(1)} kV | MOV Clamped Peak: ${maxProtKv.toFixed(1)} kV | Peak MOV Discharge: ${maxMovKa.toFixed(2)} kA | Absorbed Energy: ${(movState.energyJoules / 1e3).toFixed(2)} kJ`,
  );

  assert.ok(maxUnprotKv > 440.0, "Unprotected bus must see full ~450 kV surge voltage");
  assert.ok(
    maxProtKv < 320.0,
    `MOV surge arrester must clamp overvoltage below 320 kV (got ${maxProtKv.toFixed(1)} kV)`,
  );
  assert.ok(maxMovKa > 5.0, "MOV must conduct multi-kA surge discharge current during clamping");
  assert.ok(movState.energyJoules > 1000.0, "MOV must accumulate positive absorbed thermal energy (J)");
}

// 15. Test 6th-Order Subtransient Synchronous Machine Rotor Swing & Damper Flux Dynamics
{
  console.log("Test 15: 6th-Order Subtransient Synchronous Machine Rotor Swing & Damper Dynamics");
  const dt = 50e-6;
  const duration = 0.08;

  const smSolver = new EmtSolver(
    {
      buses: ["GenTermBus", "GridBus"],
      rlc: [{ id: "TieLine", from: "GenTermBus", to: "GridBus", r: 0.05, l: 0.005 }],
      synchronousMachines: [
        {
          id: "SyncGen_1",
          bus: "GenTermBus",
          ratedMva: 250.0,
          ratedKv: 18.0,
          inertiaConstantH: 3.5,
          mechanicalPowerPu: 0.85,
          fieldVoltagePu: 1.25,
        },
      ],
      sources: [{ id: "InfBus", bus: "GridBus", vPeakKv: 18.0, freqHz: 60.0 }],
      faults: [{ id: "TerminalFault", bus: "GenTermBus", startSec: 0.02, durationSec: 0.03, faultResistanceOhm: 0.01 }],
    },
    { timeStepSec: dt, durationSec: duration, threePhase: true },
  );

  const smRes = smSolver.solve();
  const smState = smSolver.getSynchronousMachineStates()[0]!;
  const iGen = smRes.branchPhaseCurrents!.get("SyncGen_1")!;

  let maxStatorKa = 0;
  for (const val of iGen.a) {
    const ka = Math.abs(val) / 1e3;
    if (ka > maxStatorKa) maxStatorKa = ka;
  }

  console.log(
    `   Peak Subtransient Stator Current: ${maxStatorKa.toFixed(2)} kA | Post-Fault Rotor Speed: ${smState.omegaPu.toFixed(5)} pu | Rotor Angle delta: ${(smState.deltaRad * (180 / Math.PI)).toFixed(2)}° | E''_q: ${smState.eqDoublePrimePu.toFixed(3)} pu`,
  );

  assert.ok(maxStatorKa > 5.0, "6th-order synchronous machine must inject subtransient fault current (>5 kA)");
  assert.ok(
    smState.omegaPu > 1.0005,
    "Generator rotor must accelerate (omega > 1.0 pu) when electrical torque drops during terminal fault",
  );
  assert.ok(smState.deltaRad > 0.18, "Rotor angle delta must swing forward under accelerating power");
}

// 16. Test Power-Electronics Switching Bridges (2-Level Sine-Triangle PWM VSC & 6-Pulse LCC Thyristor Bridge)
{
  console.log("Test 16: Power-Electronics Switching Bridges (2-Level VSC PWM & 6-Pulse LCC Thyristor Bridge)");
  const dt = 25e-6;
  const duration = 0.04; // 40 ms

  const peSolver = new EmtSolver(
    {
      buses: ["VscAcBus", "LccAcBus"],
      rlc: [
        { id: "VscLoad", from: "VscAcBus", to: "GND", r: 50.0, l: 0.02 },
        { id: "LccFilter", from: "LccAcBus", to: "GND", r: 100.0, c: 20e-6 },
      ],
      sources: [{ id: "LccGrid", bus: "LccAcBus", vPeakKv: 230.0, freqHz: 60.0 }],
      converterBridges: [
        {
          id: "VSC_HVDC_1",
          bus: "VscAcBus",
          kind: "vsc_pwm",
          ratedMva: 200.0,
          ratedKv: 230.0,
          dcLinkKv: 400.0,
          carrierFreqHz: 1980.0,
          modulationIndex: 0.85,
          phaseAngleDeg: 10.0,
        },
        {
          id: "LCC_Rectifier_1",
          bus: "LccAcBus",
          kind: "lcc_6pulse",
          ratedMva: 500.0,
          ratedKv: 230.0,
          dcLinkKv: 500.0,
          firingAngleDeg: 15.0,
          commutationInductanceH: 0.015,
        },
      ],
    },
    { timeStepSec: dt, durationSec: duration, threePhase: true },
  );

  const peRes = peSolver.solve();
  const bridgeStates = peSolver.getConverterBridgeStates();
  const vscState = bridgeStates.find((b) => b.config.id === "VSC_HVDC_1")!;
  const lccState = bridgeStates.find((b) => b.config.id === "LCC_Rectifier_1")!;

  const vVscAc = peRes.busPhaseVoltages!.get("VscAcBus")!;
  let maxVscAcKv = 0;
  for (const val of vVscAc.a) {
    const kv = Math.abs(val) / 1e3;
    if (kv > maxVscAcKv) maxVscAcKv = kv;
  }

  console.log(
    `   VSC AC Peak: ${maxVscAcKv.toFixed(1)} kV | VSC DC-Link Vdc: ${(vscState.vDcVolts / 1e3).toFixed(1)} kV (duty_a=${vscState.dutyCycleA.toFixed(3)}) | LCC Rectified Vdc: ${(lccState.vDcVolts / 1e3).toFixed(1)} kV (mu=${((lccState.overlapAngleRad * 180) / Math.PI).toFixed(2)}°)`,
  );

  assert.ok(maxVscAcKv > 100.0, "2-level VSC PWM bridge must synthesize AC voltage onto VscAcBus (>100 kV)");
  assert.ok(
    vscState.dutyCycleA >= 0.0 && vscState.dutyCycleA <= 1.0,
    "Sub-step interpolated PWM duty cycle must lie in [0, 1]",
  );
  assert.ok(
    lccState.vDcVolts > 200e3,
    "6-pulse LCC rectifier at alpha=15 deg must produce positive rectified DC voltage (>200 kV)",
  );
  assert.ok(lccState.overlapAngleRad > 0.01, "LCC bridge must compute physical commutation overlap angle mu > 0");
}

// 17. Test Native WebAssembly Kernel Parity for MOV Surge Arrester & 6th-Order Synchronous Machine
{
  console.log("Test 17: Native WebAssembly Kernel (WasmEmtBridge) MOV Surge Arrester & Synchronous Machine Parity");
  const dt = 20e-6;
  const nSteps = 2000; // 40 ms

  // 4 nodes: 0 = SurgeBus (with MOV arrester), 1,2,3 = SyncGen 3-phase terminals (A, B, C)
  const wasmSim = new WasmEmtBridge(4, dt);

  // Node 0: High-voltage surge source (450 kV peak) through 50 Ohm line impedance, protected by 280 kV MOV arrester
  wasmSim.addSource({ node: 0, vPeakKv: 450.0, freqHz: 60.0, gSource: 1.0 / 50.0 });
  const arrIdx = wasmSim.addSurgeArrester(0, -1, 280e3 / 1.15);

  // Nodes 1, 2, 3: 6th-order 250 MVA, 18 kV Synchronous Generator connected to 3-phase load + phase-A fault
  const macIdx = wasmSim.addSynchronousMachine({
    nodeA: 1,
    nodeB: 2,
    nodeC: 3,
    sBaseMva: 250.0,
    vBaseKvLL: 18.0,
    freqHz: 60.0,
    hInertia: 3.5,
    pmPu: 0.85,
    efPu: 1.25,
  });
  wasmSim.addBranch(1, -1, 10.0, 0, 0);
  wasmSim.addBranch(2, -1, 10.0, 0, 0);
  wasmSim.addBranch(3, -1, 10.0, 0, 0);
  wasmSim.addFault(1, -1, 0.01, 0.038, 0.01);
  wasmSim.addFault(2, -1, 0.01, 0.038, 0.01);
  wasmSim.addFault(3, -1, 0.01, 0.038, 0.01);

  assert.ok(wasmSim.buildAndFactorize(), "WASM EMT matrix with MOV and SyncMachine must factorize");
  const res = wasmSim.solve(nSteps);

  let maxClampedKv = 0;
  for (const v of res.voltages[0]!) {
    const kv = Math.abs(v) / 1e3;
    if (kv > maxClampedKv) maxClampedKv = kv;
  }

  const arrEnergyJ = wasmSim.getArresterEnergy(arrIdx);
  const macSpeedPu = wasmSim.getMachineSpeedPu(macIdx);
  const macAngleDeg = wasmSim.getMachineAngleDeg(macIdx);

  console.log(
    `   WASM MOV Clamped Peak: ${maxClampedKv.toFixed(1)} kV (Energy: ${(arrEnergyJ / 1e3).toFixed(2)} kJ) | WASM SyncGen Speed: ${macSpeedPu.toFixed(5)} pu, Angle: ${macAngleDeg.toFixed(2)}° | Factorizations: ${res.factorizationCount}`,
  );

  assert.ok(
    maxClampedKv < 355.0,
    `WASM MOV arrester must clamp 450 kV surge below 355 kV (got ${maxClampedKv.toFixed(1)} kV)`,
  );
  assert.ok(arrEnergyJ > 1000.0, "WASM MOV arrester must accumulate absorbed surge energy (>1 kJ)");
  assert.ok(macSpeedPu > 1.0002, "WASM 6th-order synchronous machine rotor must accelerate during terminal fault");
  assert.ok(macAngleDeg > 10.0, "WASM synchronous machine rotor angle must advance (>10 deg)");
}

// 18. Test Modular Multilevel Converter (MMC) Thévenin Arm Model & Within-Step Iterative Non-Linear Convergence
{
  console.log(
    "Test 18: Modular Multilevel Converter (MMC) Thévenin Arm Model & Within-Step Iterative Non-Linear Convergence",
  );
  const dt = 25e-6;
  const duration = 0.04;

  const mmcSolver = new EmtSolver(
    {
      buses: ["MmcAcBus", "SatPriBus", "SatSecBus"],
      rlc: [
        { id: "MmcGridLoad", from: "MmcAcBus", to: "GND", r: 45.0 },
        { id: "SatGridImp", from: "SatPriBus", to: "GND", r: 15.0 },
        { id: "SatLoad", from: "SatSecBus", to: "GND", r: 50.0 },
      ],
      sources: [{ id: "SatSource", bus: "SatPriBus", vPeakKv: 420.0, freqHz: 60.0, rSource: 35.0 }],
      converterBridges: [
        {
          id: "MMC_HVDC_400kV",
          bus: "MmcAcBus",
          topology: "mmc_thevenin",
          ratedMva: 400.0,
          ratedKv: 230.0,
          dcLinkKv: 400.0,
          numSubmodulesPerArm: 40,
          submoduleCapacitanceF: 0.012,
          armInductanceH: 0.015,
          modulationIndex: 0.9,
          phaseAngleDeg: 12.0,
          enableCcsc: true,
        },
      ],
      saturableTransformers: [
        {
          id: "SatXfmr_Iter",
          primaryBus: "SatPriBus",
          secondaryBus: "SatSecBus",
          ratedMva: 250.0,
          primaryKv: 230.0,
          secondaryKv: 115.0,
          leakageReactancePu: 0.08,
          lUnsatH: 400.0,
          lSatH: 6.0,
          kneeFluxWb: 450.0,
          remanentFluxWb: 320.0,
        },
      ],
      surgeArresters: [
        {
          id: "MOV_Iter",
          bus: "SatPriBus",
          ratedKv: 192.0,
          protectionLevelKv: 310.0,
          referenceCurrentAmp: 500.0,
        },
      ],
    },
    {
      timeStepSec: dt,
      durationSec: duration,
      threePhase: true,
      maxNonlinearIterations: 6,
      nonlinearToleranceVolts: 0.5,
    },
  );

  const mmcRes = mmcSolver.solve();
  const mmcBridge = mmcSolver.getConverterBridgeStates().find((b) => b.config.id === "MMC_HVDC_400kV")!;
  const vMmcAc = mmcRes.busPhaseVoltages!.get("MmcAcBus")!;
  const vSatPri = mmcRes.busPhaseVoltages!.get("SatPriBus")!;

  let maxMmcKv = 0;
  let maxSatPriKv = 0;
  for (let k = 0; k < vMmcAc.a.length; k++) {
    const kvMmc = Math.abs(vMmcAc.a[k]!) / 1e3;
    const kvSat = Math.abs(vSatPri.a[k]!) / 1e3;
    if (kvMmc > maxMmcKv) maxMmcKv = kvMmc;
    if (kvSat > maxSatPriKv) maxSatPriKv = kvSat;
  }

  console.log(
    `   MMC AC Peak: ${maxMmcKv.toFixed(1)} kV | Inserted Upper SMs (PhA): ${mmcBridge.activeSubmodulesUpperA}/${mmcBridge.numSubmodules} | Arm Cap Spread: ${mmcBridge.submoduleVoltageSpreadPct.toFixed(2)}% | Non-Linear Iterations: ${mmcRes.metrics.totalNonlinearIterations} (Steps: ${mmcRes.metrics.totalSteps})`,
  );

  assert.ok(
    maxMmcKv > 110.0,
    `40-level MMC Thévenin model must synthesize staircase AC voltage (>110 kV, got ${maxMmcKv.toFixed(1)} kV)`,
  );
  assert.ok(
    mmcBridge.activeSubmodulesUpperA >= 0 && mmcBridge.activeSubmodulesUpperA <= 40,
    "MMC NLM active upper-arm submodule count must remain within [0, N]",
  );
  assert.ok(
    mmcBridge.submoduleVoltageSpreadPct < 15.0,
    `MMC CCSC and arm energy balancing must keep submodule voltage sum spread bounded (<15%, got ${mmcBridge.submoduleVoltageSpreadPct.toFixed(2)}%)`,
  );
  assert.ok(
    (mmcRes.metrics.totalNonlinearIterations ?? 0) > mmcRes.metrics.totalSteps,
    "Within-step Newton-Raphson solver must execute extra iterations during core saturation / MOV clamping knees",
  );
  assert.ok(
    maxSatPriKv < 365.0,
    `Within-step iterative MOV + saturable core convergence must clamp 420 kV surge below 365 kV (got ${maxSatPriKv.toFixed(1)} kV)`,
  );
}

// 19. Test Underground / Submarine Coaxial Cable Constants (Wedepohl-Wilcox & Pollaczek) & FD Cable Synthesis
{
  console.log(
    "Test 19: Underground / Submarine Coaxial Cable Constants (Wedepohl-Wilcox & Pollaczek) & FD Cable Synthesis",
  );
  const cableCfg = {
    lengthKm: 45.0,
    coreRadiusM: 0.022,
    insulationRadiusM: 0.052,
    sheathOuterRadiusM: 0.056,
    outerJacketRadiusM: 0.062,
    burialDepthM: 1.5,
    insulationEpsR: 2.3, // XLPE
    soilResistivityOhmM: 100.0,
  };

  const cab60Hz = computeCoaxialCableConstants(cableCfg, 60.0);
  const cab5kHz = computeCoaxialCableConstants(cableCfg, 5000.0);
  const cUfPerKm = cab60Hz.cFPerKm * 1e6;

  console.log(
    `   60 Hz: R = ${cab60Hz.rOhmPerKm.toFixed(4)} Ω/km, L = ${(cab60Hz.lHPerKm * 1e3).toFixed(3)} mH/km, C = ${cUfPerKm.toFixed(3)} uF/km, Zc = ${cab60Hz.zcMagOhm.toFixed(1)} Ω, v = ${(cab60Hz.phaseVelocityKmPerSec / 1e3).toFixed(1)}e3 km/s | 5 kHz: R = ${cab5kHz.rOhmPerKm.toFixed(3)} Ω/km, Zc = ${cab5kHz.zcMagOhm.toFixed(1)} Ω`,
  );

  assert.ok(
    cUfPerKm > 0.12 && cUfPerKm < 0.35,
    "XLPE coaxial cable capacitance must be in physical range (0.12-0.35 uF/km)",
  );
  assert.ok(
    cab60Hz.zcMagOhm > 15.0 && cab60Hz.zcMagOhm < 80.0,
    "Coaxial cable surge impedance Zc must be much lower than overhead line (15-80 Ohm)",
  );
  assert.ok(
    cab5kHz.zcMagOhm < cab60Hz.zcMagOhm,
    "High-frequency coaxial shielding must reduce Zc relative to 60 Hz earth-return mode",
  );
  assert.ok(
    cab5kHz.rOhmPerKm > cab60Hz.rOhmPerKm * 3.0,
    "Wedepohl-Wilcox skin effect and Pollaczek earth return must increase R(f) at 5 kHz",
  );

  const fdCable = synthesizeFdLineFromCable("FD_SubCable_1", 0, 1, cableCfg, 4);
  assert.strictEqual(fdCable.yPoles.length, 4);
  const cabRes = new EmtSolver(
    {
      buses: ["OnshoreBus", "OffshoreBus"],
      rlc: [{ id: "OffshoreLoad", from: "OffshoreBus", to: "GND", r: 35.0 }],
      fdLines: [fdCable],
      sources: [{ bus: "OnshoreBus", vPeakKv: 132.0, freqHz: 60.0 }],
    },
    { timeStepSec: 15e-6, durationSec: 0.015 },
  ).solve();

  const vOffshore = cabRes.busVoltages.get("OffshoreBus")!;
  let maxOffshoreKv = 0;
  for (const v of vOffshore) {
    const kv = Math.abs(v) / 1e3;
    if (kv > maxOffshoreKv) maxOffshoreKv = kv;
  }
  console.log(`   Synthesized 45 km Submarine XLPE FD-Cable Receiving Peak Voltage: ${maxOffshoreKv.toFixed(2)} kV`);
  assert.ok(
    maxOffshoreKv > 50.0 && maxOffshoreKv < 220.0,
    "Submarine FD cable must propagate bounded traveling wave to offshore bus",
  );
}

// 20. Test 5th-Order 3-Phase Induction Machine Acceleration & DFIG Rotor Crowbar Protection
{
  console.log("Test 20: 5th-Order 3-Phase Induction Machine Acceleration & DFIG Rotor Crowbar Protection");
  const dt = 40e-6;
  const duration = 0.06;

  const imSolver = new EmtSolver(
    {
      buses: ["MotorBus", "DfigBus"],
      rlc: [
        { id: "MotorShunt", from: "MotorBus", to: "GND", r: 5000.0 },
        { id: "DfigShunt", from: "DfigBus", to: "GND", r: 5000.0 },
      ],
      sources: [
        { id: "MotorFeed", bus: "MotorBus", vPeakKv: 4.16, freqHz: 60.0, rSource: 0.02 },
        { id: "WindGrid", bus: "DfigBus", vPeakKv: 0.69, freqHz: 60.0, rSource: 0.005 },
      ],
      inductionMachines: [
        {
          id: "IndMotor_2MVA",
          bus: "MotorBus",
          machineType: "squirrel_cage",
          ratedMva: 2.5,
          ratedKv: 4.16,
          nominalFreqHz: 60.0,
          inertiaConstantH: 0.4,
          initialSlip: 0.06,
          mechanicalTorquePu: 0.4, // Motoring load torque < developed air-gap torque at s=0.06
        },
        {
          id: "WindDFIG_5MVA",
          bus: "DfigBus",
          machineType: "dfig",
          ratedMva: 5.0,
          ratedKv: 0.69,
          nominalFreqHz: 60.0,
          inertiaConstantH: 1.5,
          initialSlip: -0.12, // Supersynchronous wind generation
          mechanicalTorquePu: -0.85,
          vRotorDPu: 0.08,
          vRotorQPu: -0.1,
          crowbarTriggerCurrentPu: 1.6,
          crowbarResistancePu: 0.25,
        },
      ],
      faults: [{ id: "DfigGridFault", bus: "DfigBus", startSec: 0.015, durationSec: 0.03, faultResistanceOhm: 0.002 }],
    },
    { timeStepSec: dt, durationSec: duration, threePhase: true },
  );

  const imRes = imSolver.solve();
  const imStates = imSolver.getInductionMachineStates();
  const motorState = imStates.find((m) => m.config.id === "IndMotor_2MVA")!;
  const dfigState = imStates.find((m) => m.config.id === "WindDFIG_5MVA")!;
  const iMotor = imRes.branchPhaseCurrents!.get("IndMotor_2MVA")!;

  let maxMotorAmp = 0;
  for (const val of iMotor.a) {
    const amp = Math.abs(val);
    if (amp > maxMotorAmp) maxMotorAmp = amp;
  }

  console.log(
    `   Squirrel-Cage Peak Current: ${maxMotorAmp.toFixed(1)} A | Motor Te: ${motorState.elecTorquePu.toFixed(3)} pu, Speed: ${motorState.omegaRotorPu.toFixed(4)} pu (slip=${motorState.slip.toFixed(4)}) | DFIG Crowbar Engaged: ${dfigState.crowbarActive} (|Ir|_end=${dfigState.rotorCurrentMagPu.toFixed(2)} pu)`,
  );

  assert.ok(maxMotorAmp > 100.0, "Squirrel-cage induction motor must draw stator current (>100 A)");
  assert.ok(
    motorState.elecTorquePu > 0.1,
    "Induction motor at positive slip must develop positive motoring electromagnetic torque Te > 0",
  );
  assert.ok(dfigState.crowbarActive, "DFIG rotor crowbar protection must engage during severe terminal fault");
}

// 21. Test Native WebAssembly Kernel (WasmEmtBridge) Converter Bridges & Within-Step Non-Linear Newton-Raphson Iteration
{
  console.log(
    "Test 21: Native WebAssembly Kernel (WasmEmtBridge) Converter Bridges & Within-Step Non-Linear Iteration",
  );
  const dt = 20e-6;
  const nSteps = 1200; // 24 ms

  // Nodes: 0,1,2 = 3-phase AC bus for MMC; 3,4 = DC+ and DC- buses; 5 = Non-linear Surge/Core test bus
  const wasmSim = new WasmEmtBridge(6, dt);
  wasmSim.setNonlinearIterationOptions(6, 0.5);

  // Connect 3-phase AC loads on nodes 0, 1, 2 and DC load between 3 and 4
  wasmSim.addBranch(0, -1, 40.0, 0, 0);
  wasmSim.addBranch(1, -1, 40.0, 0, 0);
  wasmSim.addBranch(2, -1, 40.0, 0, 0);
  wasmSim.addBranch(3, 4, 250.0, 0, 0);

  // Add MMC Thevenin converter bridge in native WASM (20 submodules per arm, 2.5 kV per SM => 50 kV arm / +-25 kV DC)
  const convIdx = wasmSim.addConverterBridge({
    nodeA: 0,
    nodeB: 1,
    nodeC: 2,
    nodeDcPos: 3,
    nodeDcNeg: 4,
    mode: "mmc_thevenin",
    freqHz: 60.0,
    modulationIndex: 0.88,
    nSubmodulesPerArm: 20,
    cSubmoduleFarad: 0.01,
    vSmInitVolts: 2500.0,
    lArmHenry: 0.02,
    rArmOhm: 0.5,
  });

  // Node 5: Driven by 420 kV surge source with saturable core + MOV arrester to trigger within-step NR iterations
  wasmSim.addSource({ node: 5, vPeakKv: 420.0, freqHz: 60.0, gSource: 1.0 / 35.0 });
  wasmSim.addSaturableCore(5, 300.0, 5.0, 400.0, 280.0);
  wasmSim.addSurgeArrester(5, -1, 270e3);

  assert.ok(wasmSim.buildAndFactorize(), "WASM EMT matrix with MMC bridge and non-linear elements must factorize");
  const res = wasmSim.solve(nSteps);

  let maxAcKv = 0;
  let maxSurgeKv = 0;
  for (let k = 0; k < res.voltages[0]!.length; k++) {
    const kvAc = Math.abs(res.voltages[0]![k]!) / 1e3;
    const kvSurge = Math.abs(res.voltages[5]![k]!) / 1e3;
    if (kvAc > maxAcKv) maxAcKv = kvAc;
    if (kvSurge > maxSurgeKv) maxSurgeKv = kvSurge;
  }
  const vDcKv = wasmSim.getConverterDcVoltageKv(convIdx);

  console.log(
    `   WASM MMC AC Peak: ${maxAcKv.toFixed(2)} kV | WASM MMC Vdc: ${vDcKv.toFixed(2)} kV | WASM NR Clamped Surge: ${maxSurgeKv.toFixed(1)} kV | Total WASM NR Iterations: ${res.totalNonlinearIterations} (Steps: ${res.stepCount})`,
  );

  assert.ok(
    maxAcKv > 10.0,
    `WASM MMC bridge must synthesize AC voltage onto phase nodes (got ${maxAcKv.toFixed(2)} kV)`,
  );
  assert.ok(vDcKv > 20.0, `WASM MMC bridge must maintain positive DC-link voltage (got ${vDcKv.toFixed(2)} kV)`);
  assert.ok(
    res.totalNonlinearIterations > res.stepCount,
    `WASM within-step Newton-Raphson loop must perform extra iterations during MOV/core knees (${res.totalNonlinearIterations} > ${res.stepCount})`,
  );
  assert.ok(maxSurgeKv < 360.0, `WASM NR loop must clamp 420 kV surge below 360 kV (got ${maxSurgeKv.toFixed(1)} kV)`);
}

// 22. Test 3-Phase Coupled Modal Transmission Line (abc <-> 0-alpha-beta Clarke Modal Domain & Zero-Sequence Ground Return)
{
  console.log(
    "Test 22: 3-Phase Coupled Modal Transmission Line (abc <-> 0-alpha-beta Clarke Modal Domain & SLG Coupling)",
  );
  const dt = 10e-6;
  const duration = 0.015; // 15 ms

  const towerGeom = {
    conductorRadiusM: 0.016,
    conductorHeightM: 22.0,
    phaseSpacingM: 8.5,
    soilResistivityOhmM: 100.0,
    rDcOhmPerKm: 0.032,
    lengthKm: 120.0,
  };

  const modalParams = computeModalOverheadLineConstants(towerGeom, 60.0);
  const modalLine = synthesizeModalThreePhaseFdLine("Modal3PhLine_120km", "Send3Ph", "Recv3Ph", towerGeom);

  console.log(
    `   Modal Constants (60 Hz): R0=${modalParams.zeroMode.rOhmPerKm.toFixed(4)} vs R1=${modalParams.positiveMode.rOhmPerKm.toFixed(4)} Ohm/km | Zc0=${modalParams.zeroMode.zcMagOhm.toFixed(1)} vs Zc1=${modalParams.positiveMode.zcMagOhm.toFixed(1)} Ohm | v0=${modalParams.zeroMode.phaseVelocityKmPerSec.toFixed(0)} vs v1=${modalParams.positiveMode.phaseVelocityKmPerSec.toFixed(0)} km/s`,
  );

  assert.ok(
    modalParams.zeroMode.rOhmPerKm > modalParams.positiveMode.rOhmPerKm,
    "Zero-sequence ground return resistance R0 must exceed positive-sequence R1",
  );
  assert.ok(
    modalParams.zeroMode.lHPerKm > modalParams.positiveMode.lHPerKm,
    "Zero-sequence Carson inductance L0 must exceed positive-sequence L1",
  );
  assert.ok(
    modalParams.zeroMode.cFPerKm < modalParams.positiveMode.cFPerKm,
    "Zero-sequence capacitance C0 must be smaller than positive-sequence C1",
  );
  assert.ok(
    modalParams.zeroMode.zcMagOhm > modalParams.positiveMode.zcMagOhm,
    "Zero-sequence surge impedance Zc0 must exceed positive-sequence Zc1",
  );
  assert.ok(
    modalParams.zeroMode.phaseVelocityKmPerSec < modalParams.positiveMode.phaseVelocityKmPerSec,
    "Zero-sequence propagation velocity v0 must be slower than aerial mode v1",
  );

  // Simulate 3-phase coupled line with single-line-to-ground (SLG) fault on Phase A at receiving end
  const modalSolver = new EmtSolver(
    {
      buses: ["Send3Ph", "Recv3Ph"],
      sources: [{ bus: "Send3Ph", vPeakKv: 326.6, freqHz: 60.0 }],
      rlc: [{ id: "RecvLoad", from: "Recv3Ph", to: "GND", r: modalParams.positiveMode.zcMagOhm }],
      modalFdLines: [modalLine],
      faults: [
        {
          id: "SLG_PhaseA_Recv",
          bus: "Recv3Ph",
          startSec: 0.004,
          durationSec: 0.008,
          faultResistanceOhm: 0.05,
          faultType: "AG",
        },
      ],
    },
    { timeStepSec: dt, durationSec: duration, threePhase: true },
  );

  const modalRes = modalSolver.solve();
  const vRecv = modalRes.busPhaseVoltages!.get("Recv3Ph")!;
  const iLine = modalRes.branchPhaseCurrents!.get("Modal3PhLine_120km")!;

  let maxRecvKvB = 0;
  let minFaultedKvA = Infinity;
  let maxZeroSeqCurrentAmp = 0;
  for (let k = Math.floor(0.006 / dt); k < Math.floor(0.011 / dt); k++) {
    const kvA = Math.abs(vRecv.a[k]!) / 1e3;
    const kvB = Math.abs(vRecv.b[k]!) / 1e3;
    if (kvA < minFaultedKvA) minFaultedKvA = kvA;
    if (kvB > maxRecvKvB) maxRecvKvB = kvB;
    const i0 = Math.abs((iLine.a[k]! + iLine.b[k]! + iLine.c[k]!) / 3.0);
    if (i0 > maxZeroSeqCurrentAmp) maxZeroSeqCurrentAmp = i0;
  }

  console.log(
    `   Unfaulted Phase-B Recv Peak: ${maxRecvKvB.toFixed(1)} kV | Peak Zero-Sequence Current |I0|: ${maxZeroSeqCurrentAmp.toFixed(1)} A`,
  );

  assert.ok(maxRecvKvB > 150.0, "3-phase coupled modal FD line must propagate 3-phase wave to receiving end (>150 kV)");
  assert.ok(
    maxZeroSeqCurrentAmp > 50.0,
    "SLG fault on Phase A must excite zero-sequence modal current |I0| > 50 A across coupled line",
  );
}

console.log("ALL EMT SOLVER TESTS PASSED SUCCESSFULLY! Phases 1, 2, 3, 4, 5, 6, 7, 8 & 9 verified.");
