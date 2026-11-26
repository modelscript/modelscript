// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeRecipePreFlight,
  applyDatasetOverlayPatches,
  auditTrainEvalContamination,
  compileRelationalHypergraph,
  diagnoseExampleXRay,
  diffDatasetVersions,
  diffEvalReports,
  runFormalModelEvalSuite,
  type FormalCertificateSummary,
} from "../src/index.js";

const PASS_CERT: FormalCertificateSummary = {
  gate1GlrSyntax: true,
  gate2QudvUnits: true,
  gate3SmtFeasibility: true,
  gate4DaeBalance: true,
  cadClearance: true,
  diagnostics: [],
  verifiedAtIso: "2026-11-26T00:00:00.000Z",
};

describe("Recipe Pre-Flight Analyzer, Semantic Diff, Decontamination & Single-Example X-Ray", () => {
  const v1Examples = [
    {
      uri: "tiny1.mo",
      dialect: "modelica",
      source: "model T1 parameter Real R = 10; Real v; equation v = R * 2; end T1;",
    },
    {
      uri: "cad1.scad",
      dialect: "scad",
      source:
        "wall_thickness = 3.0; hole_radius = 2.0; difference() { cube([20, 20, wall_thickness]); cylinder(r = hole_radius, h = 5); }",
    },
    { uri: "stub.scad", dialect: "scad", source: "cube([0, 0, 0]);" },
  ];

  it("computes Data Nutrition Label, Dynamic-m VRAM savings, reward-hacking rate & DiskANN symbol gaps", () => {
    const report = analyzeRecipePreFlight(v1Examples, {
      batchSize: 2,
      mCap: 32,
      indexedDiskAnnSymbols: ["R", "wall_thickness"],
    });

    assert.equal(report.totalExamples, 3);
    assert.equal(report.rewardHackingCount, 1);
    assert.ok(report.bucketingEfficiency.estimatedVramSavingsPct > 70);
    assert.ok(report.diskAnnCoverage.missingSymbols.includes("hole_radius"));
    assert.ok(report.diskAnnCoverage.coverageRatio < 1.0);
  });

  it("computes semantic dataset version diff with estimated GPU memory multiplier", () => {
    const v2Examples = [
      v1Examples[0]!,
      {
        uri: "cad1.scad",
        dialect: "scad",
        source:
          "wall_thickness = 4.0; hole_radius = 2.0; pitch = 15.0; difference() { cube([pitch, pitch, wall_thickness]); cylinder(r = hole_radius, h = 5); }",
      },
      {
        uri: "complex.mo",
        dialect: "modelica",
        source:
          "model Big Real a; Real b; Real c; Real d; Real e; Real f; equation a=b; b=c; c=d; d=e; e=f; f=1; end Big;",
      },
    ];

    const diff = diffDatasetVersions(v1Examples, v2Examples);
    assert.deepEqual(diff.addedUris, ["complex.mo"]);
    assert.deepEqual(diff.removedUris, ["stub.scad"]);
    assert.deepEqual(diff.modifiedUris, ["cad1.scad"]);
    assert.ok(diff.estimatedMemoryMultiplier > 1.0);
    assert.equal(diff.rewardHackingDelta, -1);
  });

  it("detects exact and near-duplicate train/eval contamination and applies immutable overlay patches", () => {
    const evalSet = [
      {
        uri: "eval_rc.mo",
        dialect: "modelica",
        source: "model T1 parameter Real R = 10; Real v; equation v = R * 2; end T1;",
      },
      {
        uri: "eval_cad.scad",
        dialect: "scad",
        source:
          "wall_thickness = 3.0; hole_radius = 2.0; difference() { cube([20, 20, wall_thickness]); cylinder(r = hole_radius, h = 5); }",
      },
    ];

    const decontam = auditTrainEvalContamination(v1Examples, evalSet, 0.7);
    assert.equal(decontam.contaminatedCount, 2);
    assert.equal(decontam.matches[0]!.matchKind, "exact-hash");

    const compiled = v1Examples.map((e) => compileRelationalHypergraph(e));
    const patched = applyDatasetOverlayPatches(compiled, [
      { exampleId: compiled[0]!.exampleId, action: "quarantine", reason: "Eval contamination leak" },
      {
        exampleId: compiled[1]!.exampleId,
        action: "hypergraph_override",
        reason: "Lock wall_thickness invariant",
        hypergraphOverrides: [{ symbolName: "wall_thickness", groupId: 0 }],
      },
    ]);

    assert.equal(patched.quarantinedIds.length, 1);
    assert.equal(patched.patchedIds.length, 1);
    assert.equal(patched.activeRecords.length, 2);
  });

  it("runs single-example X-Ray producing token heatmaps, generator waterfall & worst-case ξ* corner", async () => {
    const xray = await diagnoseExampleXRay(
      "wall_thickness = 3.0; hole_radius = 2.0; difference() { cube([20, 20, wall_thickness]); cylinder(r = hole_radius, h = 5); }",
      "scad",
      { uri: "memory://bracket.scad", computeDialM: 8 },
    );

    assert.ok(xray.mInit >= 2);
    assert.ok(xray.tokenHeat.length > 10);
    assert.equal(xray.layerWaterfall.length, 3);
    assert.ok(xray.worstCaseCorner.length > 0);
    assert.ok(xray.worstCaseCorner.every((c) => c.xiSign === 1 || c.xiSign === -1));
    assert.equal(xray.rewardHackingAudit.isRewardHacking, false);
  });

  it("computes side-by-side eval report regression diff accurately", () => {
    const before = runFormalModelEvalSuite([
      {
        caseId: "c1",
        dialect: "scad",
        generatedSource: "cube([0, 0, 0]);",
        formalCert: PASS_CERT,
        outputSpreadDeltaT: 0.02,
      },
    ]);
    const after = runFormalModelEvalSuite([
      {
        caseId: "c1",
        dialect: "scad",
        generatedSource: "wall_thickness = 3.0; hole_radius = 2.0; cube([20, 20, wall_thickness]);",
        formalCert: PASS_CERT,
        outputSpreadDeltaT: 0.02,
      },
    ]);
    const diff = diffEvalReports(before, after);
    assert.equal(diff.promotionChange, "promoted");
    assert.deepEqual(diff.flippedFailToPass, ["c1"]);
    assert.deepEqual(diff.flippedPassToFail, []);
  });
});
