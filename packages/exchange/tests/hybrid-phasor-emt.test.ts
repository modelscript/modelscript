// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  computePhaseConductanceMatrix3x3,
  CoSimSession,
  EmtFmuParticipant,
  evaluateFdneModel,
  FdneDommelCompanion,
  fitFdneFromRlThevenin,
  Orchestrator,
  PhasorEmtCoupler,
  PhasorFmuParticipant,
  runHybridPhasorEmtCoSimulation,
  synthesizeThreePhaseFromSequences,
  toSequencePhasors,
  type EmtBoundaryFeedSpec,
  type EmtNetworkParticipant,
  type MultiPortBoundaryEquivalent,
  type PhasorBoundaryBusVoltage,
  type PhasorBoundaryInjection,
  type PhasorNetworkParticipant,
} from "../src/index.js";

/**
 * Creates a deterministic step-wise mock PhasorNetworkParticipant that drops
 * boundary voltage during a fault and responds to EMT current injections.
 */
function createStepwiseMockPhasor(options?: {
  faultStartSec?: number;
  faultClearSec?: number;
  unbalanced?: boolean;
}): PhasorNetworkParticipant & { stepLog: number[]; receivedInjLog: number[] } {
  const faultStart = options?.faultStartSec ?? 0.05;
  const faultClear = options?.faultClearSec ?? 0.1;
  const unbalanced = options?.unbalanced ?? false;

  const stepLog: number[] = [];
  const receivedInjLog: number[] = [];
  let tCur = 0.0;
  let topoVer = 0;
  let wasFault = false;
  let lastVm = 1.0;

  const makeEquiv = (faultActive: boolean): MultiPortBoundaryEquivalent => ({
    busIds: ["3"],
    yEqPos: [{ re: 0.5, im: faultActive ? -25.0 : -5.0 }],
    yEqNeg: [{ re: 0.5, im: faultActive ? -25.0 : -5.0 }],
    yEqZero: [{ re: 0.2, im: faultActive ? -10.0 : -2.0 }],
    baseKvLL: [230.0],
    baseMva: 100.0,
    topologyVersion: topoVer,
  });

  const makeBusV = (vm: number, faultActive: boolean): Map<string, PhasorBoundaryBusVoltage> => {
    const m = new Map<string, PhasorBoundaryBusVoltage>();
    m.set("3", {
      busId: "3",
      vmPu: vm,
      vaRad: 0.0,
      voltagePu: {
        pos: { re: vm, im: 0.0 },
        neg: unbalanced && faultActive ? { re: -0.18, im: 0.05 } : { re: 0.0, im: 0.0 },
        zero: unbalanced && faultActive ? { re: -0.12, im: 0.02 } : { re: 0.0, im: 0.0 },
      },
      baseKvLL: 230.0,
    });
    return m;
  };

  return {
    id: "MockPhasor",
    language: "mock-phasor",
    stepLog,
    receivedInjLog,
    initialize() {
      tCur = 0.0;
      topoVer = 0;
      wasFault = false;
      lastVm = 1.0;
      return {
        boundaryVoltages: makeBusV(1.0, false),
        boundaryEquivalent: makeEquiv(false),
        frequencyHz: 60.0,
        baseMva: 100.0,
        convergedPowerFlow: true,
      };
    },
    stepMacro(tSec: number, dtSec: number, injections: PhasorBoundaryInjection[]) {
      const tNext = tSec + dtSec;
      tCur = tNext;
      stepLog.push(Number(tNext.toFixed(4)));
      const inj = injections.find((i) => i.busId === "3");
      const injMag = inj ? Math.hypot(inj.currentPu.pos.re, inj.currentPu.pos.im) : 0.0;
      receivedInjLog.push(injMag);

      const faultNow = tNext >= faultStart - 1e-9 && tNext < faultClear - 1e-9;
      const topologyChanged = faultNow !== wasFault;
      if (topologyChanged) {
        wasFault = faultNow;
        topoVer++;
      }

      // Voltage responds immediately to fault AND to EMT current injection (closed-loop feedback)
      const baseV = faultNow ? 0.55 : 1.0;
      lastVm = Math.max(0.2, Math.min(1.2, baseV + 0.02 * Math.min(2.0, injMag)));

      return {
        timeSec: tNext,
        boundaryVoltages: makeBusV(lastVm, faultNow),
        boundaryEquivalent: topologyChanged ? makeEquiv(faultNow) : undefined,
        topologyChanged,
      };
    },
    computeBoundaryEquivalent() {
      return makeEquiv(wasFault);
    },
    getState() {
      return { tCur, topoVer, wasFault, lastVm, stepLen: stepLog.length };
    },
    setState(snap: unknown) {
      const s = snap as { tCur: number; topoVer: number; wasFault: boolean; lastVm: number; stepLen: number };
      tCur = s.tCur;
      topoVer = s.topoVer;
      wasFault = s.wasFault;
      lastVm = s.lastVm;
      stepLog.length = s.stepLen;
      receivedInjLog.length = s.stepLen;
    },
    finalize() {
      return {
        t: stepLog,
        states: ["v3"],
        y: stepLog.map(() => [lastVm]),
        summary: { convergedPowerFlow: true, stable: true, maxRotorAngleSpreadDeg: 0 },
      };
    },
  };
}

