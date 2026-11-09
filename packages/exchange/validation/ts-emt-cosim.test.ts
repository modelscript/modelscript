// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { extractFundamentalPhasor, runTsEmtCoSimulation, toPositiveSequencePhasor } from "../src/index.js";

console.log("=== Testing TS-EMT Hybrid Dynamic Co-Simulation Orchestrator ===");

// -----------------------------------------------------------------------------
// 1. Sliding Window DFT Fundamental Phasor Extraction
// -----------------------------------------------------------------------------
console.log("1. Testing extractFundamentalPhasor()...");
const f0 = 60.0;
const dt = 50e-6; // 50 us
const nSteps = Math.round(1.0 / (f0 * dt)); // 1 cycle = 333.33 steps -> 333 steps
const omega0 = 2 * Math.PI * f0;

// Test waveform: v(t) = 120 * sqrt(2) * cos(omega0 * t + 30 deg)
const vPeakExpected = 120 * Math.SQRT2;
const phaseDegExpected = 30.0;
const phaseRadExpected = (phaseDegExpected * Math.PI) / 180.0;

const signal: number[] = [];
for (let i = 0; i < nSteps * 2; i++) {
  const t = i * dt;
  signal.push(vPeakExpected * Math.cos(omega0 * t + phaseRadExpected));
}

const phasor = extractFundamentalPhasor(signal, dt, f0);
console.log(
  `   Estimated Peak: ${phasor.mag.toFixed(3)}, Phase: ${((phasor.phaseRad * 180) / Math.PI).toFixed(2)} deg`,
);

assert.ok(Math.abs(phasor.mag - vPeakExpected) < 1.0, `Expected magnitude ~${vPeakExpected}, got ${phasor.mag}`);
assert.ok(
  Math.abs((phasor.phaseRad * 180) / Math.PI - phaseDegExpected) < 1.0,
  `Expected phase ~${phaseDegExpected} deg, got ${(phasor.phaseRad * 180) / Math.PI}`,
);

// -----------------------------------------------------------------------------
// 2. Fortescue Symmetrical Components to Positive Sequence
// -----------------------------------------------------------------------------
console.log("2. Testing toPositiveSequencePhasor()...");

// Perfectly balanced 3-phase set: Ia = 100/_0, Ib = 100/_-120, Ic = 100/_+120
const ia = { re: 100.0, im: 0.0 };
const ib = { re: 100.0 * Math.cos((-2 * Math.PI) / 3), im: 100.0 * Math.sin((-2 * Math.PI) / 3) };
const ic = { re: 100.0 * Math.cos((2 * Math.PI) / 3), im: 100.0 * Math.sin((2 * Math.PI) / 3) };

const posSeq = toPositiveSequencePhasor(ia, ib, ic);
console.log(`   Positive sequence: mag=${posSeq.mag.toFixed(3)}, phase=${posSeq.phaseRad.toFixed(3)}`);

assert.ok(Math.abs(posSeq.mag - 100.0) < 1e-4, `Expected positive sequence magnitude 100, got ${posSeq.mag}`);
assert.ok(Math.abs(posSeq.phaseRad) < 1e-4, `Expected positive sequence phase 0, got ${posSeq.phaseRad}`);

// -----------------------------------------------------------------------------
// 3. Coupled TS-EMT Co-Simulation Loop
// -----------------------------------------------------------------------------
console.log("3. Testing runTsEmtCoSimulation()...");

