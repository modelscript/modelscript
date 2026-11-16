// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateWasmSoaArena,
  analyzeFrequencyNadirReachability,
  caseToSoaTables,
  extractPowerFlowNetlist,
  extractPowerFlowNetlistFromSoa,
  lintPsseWorkspace,
  parseRaw,
  parseRawToSoa,
  simulatePsseTransient,
  solvePowerFlow,
  solvePowerFlowFromRawText,
  verifyCriticalClearingBarrier,
  verifyPsseTrajectoryStl,
  verifyRasSpsBmc,
} from "../src/index.js";

const SAMPLE_RAW = `0, 100.0, 33, 0, 0, 60.0 /
FORMAL TEST CASE
LINE 2
1, 'SLACK_GEN   ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'LOAD_BUS    ', 230.000, 1, 1, 1, 1, 0.9800, -5.0000
3, 'GEN_2       ', 230.000, 2, 1, 1, 1, 1.0000, 2.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 200.000, 40.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ',  80.0, 0.0, 100.0, -50.0, 1.0, 0, 200.0, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
3, '1 ', 120.0, 0.0, 100.0, -50.0, 1.0, 0, 200.0, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.005, 0.050, 0.020, 400.0, 440.0, 480.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 10.0
2, 3, '1 ', 0.005, 0.050, 0.020, 400.0, 440.0, 480.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 10.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;

describe("PSS/E Batch 5 Formal Verification & Script Dataflow (P7005, P8001, P8003, P8004)", () => {
  it("P7005 detects .idv RUN before STRT, unclosed DIST_BUS_FAULT, and missing bus refs", () => {
    const badIdv = `RUN, 0.5, 0, 1, 1, 0