/**
 * Creates a deterministic step-wise mock EmtNetworkParticipant representing a
 * passive R-load plant connected to `Bus3` so boundary current is proportional to e_abc(t).
 */
function createStepwiseMockEmt(rLoadOhm = 500.0): EmtNetworkParticipant & { observedPeaks: number[] } {
  const observedPeaks: number[] = [];
  let stepCount = 0;

  return {
    id: "MockEmtPlant",
    language: "mock-emt",
    observedPeaks,
    initialize() {
      stepCount = 0;
    },
    stepSubSteps(tStartSec: number, dtEmtSec: number, nSubSteps: number, feeds: EmtBoundaryFeedSpec[]) {
      const feed = feeds[0]!;
      const ia: number[] = [];
      const ib: number[] = [];
      const ic: number[] = [];
      const va: number[] = [];
      const vb: number[] = [];
      const vc: number[] = [];
      let peakA = 0.0;

      for (let s = 0; s < nSubSteps; s++) {
        const t = tStartSec + (s + 1) * dtEmtSec;
        const th = feed.evaluateThevenin(t);
        const gLoad = 1.0 / rLoadOhm;
        // Voltage divider between Thévenin source (gSrc) and plant load (gLoad)
        const ratio = th.gSrc / (th.gSrc + gLoad);
        const vBusA = th.ea * ratio;
        const vBusB = th.eb * ratio;
        const vBusC = th.ec * ratio;
        peakA = Math.max(peakA, Math.abs(th.ea));

        va.push(vBusA);
        vb.push(vBusB);
        vc.push(vBusC);
        // Current from EMT into TS (negative of load draw)
        ia.push(-vBusA * gLoad);
        ib.push(-vBusB * gLoad);
        ic.push(-vBusC * gLoad);
        stepCount++;
      }

      observedPeaks.push(peakA);

      return {
        timeSec: tStartSec + nSubSteps * dtEmtSec,
        stepsExecuted: nSubSteps,
        boundaryCurrents: new Map([[feed.busId, { ia, ib, ic }]]),
        boundaryVoltages: new Map([[feed.busId, { va, vb, vc }]]),
      };
    },
    getState() {
      return { stepCount, peaksLen: observedPeaks.length };
    },
    setState(snap: unknown) {
      const s = snap as { stepCount: number; peaksLen: number };
      stepCount = s.stepCount;
      observedPeaks.length = s.peaksLen;
    },
    finalize() {
      return {
        time: new Float64Array(stepCount),
        busPhaseVoltages: new Map(),
      };
    },
  };
}

