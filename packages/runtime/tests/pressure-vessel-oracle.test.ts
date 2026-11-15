// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  CaeContractOracle,
  globalLibraryRegistry,
  PressureVesselOracle,
  SemanticTheoryCoordinator,
} from "../src/index.js";

const PACK_NAME = "@test/oracle-asme-bpvc";

function registerTestTable(): void {
  globalLibraryRegistry.registerLibraryBundle(
    {
      name: PACK_NAME,
      version: "0.1.0",
      modelscript: {
        tier: "stable",
        category: "standard-pack",
        languages: ["sysml2", "modelica"],
        standard: {
          code: "ASME-BPVC-VIII-1",
          edition: "2023",
          calculators: [{ calcName: "AllowableStress", tableKey: "SA516_70_S" }],
        },
        runtime: { tables: { SA516_70_S: "tables/sa516.json" } },
      },
    },
    {
      tables: {
        SA516_70_S: {
          kind: "keyed-piecewise-linear",
          series: {
            "SA-516-70": {
              x: [100, 500, 700, 800],
              y: [137.9, 137.9, 118.0, 82.0],
            },
          },
        },
      },
    },
  );
}

describe("PressureVesselOracle — ASME BPVC VIII-1 & VIII-2 Formal Verification", () => {
  after(() => {
    globalLibraryRegistry.unregisterPackage(PACK_NAME);
  });

  it("verifies UG-27 shell, UG-32 heads, UG-99 hydrotest, UG-125 PRV, and VIII-2 stress linearization", () => {
    registerTestTable();
    const oracle = new PressureVesselOracle();

    // 1. UG-27 cylinder with SA-516-70 resolved dynamically @ 700F (S = 118.0 MPa), CA = 1.5 mm
    // P=2.0 MPa, R=600 -> R_eff=601.5, E=0.85 => t_req = (2*601.5)/(118*0.85 - 1.2) = 1203 / 99.1 = 12.1393 mm
    // Nominal t=15.0 -> t_eff=13.5 >= 12.1393 (SAT)
    oracle.assertUg27Cylinder({
      checkId: "Shell_Pass",
      vesselName: "V101",
      P: 2.0,
      R: 600,
      t: 15.0,
      E: 0.85,
      CA: 1.5,
      materialSpec: "SA-516-70",
      designTempF: 700,
    });

    // 2. UG-32(d) 2:1 ellipsoidal head (D=1200, S=118.0, E=0.85, t=14.0 -> t_req = 2*1200/(2*118*0.85 - 0.4) = 2400/200.2 = 11.988)
    oracle.assertUg32Head({
      checkId: "Head_Ellip",
      vesselName: "V101",
      headType: "ellipsoidal",
      P: 2.0,
      D: 1200,
      t: 14.0,
      E: 0.85,
      materialSpec: "SA-516-70",
      designTempF: 700,
    });

    // 3. UG-99 hydrotest: MAWP=2.0, S_test@100F=137.9, S_design@700F=118.0 => pReq = 1.3 * 2.0 * (137.9/118.0) = 3.0385 MPa
    oracle.assertUg99Hydrostatic({
      checkId: "Hydro_Pass",
      vesselName: "V101",
      mawp: 2.0,
      testPressure: 3.1,
      materialSpec: "SA-516-70",
      designTempF: 700,
      testTempF: 100,
    });

    // 4. UG-125 relief device: set <= MAWP, relieving <= 1.10 * MAWP
    oracle.assertUg125Relief({
      checkId: "PRV_Pass",
      vesselName: "V101",
      mawp: 2.0,
      setPressure: 2.0,
      relievingPressure: 2.15,
      contingency: "single",
    });

    // 5. VIII-2 stress linearization
    oracle.assertViii2StressLinearization({
      checkId: "Nozzle_VIII2",
      vesselName: "V101",
      Pm: 110,
      PL: 130,
      Pb: 35, // PL+Pb = 165 <= 1.5*118 = 177
      Q: 120, // total = 285 <= 3*118 = 354
      materialSpec: "SA-516-70",
      designTempF: 700,
    });

    const sat1 = oracle.checkSat();
    assert.strictEqual(sat1.isSat, true, sat1.conflict?.explanation);
    const model = oracle.getModel();
    assert.strictEqual(model["Shell_Pass"]?.isSatisfied, true);
    assert.ok(Math.abs((model["Shell_Pass"]?.requiredLimit ?? 0) - 12.1393) < 0.01);
    assert.strictEqual(model["Head_Ellip"]?.clauseId, "UG-32(d)");
    assert.ok(Math.abs((model["Hydro_Pass"]?.requiredLimit ?? 0) - 3.0385) < 0.01);

    // Push level & inject violating UG-27 and UG-125 checks, verify UNSAT & popLevel rollback
    oracle.pushLevel();
    oracle.assertUg27Cylinder({
      checkId: "Shell_Thin",
      vesselName: "V102",
      P: 2.0,
      R: 600,
      t: 11.0,
      E: 0.85,
      S: 118.0,
    });
    const badRes = oracle.checkSat();
    assert.strictEqual(badRes.isSat, false);
    assert.ok(badRes.conflict?.explanation.includes("UG-27"));
    oracle.popLevel();

    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("cooperates with CaeContractOracle in SemanticTheoryCoordinator to catch FEA stress over-limit", () => {
    const coord = new SemanticTheoryCoordinator();
    const cae = new CaeContractOracle();
    const vessel = new PressureVesselOracle();
    coord.registerOracle(cae);
    coord.registerOracle(vessel);

    // Vessel passes local VIII-2 check at nominal Pm=100, S=137.9
    vessel.assertViii2StressLinearization({
      checkId: "V201_VIII2",
      vesselName: "V201",
      Pm: 100,
      S: 137.9,
    });

    // Cooperating FEA oracle reports von_mises_stress = 240 MPa (> 1.5 * 137.9 = 206.85 MPa)
    // CAE's own threshold is looser (260 MPa), so CAE alone passes — only Nelson-Oppen equality sharing catches the ASME VIII-2 violation!
    cae.assertContract({
      contractId: "FEA_V201",
      metricName: "von_mises_stress",
      actualValue: 240,
      threshold: 260,
      operator: "<=",
      unit: "MPa",
      partName: "V201",
    });

    const sat = coord.checkSat();
    assert.strictEqual(sat.isSat, false, "Expected Nelson-Oppen cross-theory UNSAT");
    assert.strictEqual(sat.conflict?.theoryName, "PressureVesselOracle");
    assert.ok(sat.conflict?.explanation.includes("von_mises_stress"));
  });

  it("emits standard compliance rules, clauses, margins, and methods across SARIF, CTRF, HTML, and DHF reports", async () => {
    const { UnifiedVerifier } = await import("../src/simulation/unified_verifier.js");
    const sampleReport = {
      timestamp: "2026-11-15T00:00:00.000Z",
      target: "VesselSeparator.mo",
      summary: {
        totalStages: 1,
        passedStages: 0,
        failedStages: 1,
        certifiedStages: 0,
        skippedStages: 0,
        totalViolations: 1,
        durationMs: 12.5,
        overallPassed: false,
      },
      stages: {
        flowpipes: {
          stage: "flowpipes",
          name: "DAE Interval Reachability",
          passed: false,
          durationMs: 12.5,
          summary: "1 ASME BPVC VIII-1 violation",
          violations: [
            {
              stage: "flowpipes",
              severity: "error" as const,
              message: "Shell thickness 12.0 mm violates UG-27(c)(1) minimum 17.28 mm.",
              standard: "ASME BPVC VIII-1",
              clauseId: "UG-27(c)(1)",
              margin: -5.28,
              verificationMethod: "formal-interval",
            },
          ],
        },
      },
    };

    const sarif = JSON.parse(UnifiedVerifier.formatSarif(sampleReport as any));
    assert.strictEqual(sarif.runs[0].results[0].ruleId, "ASME-BPVC-VIII-1:UG-27(c)(1)");
    assert.strictEqual(sarif.runs[0].results[0].properties.standard, "ASME BPVC VIII-1");
    assert.strictEqual(sarif.runs[0].results[0].properties.clauseId, "UG-27(c)(1)");
    assert.strictEqual(sarif.runs[0].results[0].properties.margin, -5.28);
    assert.strictEqual(sarif.runs[0].results[0].properties.verificationMethod, "formal-interval");

    const ctrf = UnifiedVerifier.formatCtrf(sampleReport as any);
    assert.strictEqual(ctrf.report.results.tests[0]?.extra?.["standardClause"], "ASME BPVC VIII-1 UG-27(c)(1)");
    assert.strictEqual(ctrf.report.results.tests[0]?.extra?.["margin"], -5.28);
    assert.strictEqual(ctrf.report.results.tests[0]?.extra?.["verificationMethod"], "formal-interval");

    const html = UnifiedVerifier.formatHtml(sampleReport as any);
    assert.ok(html.includes("ASME BPVC VIII-1 UG-27(c)(1)"));
    assert.ok(html.includes("-5.2800"));
    assert.ok(html.includes("[formal-interval]"));

    const dhf = UnifiedVerifier.formatDhf(sampleReport as any);
    assert.ok(dhf.includes("ASME BPVC VIII-1 UG-27(c)(1)"));
    assert.ok(dhf.includes("Margin: -5.2800"));
  });
});
