// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeFrequencyNadirReachability,
  analyzeN11Contingencies,
  auditNercCompliance,
  calculateFcitc,
  evaluateBreakerDuty,
  formatPowerFlowStudyReport,
  generatePsseProofManifest,
  lintPsse,
  parseMonFile,
  parseRaw,
  parseSubFile,
  resolveSubsystemBuses,
  searchCriticalClearingTime,
  solvePowerFlow,
  verifyDiscreteControlChattering,
  verifyPowerFlowSolvabilityNlsat,
  verifyPssePolyglotDrift,
  verifyPssePscadEquivalence,
  verifyRasSchemesUnboundedIc3,
  verifyRasUnboundedSafetyIc3,
  verifyStochasticRenewableBarrier,
} from "../src/index.js";

const SAMPLE_3BUS_RAW = `0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0
3-BUS TEST CASE
MODEL SCRIPT
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.02000, 0.0000
2, 'PVBUS', 230.0000, 2, 1, 1, 1, 1.01000, -1.0000
3, 'LOADB', 230.0000, 1, 2, 1, 1, 0.99000, -3.0000
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 2, 1, 80.000, 20.000, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 50.0, 0.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 150.0, 0.0
2, '1 ', 40.0, 0.0, 80.0, -40.0, 1.01, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2, '1 ', 0.01000, 0.05000, 0.02000, 150.0, 175.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
1, 3, '1 ', 0.01500, 0.08000, 0.02500, 120.0, 140.0, 160.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
2, 3, '1 ', 0.01200, 0.06000, 0.02000, 120.0, 140.0, 160.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA
Q`;