DIST_BUS_FAULT, 999, 0, 0.0, 0.0
`;
    const diags = lintPsseWorkspace(
      new Map([
        ["file:///ws/base.raw", SAMPLE_RAW],
        ["file:///ws/study.idv", badIdv],
      ]),
      "file:///ws/base.raw",
    );
    const p7005 = diags.filter((d) => d.code === "P7005");
    assert.ok(p7005.length >= 3, `Expected >= 3 P7005 diagnostics, got ${p7005.length}`);
    assert.ok(p7005.some((d) => d.message.includes("STRT")));
    assert.ok(p7005.some((d) => d.message.includes("999")));
    assert.ok(p7005.some((d) => d.message.includes("DIST_CLEAR_FAULT")));
  });

  it("P8001 proves contradictory RAS/SPS race condition via CDCL SAT", () => {
    const conflicts = verifyRasSpsBmc([
      { id: "RAS_OPEN_LINE", actions: [{ kind: "open_branch", target: "1-2-1" }] },
      { id: "RAS_RECLOSE_LINE", actions: [{ kind: "close_branch", target: "1-2-1" }] },
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.code, "P8001");
  });

  it("P8003 detects UFLS breach via ZonotopeReachabilitySolver and certifies safe under smaller loss", () => {
    const psseCase = parseRaw(SAMPLE_RAW);
    // 120 MW loss out of 400 MVA with low inertia/slow governor breaches 59.5 Hz
    const risky = analyzeFrequencyNadirReachability(psseCase, {
      contingencyLossMw: 120,
      uflsThresholdHz: 59.5,
      uncertaintyFraction: 0.1,
    });
    assert.equal(risky.safe, false);
    assert.ok(risky.diagnostic);
    assert.equal(risky.diagnostic!.code, "P8003");
    assert.ok(risky.nadirRangeHz[0] <= 59.5);

    const safe = analyzeFrequencyNadirReachability(psseCase, {
      contingencyLossMw: 5,
      uflsThresholdHz: 59.5,
      uncertaintyFraction: 0.05,
    });
    assert.equal(safe.safe, true);
    assert.equal(safe.isCertifiedSafe, true);
    assert.equal(safe.diagnostic, undefined);
  });

  it("P8004 evaluates STL robustness against NERC PRC-024/029 limits", () => {
    const psseCase = parseRaw(SAMPLE_RAW);
    const sim = simulatePsseTransient(psseCase, { stopTime: 0.5, timeStep: 0.02 });
    const passRes = verifyPsseTrajectoryStl(sim, { vMinPu: 0.5, fMinHz: 58.0, fMaxHz: 62.0 });
    assert.equal(passRes.satisfied, true);
    assert.equal(passRes.diagnostics.length, 0);

    const strictRes = verifyPsseTrajectoryStl(sim, { vMinPu: 1.5 });
    assert.equal(strictRes.satisfied, false);
    assert.ok(strictRes.robustness < 0);
    assert.ok(strictRes.diagnostics.some((d) => d.code === "P8004"));
  });

  it("P8002 detects excessive clearing time vs CCT SOS/Lyapunov barrier", () => {
    const psseCase = parseRaw(SAMPLE_RAW);
    const fastClear = verifyCriticalClearingBarrier(psseCase, { clearingTimeSec: 0.05 });
    assert.equal(fastClear.safe, true);
    assert.ok(fastClear.minCctSec > 0.05);

    const slowClear = verifyCriticalClearingBarrier(psseCase, { clearingTimeSec: 0.45, postFaultXRatio: 1.5 });
    assert.equal(slowClear.safe, false);
    assert.ok(slowClear.diagnostics.some((d) => d.code === "P8002"));
  });

  it("parseRawToSoa matches parseRaw numeric tables with typed Struct-of-Arrays buffers", () => {
    const c = parseRaw(SAMPLE_RAW);
    const soaFromRaw = parseRawToSoa(SAMPLE_RAW);
    const soaFromCase = caseToSoaTables(c);

    assert.equal(soaFromRaw.nBuses, 3);
    assert.equal(soaFromRaw.nLoads, 1);
    assert.equal(soaFromRaw.nGenerators, 2);
    assert.equal(soaFromRaw.nBranches, 2);
    assert.deepEqual(Array.from(soaFromRaw.busId), Array.from(soaFromCase.busId));
    assert.deepEqual(Array.from(soaFromRaw.genPg), Array.from(soaFromCase.genPg));
    assert.deepEqual(Array.from(soaFromRaw.brX), Array.from(soaFromCase.brX));
  });

  it("solvePowerFlowFromRawText and extractPowerFlowNetlistFromSoa match full parseRaw + solvePowerFlow", () => {
    const fullCase = parseRaw(SAMPLE_RAW);
    const soa = parseRawToSoa(SAMPLE_RAW);
    const fullNet = extractPowerFlowNetlist(fullCase);
    const soaNet = extractPowerFlowNetlistFromSoa(soa);

    assert.equal(soaNet.nBuses, fullNet.nBuses);
    assert.equal(soaNet.metrics.totalLoadMw, fullNet.metrics.totalLoadMw);
    assert.equal(soaNet.metrics.totalGenMw, fullNet.metrics.totalGenMw);

    const solFull = solvePowerFlow(fullCase, { tolerance: 1e-6 });
    const solSoa = solvePowerFlowFromRawText(SAMPLE_RAW, { tolerance: 1e-6 });
    assert.equal(solFull.converged, true);
    assert.equal(solSoa.converged, true);
    assert.equal(solSoa.buses.length, solFull.buses.length);
    for (let i = 0; i < solFull.buses.length; i++) {
      assert.ok(Math.abs(solSoa.buses[i]!.vm - solFull.buses[i]!.vm) < 1e-8);
      assert.ok(Math.abs(solSoa.buses[i]!.va - solFull.buses[i]!.va) < 1e-6);
    }
  });

  it("stabilizes stressed heavy-load cases via Iwamoto backtracking and HELM fallback", () => {
    const stressedRaw = `0, 100.0, 33, 0, 0, 60.0 /