test("3-sequence symmetrical components round-trip (0/1/2 <-> abc)", () => {
  const seq = {
    pos: { re: 0.95, im: -0.1 },
    neg: { re: -0.15, im: 0.08 },
    zero: { re: 0.05, im: -0.04 },
  };
  const omega = 2 * Math.PI * 60.0;
  const vPeak = 1.0;

  // Sample 1 full cycle and check exact reconstruction via toSequencePhasors
  const n = 200;
  const dt = 1.0 / (60.0 * n);
  let sumARe = 0;
  let sumAIm = 0;
  let sumBRe = 0;
  let sumBIm = 0;
  let sumCRe = 0;
  let sumCIm = 0;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const v3 = synthesizeThreePhaseFromSequences(seq, omega, t, vPeak);
    const sinWt = Math.sin(omega * t);
    const cosWt = Math.cos(omega * t);
    // Sine-reference DFT matching Im((Vr + j Vi) * e^(j wt)) = Vr * sin(wt) + Vi * cos(wt)
    sumARe += v3.a * sinWt;
    sumAIm += v3.a * cosWt;
    sumBRe += v3.b * sinWt;
    sumBIm += v3.b * cosWt;
    sumCRe += v3.c * sinWt;
    sumCIm += v3.c * cosWt;
  }
  const f = 2.0 / n;
  const rec = toSequencePhasors(
    { re: sumARe * f, im: sumAIm * f },
    { re: sumBRe * f, im: sumBIm * f },
    { re: sumCRe * f, im: sumCIm * f },
  );

  assert.ok(Math.abs(rec.pos.re - seq.pos.re) < 1e-6);
  assert.ok(Math.abs(rec.pos.im - seq.pos.im) < 1e-6);
  assert.ok(Math.abs((rec.neg?.re ?? 0) - seq.neg.re) < 1e-6);
  assert.ok(Math.abs((rec.neg?.im ?? 0) - seq.neg.im) < 1e-6);
  assert.ok(Math.abs((rec.zero?.re ?? 0) - seq.zero.re) < 1e-6);
  assert.ok(Math.abs((rec.zero?.im ?? 0) - seq.zero.im) < 1e-6);
});

test("computePhaseConductanceMatrix3x3 produces symmetric passive 3x3 matrix", () => {
  const { gSelf, gMutual, gMatrix3x3 } = computePhaseConductanceMatrix3x3(
    { re: 1.0, im: -10.0 },
    { re: 1.0, im: -10.0 },
    { re: 0.3, im: -3.0 },
    529.0, // 230^2 / 100
  );
  assert.ok(gSelf > 0);
  assert.equal(gMatrix3x3.length, 9);
  assert.equal(gMatrix3x3[0], gSelf);
  assert.equal(gMatrix3x3[1], gMutual);
  assert.equal(gMatrix3x3[3], gMutual);
  assert.ok(gSelf > Math.abs(gMutual), "Diagonal dominance required for passivity");
});

test("FDNE Vector Fitting matches RL Thévenin impedance across 10 Hz - 2.5 kHz and enforces passivity", () => {
  const rOhm = 2.5;
  const lHenry = 0.04;
  const model = fitFdneFromRlThevenin(rOhm, lHenry, 0.0, { numPoles: 3, iterations: 5 });

  assert.ok(model.isPassive, "FDNE model must be passive");
  assert.ok(model.minRealPart >= -1e-9, `Expected non-negative real part, got ${model.minRealPart}`);
  assert.ok(model.rmsRelError < 0.02, `Expected RMS relative error < 2%, got ${(model.rmsRelError * 100).toFixed(2)}%`);

  // Verify 60 Hz admittance accuracy
  const w60 = 2 * Math.PI * 60;
  const z2 = rOhm * rOhm + (w60 * lHenry) ** 2;
  const yExactRe = rOhm / z2;
  const yExactIm = (-w60 * lHenry) / z2;
  const yFit = evaluateFdneModel(model, 60.0);
  const relErr60 = Math.hypot(yFit.re - yExactRe, yFit.im - yExactIm) / Math.hypot(yExactRe, yExactIm);
  assert.ok(relErr60 < 0.02, `Expected 60 Hz error < 2%, got ${(relErr60 * 100).toFixed(2)}%`);

  // Verify Dommel companion stamping & step
  const companion = new FdneDommelCompanion(model, 50e-6, 3);
  const stamp = companion.stampCompanion(0, 50e-6);
  assert.equal(stamp.gEq.length, 9);
  assert.ok(stamp.gEq[0]! > 0);
  companion.doStep(50e-6, 50e-6, [100e3, -50e3, -50e3]);
  const stamp2 = companion.stampCompanion(100e-6, 50e-6);
  assert.ok(Math.abs(stamp2.iHist[0]!) > 0, "FDNE history current should update after voltage step");
});

