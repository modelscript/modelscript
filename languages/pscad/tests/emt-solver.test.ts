// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmtSolver, runEmtSimulation, type EmtNetlist } from "../src/index.js";

describe("Native Dommel Companion-Circuit EMT Solver with CDA", () => {
  it("should solve a 3-phase AC transmission line with cached LU factorization", () => {
    const netlist: EmtNetlist = {
      name: "SimpleAcGrid",
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["Bus1", { id: "Bus1", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["Line1"] }],
        ["Bus2", { id: "Bus2", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["Line1"] }],
      ]),
      sources: [
        {
          id: "Src1",
          bus: "Bus1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          phaseDeg: 0.0,
          rSourceOhm: 0.5,
          lSourceHenry: 0.005,
        },
      ],
      branches: [
        {
          id: "Line1",
          fromBus: "Bus1",
          toBus: "Bus2",
          rOhm: 1.2,
          lHenry: 0.02,
          cFarad: 1e-6,
        },
      ],
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6, // 50 microseconds
      durationSec: 0.05, // 50 milliseconds = 1000 steps
      enableCda: true,
    });

    const result = solver.solve();

    assert.equal(result.metrics.totalSteps, 1000);
    // On static topology without switching, LU factorization is executed only once per 3 phases
    assert.equal(result.metrics.luFactorizations, 3);
    assert.equal(result.metrics.switchingEvents, 0);

    const vBus2 = result.busVoltages.get("Bus2");
    assert.ok(vBus2 !== undefined);
    assert.equal(vBus2.length, 1000);

    // Verify steady-state AC magnitude (~230 kV peak is ~230*sqrt(2)/sqrt(3) * 1e3 = 187.79 kV, or line peak 230 kV)
    let maxV = 0.0;
    for (let i = 500; i < 1000; i++) {
      if (Math.abs(vBus2[i]!) > maxV) maxV = Math.abs(vBus2[i]!);
    }
    assert.ok(maxV > 150e3 && maxV < 250e3, `Max bus voltage ${maxV} should be in nominal 230 kV range`);
  });

  it("should perform Critical Damping Adjustment (CDA) to eliminate switching chatter across circuit breaker actions", () => {
    const netlist: EmtNetlist = {
      name: "BreakerSwitchingGrid",
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["SourceBus", { id: "SourceBus", baseKv: 138.0, nominalKv: 138.0, connectedBranchIds: ["Brk1"] }],
        ["LoadBus", { id: "LoadBus", baseKv: 138.0, nominalKv: 138.0, connectedBranchIds: ["Brk1", "Load1"] }],
      ]),
      sources: [
        {
          id: "Gen1",
          bus: "SourceBus",
          voltageKv: 138.0,
          frequencyHz: 60.0,
          rSourceOhm: 0.2,
          lSourceHenry: 0.002,
        },
      ],
      switches: [
        {
          id: "Brk1",
          fromBus: "SourceBus",
          toBus: "LoadBus",
          initialClosed: true,
          actionTimeSec: 0.02, // Breaker opens at 20 ms
          rClosedOhm: 1e-4,
          rOpenOhm: 1e6,
        },
      ],
      branches: [
        {
          id: "Load1",
          fromBus: "LoadBus",
          toBus: "GND",
          rOhm: 50.0,
          lHenry: 0.05,
          cFarad: 0.0,
        },
      ],
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.04, // 800 steps, switch at step 400
      enableCda: true,
    });

    const result = solver.solve();

    assert.equal(result.metrics.switchingEvents, 1);
    assert.ok(result.metrics.chatterDampedSteps > 0, "CDA should damp chatter immediately following switch action");
    // Matrix re-factorization occurs when switch state changes: 3 initially + 3 after toggle = 6
    assert.equal(result.metrics.luFactorizations, 6);

    const iBreaker = result.branchCurrents.get("Brk1");
    assert.ok(iBreaker !== undefined);

    // Prior to opening (t < 0.02s), current flows through the load
    let maxPreOpenCurrent = 0;
    for (let k = 100; k < 390; k++) {
      if (Math.abs(iBreaker[k]!) > maxPreOpenCurrent) maxPreOpenCurrent = Math.abs(iBreaker[k]!);
    }
    assert.ok(maxPreOpenCurrent > 100.0, "Current should be flowing before breaker opening");

    // After opening and CDA damping (t > 0.022s), breaker current should drop to zero (open circuit leakage only)
    for (let k = 450; k < 800; k++) {
      assert.ok(Math.abs(iBreaker[k]!) < 1.0, `Current after breaker opening should be negligible, got ${iBreaker[k]}`);
    }
  });

  it("should evaluate dynamic 3-phase fault inception and clearance", () => {
    const netlist: EmtNetlist = {
      name: "FaultGrid",
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["SubstationA", { id: "SubstationA", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["FeedLine"] }],
        ["SubstationB", { id: "SubstationB", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["FeedLine"] }],
      ]),
      sources: [
        {
          id: "GridInfeed",
          bus: "SubstationA",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 1.0,
          lSourceHenry: 0.01,
        },
      ],
      branches: [
        {
          id: "FeedLine",
          fromBus: "SubstationA",
          toBus: "SubstationB",
          rOhm: 2.0,
          lHenry: 0.03,
          cFarad: 1e-6,
        },
      ],
      faults: [
        {
          id: "Flt1",
          bus: "SubstationB",
          faultType: "3PH",
          startSec: 0.02,
          endSec: 0.05,
          rFaultOhm: 0.1, // Near solid short circuit
        },
      ],
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.08,
      enableCda: true,
    });

    const result = solver.solve();

    const vFaultBus = result.busVoltages.get("SubstationB");
    assert.ok(vFaultBus !== undefined);

    // Check voltage during fault (t between 0.025s and 0.045s) is depressed
    let maxFaultV = 0.0;
    for (let k = 500; k < 900; k++) {
      if (Math.abs(vFaultBus[k]!) > maxFaultV) maxFaultV = Math.abs(vFaultBus[k]!);
    }

    // Check voltage after fault clears (t > 0.06s) recovers
    let maxPostFaultV = 0.0;
    for (let k = 1300; k < 1550; k++) {
      if (Math.abs(vFaultBus[k]!) > maxPostFaultV) maxPostFaultV = Math.abs(vFaultBus[k]!);
    }

    assert.ok(maxFaultV < 30e3, `Fault voltage must be deeply depressed (< 30 kV), got ${maxFaultV}`);
    assert.ok(maxPostFaultV > 150e3, `Post-fault voltage must recover (> 150 kV), got ${maxPostFaultV}`);
  });

  it("should solve a 3-phase AC transmission line using WebAssembly EMT kernel", () => {
    const netlist: EmtNetlist = {
      name: "WasmAcGrid",
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["Bus1", { id: "Bus1", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["Line1"] }],
        ["Bus2", { id: "Bus2", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["Line1"] }],
      ]),
      sources: [
        {
          id: "Src1",
          bus: "Bus1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          phaseDeg: 0.0,
          rSourceOhm: 0.5,
          lSourceHenry: 0.005,
        },
      ],
      branches: [
        {
          id: "Line1",
          fromBus: "Bus1",
          toBus: "Bus2",
          rOhm: 1.2,
          lHenry: 0.02,
          cFarad: 1e-6,
        },
      ],
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.05,
      enableCda: true,
      useWasm: true,
    });

    const result = solver.solve();

    assert.equal(result.metrics.totalSteps, 1000);
    const vBus2 = result.busVoltages.get("Bus2");
    assert.ok(vBus2 !== undefined);
    assert.equal(vBus2.length, 1000);

    let maxV = 0.0;
    for (let i = 500; i < 1000; i++) {
      if (Math.abs(vBus2[i]!) > maxV) maxV = Math.abs(vBus2[i]!);
    }
    assert.ok(maxV > 150e3 && maxV < 250e3, `Max bus voltage ${maxV} should be in nominal 230 kV range`);
  });

  it("should solve coupled 3-phase abc nodal admittance for phase-to-phase (LL) and SLG asymmetrical faults", () => {
    const netlist: EmtNetlist = {
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["GenBus", { id: "GenBus", name: "GenBus", baseKv: 230.0, phaseCount: 3, connectedBranchIds: ["Line1"] }],
        ["FaultBus", { id: "FaultBus", name: "FaultBus", baseKv: 230.0, phaseCount: 3, connectedBranchIds: ["Line1"] }],
      ]),
      sources: [
        {
          id: "GridSrc",
          name: "GridSrc",
          bus: "GenBus",
          vPeakKv: 230.0,
          frequencyHz: 60.0,
          phaseRad: 0.0,
          mvaRating: 500.0,
          rSourceOhm: 1.0,
          lSourceH: 0.01,
        },
      ],
      branches: [
        {
          id: "Line1",
          kind: "rlc",
          fromBus: "GenBus",
          toBus: "FaultBus",
          resistanceOhm: 2.0,
          inductanceH: 0.02,
          capacitanceF: 1e-6,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      faults: [
        {
          id: "FltLL",
          bus: "FaultBus",
          faultType: "LL", // Phase B to Phase C fault
          startSec: 0.015,
          endSec: 0.045,
          rFaultOhm: 0.01,
        },
      ],
    };

    const result = runEmtSimulation(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.05,
    });

    const va = result.vA.get("FaultBus")!;
    const vb = result.vB.get("FaultBus")!;
    const vc = result.vC.get("FaultBus")!;
    assert.ok(va && vb && vc);

    // During LL fault between Phase B and Phase C (steps 400..800):
    // Phase A remains healthy (~230 kV peak), while |vB(t) - vC(t)| collapses near zero!
    let maxVaFault = 0;
    let maxDiffBCFault = 0;
    for (let k = 450; k < 850; k++) {
      maxVaFault = Math.max(maxVaFault, Math.abs(va[k]!));
      maxDiffBCFault = Math.max(maxDiffBCFault, Math.abs(vb[k]! - vc[k]!));
    }
    assert.ok(maxVaFault > 180e3, `Unfaulted Phase A voltage should stay near nominal (>180 kV), got ${maxVaFault}`);
    assert.ok(
      maxDiffBCFault < 15e3,
      `Phase B-to-C voltage difference should collapse during bolted LL fault (<15 kV), got ${maxDiffBCFault}`,
    );
  });

  it("should simulate Bergeron distributed traveling-wave propagation delay and surge impedance", () => {
    // 150 km overhead line with L' = 1 mH/km, C' = 10 nF/km:
    // wave speed v = 1 / sqrt(1e-3 * 1e-8) = 316,227.77 km/s
    // travel time tau = 150 * sqrt(1e-11) = 0.47434 ms (~23.7 steps at dt = 20 us)
    // surge impedance Zc = sqrt(1e-3 / 1e-8) = 316.23 Ohm
    const netlist: EmtNetlist = {
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["SendBus", { id: "SendBus", name: "SendBus", baseKv: 230.0, phaseCount: 3, connectedBranchIds: ["BergLine"] }],
        ["RecvBus", { id: "RecvBus", name: "RecvBus", baseKv: 230.0, phaseCount: 3, connectedBranchIds: ["BergLine"] }],
      ]),
      sources: [
        {
          id: "SendSrc",
          name: "SendSrc",
          bus: "SendBus",
          vPeakKv: 230.0,
          frequencyHz: 60.0,
          phaseRad: Math.PI / 2, // Cosine wave starting at peak at t = 0
          mvaRating: 1000.0,
          rSourceOhm: 0.5,
        },
      ],
      branches: [],
      transformers: [],
      transmissionLines: [
        {
          id: "BergLine",
          fromBus: "SendBus",
          toBus: "RecvBus",
          lengthKm: 150.0,
          rPerKm: 0.02,
          lPerKm: 1e-3,
          cPerKm: 1e-8,
          modelType: "bergeron",
        },
      ],
      fmuInstances: [],
    };

    const dt = 20e-6;
    const result = runEmtSimulation(netlist, {
      timeStepSec: dt,
      durationSec: 0.01,
    });

    const vSend = result.vA.get("SendBus")!;
    const vRecv = result.vA.get("RecvBus")!;
    const iSend = result.iA.get("BergLine")!;
    assert.ok(vSend && vRecv && iSend);

    // At t = 0..0.35 ms (steps 0..17, before travel time tau = 0.474 ms):
    // SendBus is immediately energized (~230 kV), while open-end RecvBus has NOT yet seen the wave!
    assert.ok(Math.abs(vSend[2]!) > 200e3, `SendBus should be energized immediately at step 2, got ${vSend[2]}`);
    for (let k = 0; k < 18; k++) {
      assert.ok(
        Math.abs(vRecv[k]!) < 1.0,
        `RecvBus at step ${k} (t=${(k * dt * 1e3).toFixed(2)}ms < tau) must remain ~0 before wave arrival, got ${vRecv[k]}`,
      );
    }

    // Initial sending-end current before reflection returns (2*tau) must equal vSend / (Zc + R/4)
    const zChar = Math.sqrt(1e-3 / 1e-8); // 316.2277 Ohm
    const expectedISend = vSend[5]! / (zChar + 0.25 * (150 * 0.02));
    assert.ok(
      Math.abs(iSend[5]! - expectedISend) / expectedISend < 0.02,
      `Initial Bergeron sending current ${iSend[5]} should match vSend / Z_berg = ${expectedISend}`,
    );

    // After t > tau (step 30, t = 0.60 ms), the wave arrives at open-circuited RecvBus and doubles in voltage!
    let maxRecvAfterArrival = 0;
    for (let k = 25; k < 45; k++) {
      maxRecvAfterArrival = Math.max(maxRecvAfterArrival, Math.abs(vRecv[k]!));
    }
    assert.ok(
      maxRecvAfterArrival > 350e3,
      `Open-end Bergeron receiving voltage should exhibit traveling-wave reflection (>350 kV), got ${maxRecvAfterArrival}`,
    );
  });

  it("should simulate Park dq0 synchronous generator swing equation and subtransient EMF under fault", () => {
    const netlist: EmtNetlist = {
      nominalFrequencyHz: 60.0,
      buses: new Map([
        [
          "GenTerm",
          { id: "GenTerm", name: "GenTerm", baseKv: 16.5, phaseCount: 3, connectedBranchIds: ["SM1", "Load"] },
        ],
      ]),
      sources: [],
      branches: [
        {
          id: "Load",
          kind: "rlc",
          fromBus: "GenTerm",
          toBus: "0",
          resistanceOhm: 1.5,
          inductanceH: 0.002,
          capacitanceF: 0,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      synchronousMachines: [
        {
          id: "SM1",
          bus: "GenTerm",
          ratedMva: 250.0,
          ratedKvLL: 16.5,
          frequencyHz: 60.0,
          xdSub: 0.2,
          xqSub: 0.2,
          hInertiaSec: 3.0,
          dampingPu: 2.0,
          mechanicalPowerPu: 0.8,
          fieldVoltagePu: 1.1,
        },
      ],
      faults: [
        {
          id: "TermFault",
          bus: "GenTerm",
          faultType: "3PH",
          startSec: 0.01,
          endSec: 0.04,
          rFaultOhm: 0.005,
        },
      ],
    };

    const result = runEmtSimulation(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.06,
    });

    const delta = result.controlSignals?.get("SM1_delta");
    const omega = result.controlSignals?.get("SM1_omega");
    const pe = result.controlSignals?.get("SM1_Pe");
    const iGenA = result.iA.get("SM1");
    assert.ok(delta && omega && pe && iGenA);

    const omega0 = 2 * Math.PI * 60.0;
    const deltaInit = delta[0]!;
    const deltaEndFault = delta[800]!; // t = 0.04s (end of 3PH fault)
    const omegaEndFault = omega[800]!;

    // During the bolted 3PH terminal fault, electrical power Pe collapses near 0 while Pm = 0.8 pu,
    // causing the rotor to accelerate (omega > omega0) and rotor angle delta to advance!
    assert.ok(
      omegaEndFault > omega0,
      `Rotor speed at fault clearing (${omegaEndFault} rad/s) must exceed synchronous speed (${omega0} rad/s)`,
    );
    assert.ok(
      deltaEndFault > deltaInit + 0.02,
      `Rotor angle delta must advance during fault from ${deltaInit} to ${deltaEndFault} rad`,
    );
  });
});