STRESSED RADIAL FEEDER
LINE 2
1, 'SLACK       ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'HEAVY_LOAD  ', 230.000, 1, 1, 1, 1, 1.0000, 0.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 85.000, 35.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 85.0, 0.0, 200.0, -200.0, 1.0, 0, 200.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.02, 0.22, 0.0, 400.0, 400.0, 400.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 10.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const sol = solvePowerFlowFromRawText(stressedRaw, { maxIterations: 20, tolerance: 1e-5 });
    assert.equal(sol.converged, true, `Expected stressed feeder to converge, mismatch=${sol.maxMismatchPu}`);
    assert.ok(sol.buses[1]!.vm < 1.0 && sol.buses[1]!.vm > 0.5);
  });

  it("attaches P8004 STL and P8002 critical clearing formal checks when simulatePsseTransient verifyFormal=true", () => {
    const psseCase = parseRaw(SAMPLE_RAW);
    const sim = simulatePsseTransient(psseCase, {
      stopTime: 0.8,
      timeStep: 0.02,
      faultStartSec: 0.1,
      faultClearSec: 0.16,
      verifyFormal: { criticalClearing: true, stl: { vMinPu: 0.4, fMinHz: 57.0, fMaxHz: 63.0 } },
    });
    assert.ok(sim.formalVerification);
    assert.ok(sim.formalVerification.stl);
    assert.ok(sim.formalVerification.clearingBarrier);
    assert.equal(sim.formalVerification.stl.satisfied, true);
    assert.equal(sim.formalVerification.clearingBarrier.safe, true);
  });

  it("regulates ULTC transformer taps (cod1=1) and switched shunts (modsw=1) within deadbands with hysteresis", () => {
    const ultcRaw = [
      "0, 100.0, 33, 0, 1, 60.0 / ULTC + Switched Shunt Control",
      "1, 'SLACK', 138.0, 3, 1, 1, 1, 1.00, 0.0 /",
      "2, 'REG  ', 138.0, 1, 1, 1, 1, 1.00, 0.0 /",
      "0 / END OF BUS DATA, BEGIN LOAD DATA",
      "2, '1 ', 1, 1, 1, 90.0, 65.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 /",
      "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
      "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
      "1, '1 ', 90.0, 65.0, 300.0, -300.0, 1.00, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 300.0, 0.0 /",
      "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
      "0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA",
      "1, 2, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'ULTC1', 1, 1, 1.0, 0, 1.0, 0, 1.0, 0, 1.0, '          '",
      "0.004, 0.14, 100.0",
      "1.05, 0.0, 0.0, 200.0, 200.0, 200.0, 1, 2, 1.10, 0.90, 1.015, 0.985, 33, 0, 0.0, 0.0, 0.0",
      "1.00, 0.0 /",
      "0 / END OF TRANSFORMER DATA",
      "0 / END OF AREA DATA",
      "0 / END OF TWO-TERMINAL DC DATA",
      "0 / END OF VSC DC DATA",
      "2, 1, 0, 1, 1.02, 0.98, 2, 100.0, ' ', -45.0, 3, 15.0 /",
      "0 / END OF SWITCHED SHUNT DATA",
      "Q",
    ].join("\n");

    const parsed = parseRaw(ultcRaw);
    const fixedSol = solvePowerFlow(parsed, { adjustTaps: false, adjustSwitchedShunts: false });
    const regSol = solvePowerFlow(parsed, { adjustTaps: true, adjustSwitchedShunts: true });
    assert.equal(regSol.converged, true);
    assert.ok((regSol.controlSummary?.tapAdjustments ?? 0) > 0, "Expected ULTC tap stepping");
    assert.ok((regSol.controlSummary?.shuntAdjustments ?? 0) > 0, "Expected switched-shunt stepping");
    const vFixed = fixedSol.buses.find((b) => b.busNumber === 2)!.vm;
    const vReg = regSol.buses.find((b) => b.busNumber === 2)!.vm;
    assert.ok(vFixed < 0.95, `Expected unregulated V2 (${vFixed}) to sag below deadband`);
    assert.ok(
      vReg > vFixed && vReg >= 0.975,
      `Expected ULTC/shunt control to lift V2 (${vReg}) above fixed (${vFixed})`,
    );
  });

  it("supports distributedSlack dispatch and autoIslandPartition across disconnected islands", () => {
    const c = parseRaw(SAMPLE_RAW);
    c.generators[1]!.pt = 300;
    c.generators[1]!.pb = 0;
    const distSol = solvePowerFlow(c, { distributedSlack: true });
    assert.equal(distSol.converged, true);
    assert.ok((distSol.controlSummary?.distributedSlackPasses ?? 0) >= 1);

    const twoIslandRaw = [
      "0, 100.0, 33, 0, 1, 60.0 / Two Independent Islands",
      "1, 'ISL1_SLK', 230.0, 3, 1, 1, 1, 1.02, 0.0 /",
      "2, 'ISL1_LD ', 230.0, 1, 1, 1, 1, 1.00, 0.0 /",
      "11, 'ISL2_SLK', 230.0, 3, 1, 1, 1, 1.01, 0.0 /",
      "12, 'ISL2_LD ', 230.0, 1, 1, 1, 1, 1.00, 0.0 /",
      "0 / END OF BUS DATA, BEGIN LOAD DATA",
      "2, '1 ', 1, 1, 1, 40.0, 10.0, 0, 0, 0, 0, 1, 1, 0 /",
      "12, '1 ', 1, 1, 1, 50.0, 15.0, 0, 0, 0, 0, 1, 1, 0 /",
      "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
      "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
      "1, '1 ', 40.0, 0.0, 200.0, -200.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0 /",
      "11, '1 ', 50.0, 0.0, 200.0, -200.0, 1.01, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0 /",
      "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
      "1, 2, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0, 0, 0, 0, 1, 1, 1.0 /",
      "11, 12, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0, 0, 0, 0, 1, 1, 1.0 /",
      "0 / END OF BRANCH DATA",
      "Q",
    ].join("\n");
    const islSol = solvePowerFlow(parseRaw(twoIslandRaw), { autoIslandPartition: true });
    assert.equal(islSol.converged, true);
    assert.equal(islSol.controlSummary?.islandsSolved, 2);
  });

  it("regularizes ZIP loads smoothly below V < 0.5 pu and allocates WASM linear-memory SoA arena", () => {
    const deepSagRaw = [
      "0, 100.0, 33, 0, 1, 60.0 / Deep Voltage Sag ZIP Regularization",
      "1, 'SLK', 138.0, 3, 1, 1, 1, 1.00, 0.0 /",
      "2, 'SAG', 138.0, 1, 1, 1, 1, 0.45, -20.0 /",
      "0 / END OF BUS DATA, BEGIN LOAD DATA",
      "2, '1 ', 1, 1, 1, 180.0, 140.0, 20.0, 10.0, 5.0, 5.0, 1, 1, 0 /",
      "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
      "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
      "1, '1 ', 100.0, 0.0, 500.0, -500.0, 1.00, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 500.0, 0.0 /",
      "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
      "1, 2, '1 ', 0.04, 0.35, 0.0, 500.0, 500.0, 500.0, 0, 0, 0, 0, 1, 1, 1.0 /",
      "0 / END OF BRANCH DATA",
      "Q",
    ].join("\n");
    const sol = solvePowerFlowFromRawText(deepSagRaw, { maxIterations: 30, tolerance: 1e-4 });
    assert.equal(
      sol.converged,
      true,
      `Expected regularized deep-sag ZIP power flow to converge, mismatch=${sol.maxMismatchPu}`,
    );
    assert.ok(
      sol.buses[1]!.vm < 0.5 && sol.buses[1]!.vm > 0.2,
      `Expected regularized sag bus voltage in (0.2, 0.5), got ${sol.buses[1]!.vm}`,
    );

    const soa = parseRawToSoa(deepSagRaw);
    const arena = allocateWasmSoaArena(soa);
    assert.equal(arena.nBuses, 2);
    assert.deepEqual(Array.from(arena.busVm), Array.from(soa.busVm));
  });
});