test("Closed-loop causality: TS fault propagates to EMT within 1 macro-step and updates dynamic Y_eq", async () => {
  const phasor = createStepwiseMockPhasor({ faultStartSec: 0.02, faultClearSec: 0.04, unbalanced: true });
  const emt = createStepwiseMockEmt(400.0);

  const res = await runHybridPhasorEmtCoSimulation(
    phasor,
    [
      {
        id: "PlantA",
        participant: emt,
        boundaryPorts: [{ phasorBusId: "3", emtBusId: "Bus3" }],
      },
    ],
    {
      durationSec: 0.06,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      mode: "direct",
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      maxIterations: 2,
    },
  );

  assert.equal(res.totalMacroSteps, 12);
  assert.equal(res.topologyUpdates, 2, "Expected 2 topology updates (fault inception + fault clearing)");
  assert.equal(res.sequences, 3);
  assert.equal(res.usedFdne, true);

  // Verify closed-loop causality:
  // Before fault (t=0.015s, step index 2), EMT peak is ~1.0 pu (~187.8 kV peak).
  // During fault (t=0.025s, step index 5), EMT immediately observes reduced voltage (< 150 kV).
  const preFaultPeak = emt.observedPeaks[2]!;
  const duringFaultPeak = emt.observedPeaks[5]!;
  assert.ok(preFaultPeak > 170e3, `Expected pre-fault EMT peak > 170 kV, got ${preFaultPeak}`);
  assert.ok(duringFaultPeak < 150e3, `Expected during-fault EMT peak < 150 kV (closed-loop), got ${duringFaultPeak}`);

  // Verify negative- and zero-sequence voltages were captured during the unbalanced fault
  const faultRec = res.macroRecords.find((r) => Math.abs(r.timeSec - 0.025) < 1e-4);
  assert.ok(faultRec, "Expected macro record at t=0.025s");
  assert.ok(
    faultRec.vNegMagPu > 0.1,
    `Expected non-zero negative sequence voltage during fault, got ${faultRec.vNegMagPu}`,
  );
  assert.ok(
    faultRec.vZeroMagPu > 0.05,
    `Expected non-zero zero sequence voltage during fault, got ${faultRec.vZeroMagPu}`,
  );
});

test("Direct mode and FMI 3.0 mode produce identical closed-loop results", async () => {
  const runWithMode = async (mode: "direct" | "fmi") => {
    const phasor = createStepwiseMockPhasor({ faultStartSec: 0.02, faultClearSec: 0.035 });
    const emt = createStepwiseMockEmt(500.0);
    const coupler = new PhasorEmtCoupler({
      durationSec: 0.05,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      mode,
      sequences: 1,
      useDynamicEquivalent: true,
    });
    coupler.addPlant({
      id: "Plant1",
      participant: emt,
      boundaryPorts: [{ phasorBusId: "3", emtBusId: "Bus3" }],
    });
    return coupler.run(phasor);
  };

  const directRes = await runWithMode("direct");
  const fmiRes = await runWithMode("fmi");

  assert.equal(directRes.mode, "direct");
  assert.equal(fmiRes.mode, "fmi");
  assert.equal(directRes.macroRecords.length, fmiRes.macroRecords.length);

  for (let i = 0; i < directRes.macroRecords.length; i++) {
    const d = directRes.macroRecords[i]!;
    const f = fmiRes.macroRecords[i]!;
    assert.ok(
      Math.abs(d.vTsMagPu - f.vTsMagPu) < 1e-6,
      `Voltage mismatch at step ${i}: ${d.vTsMagPu} vs ${f.vTsMagPu}`,
    );
    assert.ok(
      Math.abs(d.iTsInjPuRe - f.iTsInjPuRe) < 1e-6,
      `Current mismatch at step ${i}: ${d.iTsInjPuRe} vs ${f.iTsInjPuRe}`,
    );
  }
});

