// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmtSolver, type EmtCircuitDefinition } from "@modelscript/simulate";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { extractEmtNetlist, netlistToEmtCircuit } from "../src/netlist/emt-netlist.js";
import { compileFortranSegment } from "../src/script/fortran-codegen.js";
import type { PscxProject } from "../src/types.js";

describe("PSCAD Fortran Solver Runtime Integration Suite", () => {
  test("Direct EmtSolver: executes custom Fortran block with persistent STORF memory", () => {
    // Fortran block implementing an integrator / low-pass filter:
    // STORF(0) holds previous output y_prev
    // y = y_prev + DELT * (u - y_prev) / Tau
    // STORF(0) = y
    // $Out = y
    const fortranScript = `
#STORAGE REAL:1 INTEGER:0
#LOCAL REAL Tau, y
Tau = 0.01
IF (FIRSTSTEP) THEN
  STORF(0) = 0.0
ENDIF
y = STORF(0) + DELT * ($In - STORF(0)) / Tau
STORF(0) = y
$Out = y
`;

    const compiled = compileFortranSegment(fortranScript, {}, {});

    const dt = 100e-6; // 100 microseconds
    const duration = 0.05; // 50 ms

    const circuit: EmtCircuitDefinition = {
      buses: ["Bus1"],
      rlc: [{ id: "R1", from: "Bus1", to: "GND", r: 10.0 }],
      sources: [
        // 100 V DC source at Bus1
        { id: "Src1", bus: "Bus1", vPeakKv: 0.1, freqHz: 0, dc: true },
      ],
      customFortranBlocks: [
        {
          id: "FilterBlock",
          numRealStates: compiled.numRealStates,
          numIntStates: compiled.numIntStates,
          inputs: [{ portName: "In", sourceId: "Bus1" }],
          outputs: [{ portName: "Out", targetId: "Filter_Out" }],
          step: compiled.step,
        },
      ],
    };

    const solver = new EmtSolver(circuit, {
      timeStepSec: dt,
      durationSec: duration,
    });

    const result = solver.solve();

    assert.ok(result.controlSignals !== undefined, "Control signals should be populated");
    const outSig = result.controlSignals.get("Filter_Out");
    assert.ok(outSig !== undefined, "Filter_Out signal should be present in controlSignals");
    assert.equal(outSig.length, Math.ceil(duration / dt));

    // Initially output starts at 0
    assert.ok(Math.abs(outSig[0]!) < 1.0, `Initial value should be near 0, got ${outSig[0]}`);

    // After 50 ms (5 time constants Tau=10ms), output should approach input (100 V)
    const finalVal = outSig[outSig.length - 1]!;
    assert.ok(finalVal > 95.0 && finalVal <= 100.5, `Final value should approach 100 V, got ${finalVal}`);
  });

  test("Closed-Loop Feedback: Fortran over-voltage relay trips circuit breaker", () => {
    // Fortran script acting as a protection relay:
    // If bus voltage magnitude exceeds 150 V, trip breaker (emit status = 1.0)
    const relayFortran = `
#STORAGE REAL:1 INTEGER:1
#LOCAL REAL v_mag
v_mag = ABS($V_in)
IF (v_mag > 150.0) THEN
  STORI(0) = 1
ENDIF
$TripStatus = STORI(0)
`;

    const compiled = compileFortranSegment(relayFortran, {}, {});

    const dt = 50e-6;
    const duration = 0.04; // 40 ms (approx 2.4 cycles of 60Hz)

    const circuit: EmtCircuitDefinition = {
      buses: ["BusSrc", "BusLoad"],
      rlc: [{ id: "R_load", from: "BusLoad", to: "GND", r: 10.0 }],
      breakers: [
        {
          id: "Bkr1",
          from: "BusSrc",
          to: "BusLoad",
          closedInitially: true,
          rClosedOhm: 0.001,
        },
      ],
      sources: [
        // 200 V peak AC source (exceeds 150 V threshold around t = 1.5 ms)
        { id: "Source1", bus: "BusSrc", vPeakKv: 0.2, freqHz: 60 },
      ],
      customFortranBlocks: [
        {
          id: "OvervoltageRelay",
          numRealStates: compiled.numRealStates,
          numIntStates: compiled.numIntStates,
          inputs: [{ portName: "V_in", sourceId: "BusLoad" }],
          outputs: [{ portName: "TripStatus", targetId: "Bkr1" }],
          step: compiled.step,
        },
      ],
    };

    const solver = new EmtSolver(circuit, {
      timeStepSec: dt,
      durationSec: duration,
    });

    const result = solver.solve();

    const tripSig = result.controlSignals?.get("Bkr1");
    assert.ok(tripSig !== undefined, "Relay trip signal should be tracked");

    // Initially breaker was closed and trip status was 0
    assert.equal(tripSig[0], 0);

    // Later trip status latched to 1
    const finalTrip = tripSig[tripSig.length - 1];
    assert.equal(finalTrip, 1);

    // After breaker opened, load voltage should drop to near zero
    const vLoad = result.busVoltages.get("BusLoad")!;
    const finalVLoad = Math.abs(vLoad[vLoad.length - 1]!);
    assert.ok(finalVLoad < 1.0, `Load voltage after trip should be near zero, got ${finalVLoad}`);
  });

  test("End-to-End Netlist Extraction: lowers custom component definition with Fortran segment", () => {
    // Construct a synthetic PscxProject containing a custom definition with a Fortran segment
    const customFortran = `
#STORAGE REAL:1 INTEGER:0
#LOCAL REAL P, Q, S, PF
P = $P_in
Q = $Q_in
S = SQRT(P * P + Q * Q)
IF (S > 0.001) THEN
  PF = P / S
ELSE
  PF = 1.0
ENDIF
$PF_out = PF
`;

    const project: PscxProject = {
      name: "FortranProjectTest",
      version: "5.0",
      settings: {
        timeStepUs: 50.0,
        durationSec: 0.02,
        startType: "flat",
        frequencyHz: 60.0,
      },
      definitions: new Map([
        [
          "CustomPowerFactorCalc",
          {
            name: "CustomPowerFactorCalc",
            scriptSegments: new Map([
              [
                "fortran",
                {
                  name: "Fortran",
                  content: customFortran,
                },
              ],
            ]),
          },
        ],
      ]),
      rootModule: {
        id: "Main",
        name: "Main",
        buses: [
          { id: "b1", name: "BusA", phaseCount: 1, position: { x: 0, y: 0 } },
          { id: "b2", name: "BusB", phaseCount: 1, position: { x: 100, y: 0 } },
        ],
        components: [
          {
            id: "src1",
            definitionName: "source_1",
            position: { x: 0, y: 0 },
            parameters: { Vm: 10.0, F: 60.0 },
            ports: [
              {
                id: "src_p1",
                name: "p1",
                kind: "electrical",
                dimension: 1,
                position: { x: 0, y: 0 },
                busConnection: "BusA",
              },
            ],
          },
          {
            id: "pf_inst1",
            definitionName: "CustomPowerFactorCalc",
            instanceName: "PF_Meter",
            position: { x: 50, y: 50 },
            parameters: {},
            ports: [
              { id: "port_pin", name: "P_in", kind: "signal", dimension: 1, position: { x: 40, y: 50 } },
              { id: "port_qin", name: "Q_in", kind: "signal", dimension: 1, position: { x: 40, y: 60 } },
              { id: "port_pf", name: "PF_out", kind: "signal", dimension: 1, position: { x: 60, y: 55 } },
            ],
          },
        ],
        wires: [],
      },
      subModules: new Map(),
      linkedLibraries: [],
    };

    // 1. Extract netlist
    const netlist = extractEmtNetlist(project);
    assert.ok(netlist.customFortranBlocks !== undefined);
    assert.equal(netlist.customFortranBlocks.length, 1);
    const fb = netlist.customFortranBlocks[0]!;
    assert.equal(fb.id, "PF_Meter");
    assert.deepEqual(fb.referencedPorts, ["P_in", "Q_in"]);
    assert.deepEqual(fb.assignedPorts, ["PF_out"]);
    assert.equal(fb.outputs?.[0]?.targetId, "PF_Meter");

    // 2. Convert to circuit definition
    const circuit = netlistToEmtCircuit(netlist);
    assert.ok(circuit.customFortranBlocks !== undefined);
    assert.equal(circuit.customFortranBlocks.length, 1);

    // 3. Run EmtSolver
    const solver = new EmtSolver(circuit as unknown as EmtCircuitDefinition, {
      timeStepSec: 50e-6,
      durationSec: 0.01,
    });
    const result = solver.solve();
    assert.ok(result.metrics.totalSteps > 0);
    assert.ok(result.controlSignals !== undefined);
    const pfSignal = result.controlSignals.get("PF_Meter");
    assert.ok(pfSignal !== undefined);
    assert.equal(pfSignal.length, result.metrics.totalSteps);
  });
});
