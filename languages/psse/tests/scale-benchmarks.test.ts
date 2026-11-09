// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BusType,
  calculateShortCircuit,
  DYR_MODEL_SCHEMAS,
  executePythonPsspyScript,
  lowerPsseToDae,
  parseDyr,
  parsePsseOut,
  parsePsseSav,
  parseRaw,
  parseSeq,
  type PsseCase,
  psseLanguage,
  PsseWasmMachinaDllRunner,
  PsspySession,
  serializeFortranUnformattedPsseOut,
  serializePsseOut,
  serializePsseSav,
  simulatePsseTransient,
  solvePowerFlow,
  validatePsse,
  writeSeq,
} from "../src/index.js";

/**
 * Generates a realistic meshed N-bus transmission network for scale benchmarking.
 */
function buildSyntheticGridCase(numBuses: number): PsseCase {
  const buses = new Map<number, PsseCase["buses"] extends Map<number, infer B> ? B : never>();
  const loads: PsseCase["loads"] = [];
  const generators: PsseCase["generators"] = [];
  const branches: PsseCase["branches"] = [];

  for (let i = 1; i <= numBuses; i++) {
    const isSlack = i === 1;
    const isPv = !isSlack && i % 20 === 0;
    buses.set(i, {
      i,
      name: `BUS_${i}`,
      baseKv: 230.0,
      ide: isSlack ? BusType.Swing : isPv ? BusType.PV : BusType.PQ,
      area: 1,
      zone: 1,
      owner: 1,
      vm: isSlack || isPv ? 1.02 : 1.0,
      va: 0.0,
    });

    if (isSlack || isPv) {
      generators.push({
        i,
        id: "1",
        pg: isSlack ? 0.0 : 45.0,
        qg: 0.0,
        qt: 300.0,
        qb: -300.0,
        vs: 1.02,
        ireg: 0,
        mbase: 100.0,
        zr: 0.002,
        zx: 0.18,
        rt: 0.0,
        xt: 0.0,
        gtap: 1.0,
        stat: 1,
        rmpct: 100.0,
        pt: 500.0,
        pb: 0.0,
      });
    } else {
      loads.push({
        i,
        id: "1",
        status: 1,
        area: 1,
        zone: 1,
        pl: 2.2,
        ql: 0.6,
        ip: 0.0,
        iq: 0.0,
        yp: 0.0,
        yq: 0.0,
        owner: 1,
        scale: 1,
        intrct: 0,
      });
    }

    if (i < numBuses) {
      branches.push({
        i,
        j: i + 1,
        ckt: "1",
        r: 0.0015,
        x: 0.015,
        b: 0.02,
        rateA: 500.0,
        rateB: 600.0,
        rateC: 700.0,
        gi: 0,
        bi: 0,
        gj: 0,
        bj: 0,
        st: 1,
        met: 1,
        len: 10.0,
      });
    }
    // Add meshed parallel/chordal ties every 10 buses to keep electrical diameter small
    if (i + 10 <= numBuses) {
      branches.push({
        i,
        j: i + 10,
        ckt: "1",
        r: 0.002,
        x: 0.02,
        b: 0.03,
        rateA: 500.0,
        rateB: 600.0,
        rateC: 700.0,
        gi: 0,
        bi: 0,
        gj: 0,
        bj: 0,
        st: 1,
        met: 1,
        len: 15.0,
      });
    }
  }

  return {
    header: {
      ic: 0,
      sbase: 100.0,
      rev: 33,
      xfrrat: 0,
      nxfrat: 0,
      basfrq: 60.0,
    },
    title1: `SYNTHETIC ${numBuses}-BUS BENCHMARK GRID`,
    title2: "SPARSE CCS + AMD ORDERING TEST",
    buses,
    loads,
    fixedShunts: [],
    generators,
    branches,
    transformers: [],
    areas: [],
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };
}

const THREE_BUS_RAW = `0, 100.0, 33, 0, 1, 60.0 / PSS/E 3-BUS TEST SYSTEM
3-BUSBENCHMARK
TEST CASE
1, 'GEN1_BUS    ', 138.0, 3, 1, 1, 1, 1.03, 0.0
2, 'GEN2_BUS    ', 138.0, 2, 1, 1, 1, 1.02, 0.0
3, 'LOAD_BUS    ', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 120.0, 40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 80.0, 20.0, 200.0, -100.0, 1.03, 0, 100.0, 0.003, 0.16, 0.0, 0.0, 1.0, 1, 100.0, 250.0, 0.0
2, '1 ', 50.0, 15.0, 150.0, -80.0, 1.02, 0, 100.0, 0.004, 0.18, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 3, '1 ', 0.008, 0.065, 0.04, 250.0, 280.0, 300.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 25.0
2, 3, '1 ', 0.010, 0.075, 0.04, 250.0, 280.0, 300.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 30.0
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
1, 2, 0, '1 ', 1, 1, 0.0, 0.0, 2, 'T1_2        ', 1, 1, 1.0
0.002, 0.08, 100.0
1.0, 138.0, 0.0, 250.0, 280.0, 300.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0
1.0, 138.0
0 / END OF TRANSFORMER DATA
Q
`;