test("General FMI Orchestrator auto-bridges fmi-ls-rms <-> fmi-ls-emt participants in a CoSimSession", async () => {
  const phasorFmu = new PhasorFmuParticipant(
    createStepwiseMockPhasor({ faultStartSec: 0.015, faultClearSec: 0.03, unbalanced: true }),
    { id: "RMS_Grid", boundaryBusIds: ["3"] },
  );
  const emtFmu = new EmtFmuParticipant(createStepwiseMockEmt(500.0), {
    id: "EMT_Plant",
    boundaryBusIds: ["Bus3"],
    dtEmtSec: 50e-6,
  });

  const session = new CoSimSession("hybrid-fmi-auto-bridge", {
    startTime: 0.0,
    stopTime: 0.04,
    stepSize: 0.005,
  });
  session.addParticipant(phasorFmu);
  session.addParticipant(emtFmu);
  session.coupling.addCoupling({
    from: { participantId: "RMS_Grid", variableName: "V1_re_3" },
    to: { participantId: "EMT_Plant", variableName: "ea_Bus3" },
  });
  session.coupling.addCoupling({
    from: { participantId: "RMS_Grid", variableName: "V2_re_3" },
    to: { participantId: "EMT_Plant", variableName: "eb_Bus3" },
  });
  session.coupling.addCoupling({
    from: { participantId: "EMT_Plant", variableName: "ia_Bus3" },
    to: { participantId: "RMS_Grid", variableName: "I1_re_3" },
  });

  let stepCount = 0;
  let completed = false;
  const orch = new Orchestrator(session, null, {
    onStep: () => {
      stepCount++;
    },
    onComplete: () => {
      completed = true;
    },
  });

  await orch.run();

  assert.equal(completed, true);
  assert.ok(orch.lastHybridResult, "Expected Orchestrator to auto-bridge and populate lastHybridResult");
  assert.equal(orch.lastHybridResult.sequences, 3, "Expected 3-sequence auto-detection from V2 coupling");
  assert.equal(orch.lastHybridResult.totalMacroSteps, 8);
  assert.equal(stepCount, 8);
});

test("Frequency-adaptive DFT eliminates magnitude and phase error at off-nominal 58.8 Hz", async () => {
  const { extractFundamentalPhasor } = await import("../src/cosim/ts-emt-orchestrator.js");
  const f0 = 60.0;
  const fActual = 58.8; // -2% under-frequency contingency
  const dt = 50e-6;
  const omega = 2 * Math.PI * fActual;
  const peak = 200.0;
  const phaseTrue = 0.42; // rad

  // Generate 0.06s of 58.8 Hz waveform (> 3 cycles so sliding window starts at tStart > 0)
  const nTotal = Math.round(0.06 / dt);
  const samples = new Float64Array(nTotal);
  for (let i = 0; i < nTotal; i++) {
    const t = i * dt;
    samples[i] = peak * Math.sin(omega * t + phaseTrue);
  }
  const tEnd = (nTotal - 1) * dt;

  // Fixed 60 Hz DFT suffers spectral leakage & phase slip
  const fixed = extractFundamentalPhasor(samples, dt, f0, f0, tEnd);
  // Frequency-tracked 58.8 Hz DFT locks onto exact magnitude and phase
  const tracked = extractFundamentalPhasor(samples, dt, f0, fActual, tEnd);

  const trackedMagErr = Math.abs(tracked.mag - peak) / peak;
  const trackedPhaseErr = Math.abs(
    Math.atan2(Math.sin(tracked.phaseRad - phaseTrue), Math.cos(tracked.phaseRad - phaseTrue)),
  );
  const fixedPhaseErr = Math.abs(
    Math.atan2(Math.sin(fixed.phaseRad - phaseTrue), Math.cos(fixed.phaseRad - phaseTrue)),
  );

  assert.ok(trackedMagErr < 1e-4, `Expected tracked magnitude error < 0.01%, got ${(trackedMagErr * 100).toFixed(4)}%`);
  assert.ok(trackedPhaseErr < 1e-4, `Expected tracked phase error < 1e-4 rad, got ${trackedPhaseErr}`);
  assert.ok(
    fixedPhaseErr > 0.1,
    `Expected fixed 60 Hz DFT to exhibit significant phase slip (>0.1 rad), got ${fixedPhaseErr}`,
  );
});
