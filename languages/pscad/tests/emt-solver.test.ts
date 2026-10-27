// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmtSolver, type EmtNetlist } from "../src/index.js";

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
});
