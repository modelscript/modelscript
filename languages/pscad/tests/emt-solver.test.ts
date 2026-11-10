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

  it("should solve a 200-bus (600 phase nodes) 3-phase EMT grid using sparse CCS LU factorization", () => {
    const nBuses = 200;
    const buses = new Map<string, { id: string; baseKv: number; nominalKv: number; connectedBranchIds: string[] }>();
    const branches: NonNullable<EmtNetlist["branches"]> = [];
    for (let i = 1; i <= nBuses; i++) {
      buses.set(`Bus_${i}`, {
        id: `Bus_${i}`,
        baseKv: 230.0,
        nominalKv: 230.0,
        connectedBranchIds: [],
      });
      if (i > 1) {
        branches.push({
          id: `Line_${i - 1}_${i}`,
          fromBus: `Bus_${i - 1}`,
          toBus: `Bus_${i}`,
          rOhm: 0.5,
          lHenry: 0.005,
          cFarad: 1e-7,
        });
      }
      if (i > 10 && i % 10 === 0) {
        branches.push({
          id: `Mesh_${i - 10}_${i}`,
          fromBus: `Bus_${i - 10}`,
          toBus: `Bus_${i}`,
          rOhm: 0.8,
          lHenry: 0.008,
          cFarad: 1e-7,
        });
      }
    }

    const netlist: EmtNetlist = {
      name: "Sparse200BusGrid",
      nominalFrequencyHz: 60.0,
      buses: buses as EmtNetlist["buses"],
      sources: [
        {
          id: "SlackSrc",
          bus: "Bus_1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 0.2,
          lSourceHenry: 0.002,
        },
        {
          id: "TailSrc",
          bus: `Bus_${nBuses}`,
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 0.3,
          lSourceHenry: 0.003,
        },
      ],
      branches,
    };

    const t0 = performance.now();
    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.01, // 200 steps
      enableCda: true,
    });
    const result = solver.solve();
    const elapsedMs = performance.now() - t0;

    assert.equal(result.metrics.totalSteps, 200);
    assert.equal(result.metrics.luFactorizations, 3);
    assert.ok(elapsedMs < 1000, `200-bus sparse EMT solve took ${elapsedMs.toFixed(1)} ms (< 1000 ms expected)`);
    const vMid = result.busVoltages.get("Bus_100");
    assert.ok(vMid && vMid.length === 200);
  });

  it("should lower PSCAD XML directly to EmtNetlist and execute async simulation with zero-copy transferables", async () => {
    const { extractEmtNetlistFromXml, runEmtSimulationFromXmlAsync } = await import("../src/index.js");
    const xml = `<project name="FastPathCase" version="5.0">
      <paramlist name="Settings">
        <param name="time_step" value="50" />
        <param name="time_duration" value="0.05" />
      </paramlist>
      <definitions>
        <Definition classid="StationDefn" name="DS" />
        <Definition classid="UserCmpDefn" name="Main">
          <schematic classid="UserCanvas">
            <bus id="B1" name="Bus1" x="100" y="100" vbase="230" length="40" />
            <bus id="B2" name="Bus2" x="200" y="100" vbase="230" length="40" />
            <user id="S1" defn="master:source_3p" x="80" y="100">
              <paramlist>
                <param name="Vm" value="230.0" />
                <param name="F" value="60.0" />
              </paramlist>
            </user>
            <user id="R1" defn="master:resistor" x="150" y="100">
              <paramlist>
                <param name="R" value="10.0" />
              </paramlist>
            </user>
            <wire id="W1" x="132" y="100" w="-32" h="0" />
            <wire id="W2" x="168" y="100" w="32" h="0" />
          </schematic>
        </Definition>
      </definitions>
    </project>`;

    const netlist = extractEmtNetlistFromXml(xml);
    assert.ok(netlist.buses.size >= 2);
    assert.ok(netlist.branches.length >= 1);

    const { result, transferables } = await runEmtSimulationFromXmlAsync(xml, {
      timeStepSec: 50e-6,
      durationSec: 0.005,
    });
    assert.equal(result.metrics.totalSteps, 100);
    assert.ok(transferables.length >= 3, "Expected zero-copy transferable ArrayBuffers");
    assert.ok(transferables.every((b) => b instanceof ArrayBuffer && b.byteLength > 0));
  });

  it("should fit rational poles via Gustavsen-Semlyen Vector Fitting and synthesize wideband Carson FD-line models", async () => {
    const { gustavsenVectorFit, synthesizeFdLineModel } = await import("../src/solver/vector-fitting.js");

    // 1. Test Gustavsen-Semlyen pole relocation on a known 3-pole rational function:
    //    f(s) = 0.003 + 12 / (s + 50) + 180 / (s + 800) + 2500 / (s + 12000)
    const nFreqs = 32;
    const omegas = new Float64Array(nFreqs);
    const fReal = new Float64Array(nFreqs);
    const fImag = new Float64Array(nFreqs);
    const truePoles = [-50.0, -800.0, -12000.0];
    const trueRes = [12.0, 180.0, 2500.0];
    const trueD0 = 0.003;

    for (let k = 0; k < nFreqs; k++) {
      const w = Math.pow(10, 0.5 + (5.0 * k) / (nFreqs - 1));
      omegas[k] = w;
      let re = trueD0;
      let im = 0.0;
      for (let m = 0; m < truePoles.length; m++) {
        const p = truePoles[m]!;
        const r = trueRes[m]!;
        const denom = p * p + w * w;
        re += (r * -p) / denom;
        im += (r * -w) / denom;
      }
      fReal[k] = re;
      fImag[k] = im;
    }

    const fit = gustavsenVectorFit(omegas, fReal, fImag, {
      order: 3,
      iterations: 5,
      fitDirectTerm: true,
      enforcePassivity: true,
    });

    assert.equal(fit.poles.length, 3);
    assert.ok(fit.poles.every((p) => p < 0), "All relocated poles must lie in the open left half-plane");
    assert.ok(fit.residues.every((r) => r >= 0), "Passivity-enforced residues must be non-negative");
    assert.ok(fit.rmsError < 5e-3, `Expected small vector fitting RMS error, got ${fit.rmsError}`);

    // 2. Test wideband Carson earth-return FD-line synthesis
    const fdModel = synthesizeFdLineModel(
      {
        lengthKm: 120.0,
        rPerKm: 0.028,
        lPerKm: 0.95e-3,
        cPerKm: 11.5e-9,
        towerHeightM: 25.0,
        conductorRadiusM: 0.016,
        soilResistivityOhmM: 100.0,
      },
      50e-6,
    );

    assert.ok(fdModel.gInf > 0.001 && fdModel.gInf < 0.02);
    assert.ok(fdModel.tauSec > 300e-6 && fdModel.tauSec < 600e-6);
    assert.ok(fdModel.yPoles.length >= 4 && fdModel.yPoles.every((p) => p < 0));
    assert.ok(fdModel.hPoles.length >= 4 && fdModel.hPoles.every((p) => p < 0));
  });

  it("should simulate frequency-dependent (FDPM / ULM) transmission lines on both WASM and TypeScript backends", () => {
    const netlist: EmtNetlist = {
      buses: new Map([
        ["SendBus", { id: "SendBus", name: "SendBus", baseKv: 230.0 }],
        ["RecvBus", { id: "RecvBus", name: "RecvBus", baseKv: 230.0 }],
      ]),
      sources: [
        {
          id: "GenSend",
          bus: "SendBus",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 0.5,
          lSourceHenry: 0.005,
        },
      ],
      branches: [
        {
          id: "LoadRecv",
          fromBus: "RecvBus",
          toBus: "0",
          rOhm: 250.0,
        },
      ],
      transmissionLines: [
        {
          id: "FDLine_120km",
          fromBus: "SendBus",
          toBus: "RecvBus",
          lengthKm: 120.0,
          modelType: "fdpm",
          rPerKm: 0.032,
          lPerKm: 1.0e-3,
          cPerKm: 11.0e-9,
          r0PerKm: 0.18,
          l0PerKm: 3.2e-3,
          c0PerKm: 7.5e-9,
        },
      ],
    };

    const wasmSolver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.01,
      useWasm: true,
    });
    const tsSolver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.01,
      useWasm: false,
    });

    const wasmRes = wasmSolver.solve();
    const tsRes = tsSolver.solve();

    const vRecvWasm = wasmRes.busVoltages.get("RecvBus")!;
    const vRecvTs = tsRes.busVoltages.get("RecvBus")!;
    assert.equal(vRecvWasm.length, 200);
    assert.equal(vRecvTs.length, 200);
    assert.ok(vRecvWasm.every((v) => Number.isFinite(v)));
    assert.ok(vRecvTs.every((v) => Number.isFinite(v)));

    // Receiving end should be energized after propagation delay (~0.4 ms = 8 steps)
    const maxRecvWasm = Math.max(... Array.from(vRecvWasm).map(Math.abs));
    const maxRecvTs = Math.max(... Array.from(vRecvTs).map(Math.abs));
    assert.ok(maxRecvWasm > 100.0, `Expected WASM FDPM receiving voltage > 100 kV, got ${maxRecvWasm}`);
    assert.ok(maxRecvTs > 100.0, `Expected TS FDPM receiving voltage > 100 kV, got ${maxRecvTs}`);
  });

  it("should match full sparseLuFactor to machine precision when using sparseLuAnalyze + sparseLuRefactorize", async () => {
    const {
      SparseTripletBuilder,
      sparseLuAnalyze,
      sparseLuFactor,
      sparseLuRefactorize,
      sparseLuSolve,
    } = await import("@modelscript/runtime");

    const n = 20;
    const builder = new SparseTripletBuilder(n, n, n * 4);
    for (let i = 0; i < n; i++) {
      builder.addStructural(i, i, 4.0);
      if (i + 1 < n) {
        builder.addStructural(i, i + 1, -1.0);
        builder.addStructural(i + 1, i, -1.0);
      }
      if (i + 3 < n) {
        builder.addStructural(i, i + 3, 0.0); // Zero structural slot initially
        builder.addStructural(i + 3, i, 0.0);
      }
    }

    const { ccs, tripletToCcsIdx } = builder.buildCCSWithMap();
    const lu = sparseLuAnalyze(ccs);

    // Mutate values including previously zero structural entries (breaker closing)
    builder.clear();
    for (let i = 0; i < n; i++) {
      builder.addStructural(i, i, 5.5 + i * 0.1);
      if (i + 1 < n) {
        builder.addStructural(i, i + 1, -1.2);
        builder.addStructural(i + 1, i, -1.2);
      }
      if (i + 3 < n) {
        builder.addStructural(i, i + 3, -0.45);
        builder.addStructural(i + 3, i, -0.45);
      }
    }

    const updatedOk = builder.updateCCSValues(ccs, tripletToCcsIdx);
    assert.ok(updatedOk, "Expected in-place CCS value update to succeed");
    const refacOk = sparseLuRefactorize(ccs, lu);
    assert.ok(refacOk, "Expected zero-allocation numeric refactorization to succeed");

    const freshLu = sparseLuFactor(builder.toCCS());
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) rhs[i] = Math.sin(i + 1) * 10.0;

    const xRefac = sparseLuSolve(lu, rhs);
    const xFresh = sparseLuSolve(freshLu, rhs);
    for (let i = 0; i < n; i++) {
      assert.ok(
        Math.abs(xRefac[i]! - xFresh[i]!) < 1e-11,
        `Mismatch at index ${i}: ${xRefac[i]} vs ${xFresh[i]}`,
      );
    }
  });
});


