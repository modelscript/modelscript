// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeUdmLoopSegments,
  analyzeUdmNumericalSafety,
  extractEmtNetlist,
  formatHarmonicsStudyCsv,
  formatInsulationStudyHtml,
  generatePscadProofManifest,
  parsePscx,
  runHarmonicsStudy,
  runInsulationStudy,
  runSsciScreening,
  verifyControlBlocksLockoutIc3,
  verifyControlLoopRelationalRobustness,
  verifyPllAdversarialReachabilityHji,
  verifyProtectionLockoutIc3,
  verifyPscadPolyglotDrift,
  verifySwitchingHybridConsistency,
  type EmtControlBlock,
  type Ieee2800ComplianceReport,
} from "../src/index.js";

const SAMPLE_PSCX = `<?xml version="1.0" encoding="UTF-8"?>
<project name="StudyTest" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <param name="f_base" value="60.0"/>
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="SRC" id="B1" x="100" y="100" length="20" vbase="230.0"/>
    <Bus name="POI" id="B2" x="300" y="100" length="20" vbase="230.0"/>
    <User classid="UserCmp" defn="master:source_3" id="S1" x="60" y="100">
      <paramlist><param name="Vm" value="230.0"/><param name="F" value="60.0"/><param name="R1s" value="0.5"/><param name="L1s" value="0.01"/></paramlist>
    </User>
    <User classid="UserCmp" defn="master:resistor" id="R1" x="200" y="100">
      <paramlist><param name="R" value="2.5"/></paramlist>
    </User>
  </schematic></definition></definitions>
</project>`;

describe("PSCAD Tier 1/2 Studies & Phase 3 Formal Verification", () => {
  it("runs Insulation/TRV, IEEE 519 Harmonics, and SSR/SSCI studies", () => {
    const project = parsePscx(SAMPLE_PSCX);
    const netlist = extractEmtNetlist(project);

    const ins = runInsulationStudy(netlist, { numRuns: 5, durationSec: 0.01, timeStepSec: 50e-6 });
    assert.equal(ins.ssov.totalRuns, 5);
    assert.ok(formatInsulationStudyHtml(ins).includes("Insulation Coordination"));

    const harm = runHarmonicsStudy(netlist, {
      durationSec: 0.04,
      timeStepSec: 50e-6,
      fMinHz: 20,
      fMaxHz: 300,
      fStepHz: 20,
    });
    assert.ok(harm.orders.length > 0);
    assert.ok(formatHarmonicsStudyCsv(harm).includes("order,frequency_hz"));

    const ssci = runSsciScreening(netlist, { fMinHz: 5, fMaxHz: 55, fStepHz: 5 });
    assert.ok(ssci.scan.frequenciesHz.length > 0);
    assert.ok(ssci.summary.includes("SSR/SSCI Screening"));
  });

  it("M6084-M6088, UDM ArraySegmentState, and ProofManifest verify EMT models", () => {
    const project = parsePscx(SAMPLE_PSCX);
    const netlist = extractEmtNetlist(project);

    // M6084: Hybrid Zeno chattering on inverted comparator hysteresis
    const blocks: EmtControlBlock[] = [
      { id: "CMP1", kind: "compar", inputs: ["IN1"], params: { lo: 1.05, hi: 0.95 } },
      { id: "G1", kind: "gain", inputs: ["IN1"], params: { G: 120.0 } },
    ];
    const hybridDiags = verifySwitchingHybridConsistency(netlist, blocks);
    assert.ok(hybridDiags.some((d) => d.code === "M6084"));

    // M6085: IC3 unbounded lockout safety
    const safeLockout = verifyProtectionLockoutIc3({ breakerId: "BRK1", enforceLockoutInterlock: true });
    assert.equal(safeLockout.isProvenSafe, true);
    const unsafeLockout = verifyProtectionLockoutIc3({ breakerId: "BRK2", enforceLockoutInterlock: false });
    assert.equal(unsafeLockout.isProvenSafe, false);
    assert.ok(unsafeLockout.diagnostics.some((d) => d.code === "M6085"));

    // M6086: HJI adversarial PLL reachability + ConstrainedZonotope
    const hji = verifyPllAdversarialReachabilityHji({ componentId: "PLL1", maxPhaseJumpRad: 0.2, tEndSec: 0.01 });
    assert.ok(hji.constrainedCurrentHull[0] <= hji.constrainedCurrentHull[1]);

    // M6087: Relational 2-safety Lipschitz robustness
    const relDiags = verifyControlLoopRelationalRobustness(blocks, 50.0);
    assert.ok(relDiags.some((d) => d.code === "M6087"));

    // M6088: Polyglot drift
    netlist.branches.push({
      id: "LINE_1",
      kind: "transmission_line",
      fromBus: "B1",
      toBus: "B2",
      resistanceOhm: 1.0,
      inductanceH: 0.01,
      capacitanceF: 0,
    });
    const driftDiags = verifyPscadPolyglotDrift(netlist, [
      { lang: "psse", uri: "grid.raw", component: "LINE_1", param: "r", value: 1.5 },
    ]);
    assert.ok(driftDiags.some((d) => d.code === "M6088"));

    // Fortran UDM ArraySegmentState loop OOB check
    const fortranCode = `
      DO I = 0, 5
        STORF(NSTORF + I) = 0.0
      END DO
      NSTORF = NSTORF + 4
    `;
    const loopViols = analyzeUdmLoopSegments(fortranCode, 4, 0);
    assert.equal(loopViols.length, 1);
    assert.equal(loopViols[0]?.loopHi, 5);

    // Proof-carrying IEEE 2800 manifest
    const mockIeee: Ieee2800ComplianceReport = {
      projectName: "StudyTest",
      overallStatus: "PASS",
      evaluatedAt: new Date().toISOString(),
      checks: [
        {
          clause: "5.3.2",
          title: "LVRT",
          status: "PASS",
          measuredValue: "1.0 pu",
          requiredLimit: ">= 0.9 pu",
          details: "Passed",
        },
      ],
      summary: "PASS",
    };
    const manifest = generatePscadProofManifest("StudyTest", mockIeee);
    assert.equal(manifest.isCertifiedCompliant, true);
    assert.equal(manifest.compositeRootHash.length, 64);

    // Auto CSMF -> IC3 lockout extractor (M6085)
    const autoLockoutDiags = verifyControlBlocksLockoutIc3([
      {
        id: "TRIP_DRV",
        kind: "gain",
        inputs: ["SIG_A"],
        params: { G: 1 },
        actuator: { type: "breaker_status", targetId: "BRK_MAIN" },
      },
      {
        id: "RECLOSE_DRV",
        kind: "gain",
        inputs: ["SIG_B"],
        params: { G: 1 },
        actuator: { type: "breaker_status", targetId: "BRK_MAIN" },
      },
    ]);
    assert.ok(autoLockoutDiags.some((d) => d.code === "M6085"));

    // ReducedProductState Fortran UDM numerical safety (div-by-zero + negative SQRT)
    const numHazards = analyzeUdmNumericalSafety(`
      DEN = 0.0
      NEG = -4.0
      Y = X / DEN
      Z = SQRT(NEG)
    `);
    assert.ok(numHazards.some((h) => h.kind === "division_by_zero" && h.variable === "DEN"));
    assert.ok(numHazards.some((h) => h.kind === "negative_sqrt" && h.variable === "NEG"));
  });
});