const fakePsseRunner = (opts: {
  stopTime: number;
  timeStep: number;
  boundaryInjections: Array<{ busNumber: number; inject: (t: number) => { irPu: number; iiPu: number } }>;
  onStep?: (t: number, busVoltages: Map<number, { vmPu: number; vaRad: number }>) => void;
  fault?: any;
}) => {
  const nMacro = Math.round(opts.stopTime / opts.timeStep);
  const busMap = new Map<number, { vmPu: number; vaRad: number }>();

  for (let k = 0; k < nMacro; k++) {
    const t = k * opts.timeStep;
    // Simulate a voltage dip between 0.02s and 0.06s
    const isFault = t >= 0.02 && t <= 0.06;
    const vmPu = isFault ? 0.35 : 1.02;
    const vaRad = -0.05 * Math.sin(2 * Math.PI * 2.0 * t);
    busMap.set(101, { vmPu, vaRad });

    // Call injections to ensure feedback handler executes
    for (const inj of opts.boundaryInjections) {
      inj.inject(t);
    }

    if (opts.onStep) {
      opts.onStep(t, busMap);
    }
  }

  return {
    t: Array.from({ length: nMacro }, (_, i) => i * opts.timeStep),
    states: ["GEN1_delta", "GEN1_omega"],
    y: [],
    summary: { convergedPowerFlow: true, stable: true, maxRotorAngleSpreadDeg: 12.5 },
  };
};

const fakePscadRunner = (opts: {
  durationSec: number;
  timeStepSec: number;
  boundaryFeeds: Array<{
    busId: string;
    thevenin?: (t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined;
  }>;
  onStep?: (t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void;
}) => {
  const nSub = Math.round(opts.durationSec / opts.timeStepSec);
  const stepVolts = new Map<string, { a: number; b: number; c: number }>();

  for (let s = 0; s < nSub; s++) {
    const t = s * opts.timeStepSec;
    // EMT sub-network responds to Thévenin source
    for (const feed of opts.boundaryFeeds) {
      if (feed.thevenin) {
        const th = feed.thevenin(t);
        const ea = th.vPeak * Math.sin(th.freqRad * t + th.phaseRad);
        const eb = th.vPeak * Math.sin(th.freqRad * t + th.phaseRad - (2 * Math.PI) / 3);
        const ec = th.vPeak * Math.sin(th.freqRad * t + th.phaseRad + (2 * Math.PI) / 3);
        stepVolts.set(feed.busId, { a: ea * 0.98, b: eb * 0.98, c: ec * 0.98 });
      }
    }
    if (opts.onStep) {
      opts.onStep(t, s, stepVolts);
    }
  }

  return {
    time: new Float64Array(nSub),
    busPhaseVoltages: new Map(),
  };
};

const coSimPromise = runTsEmtCoSimulation(fakePsseRunner, fakePscadRunner, {
  durationSec: 0.1, // 100 ms
  dtTsSec: 0.005, // 5 ms macro-step (20 steps)
  dtEmtSec: 50e-6, // 50 us micro-step (2000 steps)
  frequencyHz: 60.0,
  boundaryPorts: [
    {
      psseBusNumber: 101,
      pscadBusId: "BND_NODE_101",
      baseKvLL: 230.0,
      baseMva: 100.0,
      theveninConductanceSiemens: 25.0,
    },
  ],
});

const result = await coSimPromise;

console.log(`   Co-simulation complete in ${result.wallClockTimeMs} ms.`);
console.log(`   Macro records count: ${result.macroRecords.length}`);
console.log(`   Time-scale ratio M: ${result.ratioM}`);

assert.strictEqual(result.ratioM, 100);
assert.strictEqual(result.totalMacroSteps, 20);
assert.strictEqual(result.totalEmtSubSteps, 2000);
assert.ok(result.macroRecords.length >= 20);

// Check that voltage dip during fault was logged
const faultedRecords = result.macroRecords.filter((r) => r.timeSec >= 0.02 && r.timeSec <= 0.06);
assert.ok(faultedRecords.length > 0);
for (const r of faultedRecords) {
  assert.ok(r.vTsMagPu < 0.5, `Faulted voltage should be depressed, got ${r.vTsMagPu}`);
  assert.ok(r.vEmtPeakKv < 100.0, `EMT peak voltage should drop during fault, got ${r.vEmtPeakKv} kV`);
}

const preFaultRecord = result.macroRecords[0];
assert.ok(preFaultRecord.vTsMagPu > 1.0);
assert.ok(preFaultRecord.vEmtPeakKv > 180.0); // 230 kV LL -> ~187 kV LN peak

console.log("=== TS-EMT Dynamic Hybrid Co-Simulation tests passed! ===");
