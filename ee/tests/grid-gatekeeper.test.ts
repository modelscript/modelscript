// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGatekeeperRouter,
  runGatekeeperScreeningPipeline,
  type GatekeeperSubmissionPackage,
} from "../src/index.js";

describe("Grid Code Gatekeeper CI/CD for ISOs & Transmission Planners (@modelscript/ee)", () => {
  it("approves fully compliant generator interconnection submission package", () => {
    const pkg: GatekeeperSubmissionPackage = {
      submissionId: "SUB-ERCOT-2026-0042",
      developerOrganization: "Apex Clean Energy LLC",
      plantName: "SOLAR_HORIZON_200MW",
      gridInterconnection: "ERCOT",
      ratedMva: 200.0,
      poiKv: 345.0,
      hasRawPowerFlow: true,
      hasDyrDynamics: true,
      hasPscadModel: true,
      hasWasmFirmware: true,
      staticDiagnosticCount: { errors: 0, warnings: 0 },
      flatStartMaxDriftPercent: 0.02,
      lowestStableScr: 1.2,
      lvrtPass: true,
      hvrtPass: true,
      emtRmsNrmse: 0.035,
    };

    const scorecard = runGatekeeperScreeningPipeline(pkg);

    assert.equal(scorecard.overallVerdict, "APPROVED");
    assert.equal(scorecard.compositeScorePercent, 100);
    assert.equal(scorecard.stages.length, 5);
    assert.equal(scorecard.rejectionReasons.length, 0);

    for (const st of scorecard.stages) {
      assert.equal(st.verdict, "PASS", `Stage ${st.stageNumber} should pass`);
    }

    assert.ok(scorecard.summaryMarkdown.includes("Automated Interconnection Screening Scorecard"));
    assert.ok(scorecard.summaryMarkdown.includes("APPROVED"));
  });

  it("rejects non-compliant package and outputs actionable remediation diagnostics", () => {
    const deficientPkg: GatekeeperSubmissionPackage = {
      submissionId: "SUB-PJM-2026-0811",
      developerOrganization: "Speculative Power Corp",
      plantName: "WIND_RIDGELINE_150MW",
      gridInterconnection: "PJM",
      ratedMva: 150.0,
      poiKv: 230.0,
      hasRawPowerFlow: true,
      hasDyrDynamics: false, // Deficient
      hasPscadModel: true,
      hasWasmFirmware: false,
      staticDiagnosticCount: { errors: 2, warnings: 1 },
      flatStartMaxDriftPercent: 3.5, // Drifting
      lowestStableScr: 3.0, // Control instability
      lvrtPass: false, // Momentary cessation
      hvrtPass: true,
      emtRmsNrmse: 0.16, // High divergence
    };

    const scorecard = runGatekeeperScreeningPipeline(deficientPkg);

    assert.equal(scorecard.overallVerdict, "REJECTED");
    assert.ok(scorecard.compositeScorePercent < 50);
    assert.ok(scorecard.rejectionReasons.length >= 4);

    const s1 = scorecard.stages.find((s) => s.stageNumber === 1);
    assert.equal(s1?.verdict, "FAIL");
    assert.ok(s1?.criticalIssues.some((iss) => iss.includes("Missing PSS/E .dyr")));

    const s2 = scorecard.stages.find((s) => s.stageNumber === 2);
    assert.equal(s2?.verdict, "FAIL");
    assert.ok(s2?.criticalIssues.some((iss) => iss.includes("drift")));

    const s3 = scorecard.stages.find((s) => s.stageNumber === 3);
    assert.equal(s3?.verdict, "FAIL");
    assert.ok(s3?.criticalIssues.some((iss) => iss.includes("weak grid")));

    const s4 = scorecard.stages.find((s) => s.stageNumber === 4);
    assert.equal(s4?.verdict, "FAIL");
    assert.ok(s4?.criticalIssues.some((iss) => iss.includes("momentary cessation")));

    const s5 = scorecard.stages.find((s) => s.stageNumber === 5);
    assert.equal(s5?.verdict, "FAIL");
    assert.ok(s5?.criticalIssues.some((iss) => iss.includes("NRMSE")));

    assert.ok(scorecard.summaryMarkdown.includes("Primary Grounds for Model Rejection"));
    assert.ok(scorecard.summaryMarkdown.includes("Action Required:"));
  });

  it("mounts Grid Code Gatekeeper Express router", () => {
    const router = createGatekeeperRouter();
    assert.ok(router);
    assert.equal(typeof router, "function");
  });
});