describe("PSS/E Tier 1/2 Studies & Phase 3 Formal Verification", () => {
  it("parses .sub and .mon files and resolves subsystem buses", () => {
    const psseCase = parseRaw(SAMPLE_3BUS_RAW);
    const subFile = parseSubFile(`
      SUBSYSTEM 'GEN_AREA'
        AREA 1
      END
      SUBSYSTEM 'LOAD_AREA'
        AREA 2
      END
    `);
    const monFile = parseMonFile(`
      MONITOR VOLTAGE RANGE SUBSYSTEM 'LOAD_AREA' 0.95 1.05
      MONITOR BRANCHES IN AREA 1 RATEB 100
    `);

    const genBuses = resolveSubsystemBuses(psseCase, subFile.subsystems.get("GEN_AREA")!);
    const loadBuses = resolveSubsystemBuses(psseCase, subFile.subsystems.get("LOAD_AREA")!);
    assert.deepEqual([...genBuses].sort(), [1, 2]);
    assert.deepEqual([...loadBuses], [3]);
    assert.equal(monFile.voltageLimits.length, 1);
    assert.equal(monFile.branchLimits[0]?.ratingSet, "RATEB");
  });

  it("runs unified report formatter, N-1-1, FCITC, ANSI C37 breaker duty, and CCT search", () => {
    const psseCase = parseRaw(SAMPLE_3BUS_RAW);
    const pf = solvePowerFlow(psseCase);
    assert.equal(pf.converged, true);

    const csv = formatPowerFlowStudyReport(pf, "csv", "3-BUS");
    assert.ok(csv.includes("bus_number,name,base_kv"));
    const html = formatPowerFlowStudyReport(pf, "html", "3-BUS");
    assert.ok(html.includes("Power Flow — 3-BUS"));

    const n11 = analyzeN11Contingencies(psseCase, { maxPrimaryOutages: 3, maxSecondaryOutages: 3 });
    assert.ok(n11.totalPairs >= 1);

    const subFile = parseSubFile("SUBSYSTEM 'SRC'\nAREA 1\nEND\nSUBSYSTEM 'SNK'\nAREA 2\nEND\n");
    const fcitc = calculateFcitc(psseCase, { sourceSubsystem: "SRC", sinkSubsystem: "SNK", subFile });
    assert.equal(fcitc.baseCaseConverged, true);
    assert.ok(fcitc.fcitcMw > 0);

    const bd = evaluateBreakerDuty(psseCase, { standard: "ansi-c37", defaultRatingKa: 40 });
    assert.equal(bd.buses.length, 3);
    assert.ok(bd.maxDutyPercent >= 0);

    const cct = searchCriticalClearingTime(psseCase, {
      faultBus: 3,
      minClearingSec: 0.02,
      maxClearingSec: 0.3,
      tEndSec: 0.5,
    });
    assert.ok(cct.numericalCctSec >= 0);
    assert.ok(cct.formalLowerBoundCctSec >= 0);
  });

  it("P8006-P8010 & ProofManifest verify hybrid chattering, IC3 RAS, NLSAT solvability, stochastic barrier, and drift", () => {
    const psseCase = parseRaw(SAMPLE_3BUS_RAW);

    // P8006: inverted switched shunt deadband
    psseCase.switchedShunts.push({
      i: 3,
      modsw: 1,
      adjm: 0,
      stat: 1,
      vswhi: 0.98,
      vswlo: 1.02,
      swrem: 0,
      rmpct: 100,
      rmidnt: "",
      binit: 0,
      blocks: [],
    });
    const chatterDiags = verifyDiscreteControlChattering(psseCase);
    assert.ok(chatterDiags.some((d) => d.code === "P8006"));

    // P8007: IC3 unbounded RAS safety (safe vs unsafe)
    const rasSafe = verifyRasUnboundedSafetyIc3({
      name: "RAS_INTERLOCKED",
      allowSimultaneousTripAndClose: false,
      hasMutualExclusionInterlock: true,
    });
    assert.equal(rasSafe.isProvenSafe, true);
    assert.equal(rasSafe.diagnostics.length, 0);

    const rasUnsafe = verifyRasUnboundedSafetyIc3({
      name: "RAS_RACE",
      allowSimultaneousTripAndClose: true,
      hasMutualExclusionInterlock: false,
    });
    assert.equal(rasUnsafe.isProvenSafe, false);
    assert.ok(rasUnsafe.diagnostics.some((d) => d.code === "P8007"));

    // P8008: NLSAT exact solvability (light load SAT vs overloaded beyond nose UNSAT)
    const satRes = verifyPowerFlowSolvabilityNlsat({ busNumber: 3, rPu: 0.01, xPu: 0.1, pLoadPu: 0.5, qLoadPu: 0.1 });
    assert.equal(satRes.solvable, true);
    const unsatRes = verifyPowerFlowSolvabilityNlsat({ busNumber: 3, rPu: 0.01, xPu: 0.5, pLoadPu: 5.0, qLoadPu: 2.0 });
    assert.equal(unsatRes.solvable, false);
    assert.ok(unsatRes.diagnostics.some((d) => d.code === "P8008"));

    // P8009: Stochastic barrier + ConstrainedZonotope
    const stoch = verifyStochasticRenewableBarrier({
      initialFreqDevHz: 0.02,
      renewableNoiseStdPu: 0.01,
      unsafeFreqDevHz: 0.5,
    });
    assert.ok(stoch.constrainedGovernorHull[0] <= stoch.constrainedGovernorHull[1]);

    // P8010: Polyglot drift
    const driftDiags = verifyPssePolyglotDrift(psseCase, [
      { lang: "pscad", uri: "grid.pscx", component: "branch_1_2_1", param: "r", value: 0.025 },
    ]);
    assert.ok(driftDiags.some((d) => d.code === "P8010"));

    // Proof-carrying manifest (standalone + attached inside auditNercCompliance)
    const pf = solvePowerFlow(psseCase);
    const manifest = generatePsseProofManifest("3-BUS", pf);
    assert.ok(manifest.compositeRootHash.length === 64);
    assert.equal(manifest.items.length, 1);

    const formalLintDiags = lintPsse(psseCase, { tier: "formal" });
    assert.ok(formalLintDiags.some((d) => d.code === "P8006"));

    const nercAudit = auditNercCompliance(psseCase, { includeContingencies: false });
    assert.ok(nercAudit.proofManifest);
    assert.equal(nercAudit.proofManifest.compositeRootHash.length, 64);

    // Auto RAS -> IC3 extractor
    const autoIc3Diags = verifyRasSchemesUnboundedIc3([
      { id: "S1", triggerTag: "V<0.9", actions: [{ kind: "open_branch", target: "1-2" }] },
      { id: "S2", triggerTag: "V<0.9", actions: [{ kind: "close_branch", target: "1-2" }] },
    ]);
    assert.ok(autoIc3Diags.some((d) => d.code === "P8007"));

    // X7004 relational 2-safety droop equivalence
    psseCase.dyr = {
      records: [
        {
          ibus: 2,
          model: "REECA1",
          id: "1",
          con: [],
          namedParams: { KQV: 2.0 },
          rawLine: "",
        },
      ],
    };
    const eqDiags = verifyPssePscadEquivalence(psseCase, { frequencyHz: 60, reactiveDroopGain: 4.5 }, 2);
    assert.ok(eqDiags.some((d) => d.code === "X7004"));

    // ConstrainedZonotope + TaylorModel in analyzeFrequencyNadirReachability
    const nadir = analyzeFrequencyNadirReachability(psseCase, { lossMw: 20 });
    assert.ok(nadir.constrainedGovernorRangePu);
    assert.ok(nadir.taylorSinSwingRange);

    // RequirementBinder anchored in ProofManifest
    const reqManifest = generatePsseProofManifest("3-BUS", pf, nercAudit, "HEAD", [
      { name: "NERC_TPL001_Voltage", stateIndex: 0, operator: ">=", limitValue: 0.95 },
    ]);
    assert.equal(reqManifest.items.length, 3);
  });
});