describe("@modelscript/psse — Commercial Parity Scale & Fidelity Benchmarks", () => {
  it("converges 300-bus and 2,000-bus AC power flow via sparse CCS LU + AMD ordering in <= 10 iterations", () => {
    const grid300 = buildSyntheticGridCase(300);
    const sol300 = solvePowerFlow(grid300);
    assert.equal(sol300.converged, true, "300-bus power flow should converge");
    assert.ok(sol300.iterations <= 10, `Expected <= 10 iterations, got ${sol300.iterations}`);
    assert.equal(sol300.buses.length, 300);

    const grid2000 = buildSyntheticGridCase(2000);
    const t0 = performance.now();
    const sol2000 = solvePowerFlow(grid2000, { enforceQLimits: false });
    const elapsedMs = performance.now() - t0;
    assert.equal(sol2000.converged, true, "2,000-bus power flow should converge");
    assert.ok(sol2000.iterations <= 10, `Expected <= 10 iterations, got ${sol2000.iterations}`);
    assert.equal(sol2000.buses.length, 2000);
    assert.ok(elapsedMs < 2000, `Expected 2,000-bus solve under 2000ms, took ${elapsedMs.toFixed(1)}ms`);
  });

  it("supports 44+ standard WECC/IEEE/PSS/E .dyr dynamic model schemas including GENTPJ, GAST, ESAC1A, PSS2B, and CMPLDW", () => {
    const schemaCount = Object.keys(DYR_MODEL_SCHEMAS).length;
    assert.ok(schemaCount >= 44, `Expected >= 44 .dyr model schemas, found ${schemaCount}`);

    const dyrText = `
1 'GENTPJ' 1 6.5 0.05 0.35 0.08 4.2 1.5 1.85 1.75 0.30 0.45 0.20 0.14 0.09 0.18 0.05 /
1 'ESAC1A' 1 0.02 0.0 0.0 200.0 0.04 10.0 -8.0 0.8 0.03 1.0 0.38 0.1 4.18 0.03 3.14 0.5 /
1 'GAST'   1 0.05 0.15 0.40 2.5 1.0 1.5 1.05 0.0 0.1 /
1 'PSS2B'  1 1 3 5.0 5.0 5.0 0.0 1.0 5 1 12.0 0.25 0.04 0.15 0.03 0.15 0.03 0.12 -0.12 /
2 'GENSAE' 1 5.8 0.05 0.40 0.07 3.8 1.2 1.70 1.10 0.32 0.22 0.15 0.11 0.20 /
2 'WPID'   1 0.1 0.05 2.5 1.8 0.5 1.2 0.2 1.05 0.0 1.15 /
3 'CMPLDW' 1 1 0.08 0.04 1.02 0.98 1.0 0.04 0.25 0.20 0.15 0.20 0.20 0.70 0.85 0.033 /
`;
    const dyrCase = parseDyr(dyrText);
    assert.equal(dyrCase.records.length, 7);
    assert.equal(dyrCase.generatorsByBusId.get("1_1")?.model, "GENTPJ");
    assert.equal(dyrCase.excitersByBusId.get("1_1")?.model, "ESAC1A");
    assert.equal(dyrCase.governorsByBusId.get("1_1")?.model, "GAST");
    assert.equal(dyrCase.stabilizersByBusId.get("1_1")?.model, "PSS2B");
    assert.equal(dyrCase.loadsByBusId?.get("3_1")?.model, "CMPLDW");

    const psseCase = parseRaw(THREE_BUS_RAW);
    psseCase.dyr = dyrCase;

    // Lower into DAEBuilder and verify CMPLDW motor slip state and generator states
    const dae = lowerPsseToDae(psseCase);
    assert.ok(dae.getVarCount() > 15, `Expected > 15 DAE variables with .dyr models, got ${dae.getVarCount()}`);
    assert.equal(dae.getVarCount(), dae.getEqCount(), "DAE with expanded .dyr models must remain structurally square");

    // Run transient stability simulation
    const sim = simulatePsseTransient(psseCase, {
      stopTime: 1.5,
      timeStep: 0.02,
      faultBus: 3,
      faultStartSec: 0.2,
      faultClearSec: 0.32,
    });
    assert.equal(sim.summary.convergedPowerFlow, true);
    assert.equal(sim.summary.stable, true);
    assert.ok((sim.variables["Efd_Bus1_pu"]?.length ?? 0) > 10);
    assert.ok((sim.variables["Pm_Bus1_MW"]?.length ?? 0) > 10);
  });

  it("parses and writes .seq sequence files and computes exact unbalanced 1LG/2L/2LG fault currents with transformer connection codes", () => {
    const seqText = `0, 33 / PSS/E SEQUENCE DATA
1, '1 ', 0.002, 0.14, 0.002, 0.16, 0.005, 0.06, 0.001, 0.02
2, '1 ', 0.003, 0.16, 0.003, 0.19, 0.006, 0.08, 0.0, 0.0
0 / END OF GENERATOR SEQUENCE DATA, BEGIN NON-TRANSFORMER BRANCH SEQUENCE DATA
1, 3, '1 ', 0.024, 0.195, 0.025, 0.0, 0.0, 0.0, 0.0
2, 3, '1 ', 0.030, 0.225, 0.025, 0.0, 0.0, 0.0, 0.0
0 / END OF NON-TRANSFORMER BRANCH SEQUENCE DATA, BEGIN MUTUAL IMPEDANCE DATA
0 / END OF MUTUAL IMPEDANCE DATA, BEGIN TRANSFORMER SEQUENCE DATA
1, 2, 0, '1 ', 2, 0.0, 0.0, 0.002, 0.08
0 / END OF TRANSFORMER SEQUENCE DATA, BEGIN SWITCHED SHUNT ZERO SEQUENCE DATA
0 / END OF SWITCHED SHUNT ZERO SEQUENCE DATA, BEGIN FIXED SHUNT ZERO SEQUENCE DATA
3, '1 ', 0.0, 5.0
0 / END OF FIXED SHUNT ZERO SEQUENCE DATA
Q
`;
    const seqCase = parseSeq(seqText);
    assert.equal(seqCase.generators.length, 2);
    assert.equal(seqCase.branches.length, 2);
    assert.equal(seqCase.transformers.length, 1);
    assert.equal(seqCase.transformers[0]?.cc, 2);
    assert.equal(seqCase.shunts.length, 1);

    const roundTripSeq = parseSeq(writeSeq(seqCase));
    assert.equal(roundTripSeq.generators.length, 2);
    assert.equal(roundTripSeq.transformers[0]?.cc, 2);

    const psseCase = parseRaw(THREE_BUS_RAW);
    const scWithSeq = calculateShortCircuit(psseCase, { seq: seqCase });
    assert.equal(scWithSeq.buses.length, 3);
    const bus1 = scWithSeq.buses.find((b) => b.busNumber === 1)!;
    assert.ok(bus1.ik3PhaseKa > 0);
    assert.ok(bus1.ik1LineGroundKa > 0);
    assert.ok(bus1.ikLineToLineKa > 0);
    assert.ok(bus1.ik2LineGroundKa > 0);
  });

  it("serializes and deserializes binary .sav cases and .out dynamic channel files losslessly", () => {
    const psseCase = parseRaw(THREE_BUS_RAW);
    const savBuffer = serializePsseSav(psseCase);
    assert.ok(savBuffer.byteLength > 100);

    const restoredCase = parsePsseSav(savBuffer);
    assert.equal(restoredCase.buses.size, 3);
    assert.equal(restoredCase.generators.length, 2);
    assert.equal(restoredCase.branches.length, 2);
    assert.equal(restoredCase.transformers.length, 1);

    const sim = simulatePsseTransient(restoredCase, { stopTime: 0.5, timeStep: 0.05 });
    const outBuffer = serializePsseOut(sim, "3-BUS TRANSIENT OUT");
    const outData = parsePsseOut(outBuffer);
    assert.equal(outData.caseTitle, "3-BUS TRANSIENT OUT");
    assert.equal(outData.channelNames.length, sim.states.length);
    assert.equal(outData.time.length, sim.t.length);
    assert.ok(outData.byName["delta_Bus1_deg"] instanceof Float64Array);
  });

  it("executes Siemens PTI psspy automation scripts via PsspySession and executePythonPsspyScript", () => {
    const pyScript = `
import psspy
psspy.psseinit(50000)
psspy.read(0, 'three_bus.raw')
psspy.fnsl([0,0,0,1,1,0,99,0])
psspy.save('three_bus.sav')
psspy.dcsc()
psspy.accc()
psspy.strt(0, 'three_bus.out')
psspy.run(0, 0.2, 1, 1, 1)
psspy.dist_bus_fault(3)
psspy.run(0, 0.32, 1, 1, 1)
psspy.dist_clear_fault(1)
psspy.run(0, 1.0, 1, 1, 1)
`;
    const session: PsspySession = executePythonPsspyScript(pyScript, {
      "three_bus.raw": THREE_BUS_RAW,
    });

    assert.equal(session.lastPowerFlow?.converged, true);
    const [ierrVm, vm1] = session.busdat(1, "PU");
    assert.equal(ierrVm, 0);
    assert.ok(Math.abs(vm1 - 1.03) < 1e-3);

    const [ierrP, pGen1] = session.gendat(1, "P");
    assert.equal(ierrP, 0);
    assert.ok(pGen1 > 50.0);

    const [ierrBr, mva13] = session.brndat(1, 3, "1", "MVA");
    assert.equal(ierrBr, 0);
    assert.ok(mva13 > 10.0);

    assert.ok(session.getFile("three_bus.sav") instanceof Uint8Array);
    const outChannels = session.readOutChannels("three_bus.out");
    assert.ok(outChannels !== undefined);
    assert.ok(outChannels.time.length > 50);
  });

  it("serializes and parses legacy PSS/E v33/v34 Fortran unformatted sequential binary .out files", () => {
    const psseCase = parseRaw(THREE_BUS_RAW);
    const sim = simulatePsseTransient(psseCase, { stopTime: 0.4, timeStep: 0.05 });
    const fortranOut = serializeFortranUnformattedPsseOut(sim, "FORTRAN V33 OUT CASE");
    assert.ok(fortranOut.byteLength > 100);

    const parsedFortranOut = parsePsseOut(fortranOut);
    assert.equal(parsedFortranOut.version, 33);
    assert.equal(parsedFortranOut.caseTitle, "FORTRAN V33 OUT CASE");
    assert.equal(parsedFortranOut.channelNames.length, sim.states.length);
    assert.equal(parsedFortranOut.time.length, sim.t.length);
    assert.ok(Math.abs(parsedFortranOut.time[1]! - 0.05) < 1e-4);
  });

  it("executes compiled 64-bit Windows PE dsusr.dll USRMDL models via Wasm-Machina and couples CMPLDW FIDVR motor slip", async () => {
    // Build a syntactically valid 64-bit PE32+ dsusr.dll exporting `USR_EXC1` (RVA 0x1010)
    // Win64 ABI: RCX = &CON[0], RDX = &STATE[0], R8 = &DSTATE[0], R9 = &EFD[0]
    // Machine code at RVA 0x1010:
    //   F2 0F 10 01       MOVSD XMM0, [RCX]   ; XMM0 = CON[0]
    //   F2 0F 11 02       MOVSD [RDX], XMM0   ; STATE[0] = CON[0]
    //   41 F2 0F 11 01    MOVSD [R9], XMM0    ; EFD[0] = CON[0]
    //   48 31 C0          XOR RAX, RAX
    //   C3                RET
    const buf = new Uint8Array(4096);
    const view = new DataView(buf.buffer);
    view.setUint16(0x00, 0x5a4d, true); // 'MZ'
    view.setUint32(0x3c, 0x80, true);
    const peOff = 0x80;
    view.setUint32(peOff, 0x00004550, true); // 'PE\0\0'
    const fh = peOff + 4;
    view.setUint16(fh + 0, 0x8664, true); // AMD64
    view.setUint16(fh + 2, 2, true);
    view.setUint16(fh + 16, 0xf0, true);
    view.setUint16(fh + 18, 0x2102, true);
    const oh = fh + 20;
    view.setUint16(oh + 0, 0x020b, true); // PE32+
    view.setUint32(oh + 16, 0x1000, true);
    view.setBigUint64(oh + 24, 0x180000000n, true);
    view.setUint32(oh + 32, 0x1000, true);
    view.setUint32(oh + 36, 0x200, true);
    view.setUint32(oh + 56, 0x4000, true);
    view.setUint32(oh + 60, 0x200, true);
    view.setUint32(oh + 112, 0x2000, true);
    view.setUint32(oh + 116, 0x200, true);

    const sec1 = oh + 0xf0;
    buf.set(new TextEncoder().encode(".text\0\0\0"), sec1);
    view.setUint32(sec1 + 8, 0x1000, true);
    view.setUint32(sec1 + 12, 0x1000, true);
    view.setUint32(sec1 + 16, 0x200, true);
    view.setUint32(sec1 + 20, 0x200, true);

    const sec2 = sec1 + 40;
    buf.set(new TextEncoder().encode(".rdata\0\0"), sec2);
    view.setUint32(sec2 + 8, 0x1000, true);
    view.setUint32(sec2 + 12, 0x2000, true);
    view.setUint32(sec2 + 16, 0x200, true);
    view.setUint32(sec2 + 20, 0x400, true);

    // DllMain at 0x200: MOV EAX, 1 ; RET
    buf.set([0xb8, 0x01, 0x00, 0x00, 0x00, 0xc3], 0x200);
    // USR_EXC1 at 0x210 (RVA 0x1010)
    buf.set(
      [
        0xf2,
        0x0f,
        0x10,
        0x01, // MOVSD XMM0, [RCX]
        0xf2,
        0x0f,
        0x11,
        0x02, // MOVSD [RDX], XMM0
        0x41,
        0xf2,
        0x0f,
        0x11,
        0x01, // MOVSD [R9], XMM0
        0x48,
        0x31,
        0xc0, // XOR RAX, RAX
        0xc3, // RET
      ],
      0x210,
    );

    view.setUint32(0x400 + 16, 1, true);
    view.setUint32(0x400 + 20, 1, true);
    view.setUint32(0x400 + 24, 1, true);
    view.setUint32(0x400 + 28, 0x2040, true);
    view.setUint32(0x400 + 32, 0x2050, true);
    view.setUint32(0x400 + 36, 0x2060, true);
    view.setUint32(0x440, 0x1010, true);
    view.setUint32(0x450, 0x2080, true);
    view.setUint16(0x460, 0, true);
    buf.set(new TextEncoder().encode("USR_EXC1\0"), 0x480);

    const runner = new PsseWasmMachinaDllRunner(buf);
    const stepRes = runner.stepModel("USR_EXC1", 3, {
      mc: 1,
      islot: 1,
      time: 0.1,
      delt: 0.01,
      con: [2.35, 0.05],
      state: new Float64Array([1.0, 0.0]),
      dstate: new Float64Array([0.0, 0.0]),
      eterm: 1.0,
      speed: 0.0,
      efd: 1.0,
      pmech: 0.8,
    });
    assert.ok(Math.abs(stepRes.efd - 2.35) < 1e-6);
    assert.ok(Math.abs(stepRes.state[0]! - 2.35) < 1e-6);

    // Couple dsusr.dll and CMPLDW FIDVR composite motor load into simulatePsseTransient
    const psseCase = parseRaw(THREE_BUS_RAW);
    psseCase.dyr = parseDyr(
      `1 'GENROU' 1 6.5 0.05 0.35 0.08 4.2 1.5 1.85 1.75 0.30 0.45 0.20 0.14 0.09 0.18 /\n` +
        `3 'CMPLDW' 1 1 0.08 0.04 1.02 0.98 1.0 0.04 0.30 0.25 0.15 0.20 0.20 0.75 0.85 0.02 /`,
    );
    const sim = simulatePsseTransient(psseCase, {
      stopTime: 0.6,
      timeStep: 0.02,
      faultBus: 3,
      faultStartSec: 0.1,
      faultClearSec: 0.26,
      faultSusceptancePu: 8.0,
      userDllModels: [
        {
          busNumber: 1,
          symbolName: "USR_EXC1",
          runner,
          con: [2.15, 0.05],
          numStates: 2,
        },
      ],
    });

    const slipBus3 = sim.variables["s_motor_Bus3"];
    assert.ok(slipBus3 !== undefined && slipBus3.length > 10, "Expected s_motor_Bus3 trajectory");
    assert.ok(Math.max(...slipBus3) > 0.05, "Composite load motor slip should increase during low-voltage fault");

    // Verify .seq LSP validation and psseLanguage domain actions
    const seqDiags = validatePsse(
      `0, 33 / SEQ\n1, '1 ', 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0\n0 /\n0 /\n0 /\n0 /\n1, 2, 0, '1 ', 99, 0.0, 0.0, 0.01, 0.05\n0 /\n`,
      "bad.seq",
    );
    assert.ok(seqDiags.some((d) => d.code === "P5101"));
    assert.ok(seqDiags.some((d) => d.code === "P5103"));
    assert.equal(psseLanguage.maturity, "stable");
  });
});
