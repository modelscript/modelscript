// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeUncertaintyCalibrationEce,
  detectRewardHacking,
  generatePyTorchSlurmRecipeExport,
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

const FAIL_CERT: FormalCertificateSummary = {
  gate1GlrSyntax: false,
  gate2QudvUnits: false,
  gate3SmtFeasibility: false,
  gate4DaeBalance: false,
  diagnostics: ["Gate 1 failed"],
  verifiedAtIso: "2026-11-26T00:00:00.000Z",
};

describe("Formal Model Eval Harness, Anti-Reward-Hacking & Δ_t Calibration Audit", () => {
  it("catches degenerate Modelica stubs, zero-volume CAD boxes, and missing required symbols", () => {
    const emptyMo = detectRewardHacking({
      source: "model Stub end Stub;",
      dialect: "modelica",
    });
    assert.equal(emptyMo.isRewardHacking, true);

    const zeroCad = detectRewardHacking({
      source: "cube([0, 0, 0]);",
      dialect: "scad",
    });
    assert.equal(zeroCad.isRewardHacking, true);

    const missingSyms = detectRewardHacking({
      source: "model RC Real v; equation v = 1; end RC;",
      dialect: "modelica",
      requiredSymbols: ["R", "C", "HeatPort_a", "v"],
    });
    assert.equal(missingSyms.isRewardHacking, true);
    assert.ok(missingSyms.requiredSymbolCoverage < 0.5);

    const validModel = detectRewardHacking({
      source:
        "model ThermalRC parameter Real R = 10; parameter Real C = 2; Real T; equation R * C * der(T) = -T; end ThermalRC;",
      dialect: "modelica",
      requiredSymbols: ["R", "C", "T"],
    });
    assert.equal(validModel.isRewardHacking, false);
    assert.equal(validModel.requiredSymbolCoverage, 1.0);
  });

  it("distinguishes well-calibrated Δ_t spread from inverted/miscalibrated spread via ECE", () => {
    const wellCalibrated = computeUncertaintyCalibrationEce(
      [
        { spreadDeltaT: 0.02, actualError: false },
        { spreadDeltaT: 0.04, actualError: false },
        { spreadDeltaT: 0.03, actualError: false },
        { spreadDeltaT: 1.2, actualError: true },
        { spreadDeltaT: 1.5, actualError: true },
      ],
      0.35,
    );
    assert.ok(wellCalibrated.ece < 0.12, `Expected low ECE, got ${wellCalibrated.ece}`);
    assert.ok(wellCalibrated.separationGap > 1.0);

    const miscalibrated = computeUncertaintyCalibrationEce(
      [
        { spreadDeltaT: 1.5, actualError: false },
        { spreadDeltaT: 1.4, actualError: false },
        { spreadDeltaT: 0.01, actualError: true },
        { spreadDeltaT: 0.02, actualError: true },
      ],
      0.35,
    );
    assert.ok(miscalibrated.ece > 0.8, `Expected high ECE on inverted calibration, got ${miscalibrated.ece}`);
    assert.ok(miscalibrated.separationGap < -1.0);
  });

  it("promotes high-quality non-trivial suites and blocks reward-hacking suites in CI", () => {
    const goodReport = runFormalModelEvalSuite([
      {
        caseId: "c1",
        dialect: "modelica",
        generatedSource: "model RC parameter Real R = 100; Real v; equation v = R * 0.5; end RC;",
        formalCert: PASS_CERT,
        requiredSymbols: ["R", "v"],
        outputSpreadDeltaT: 0.02,
        behavioralError: 0.005,
        diskAnnRecallHit: true,
      },
      {
        caseId: "c2",
        dialect: "scad",
        generatedSource:
          "wall_thickness = 3.0; hole_radius = 2.0; difference() { cube([30, 20, wall_thickness]); cylinder(r = hole_radius, h = 5); }",
        formalCert: PASS_CERT,
        requiredSymbols: ["wall_thickness", "hole_radius"],
        outputSpreadDeltaT: 0.03,
        behavioralError: 0.0,
        diskAnnRecallHit: true,
      },
    ]);
    assert.equal(goodReport.promoted, true);
    assert.equal(goodReport.rewardHackingRate, 0);
    assert.equal(goodReport.nonTrivialPassRate, 1);

    const hackedReport = runFormalModelEvalSuite([
      {
        caseId: "hack1",
        dialect: "scad",
        generatedSource: "cube([0, 0, 0]);",
        formalCert: PASS_CERT, // Passed trivial syntax check, but caught by anti-reward-hacking guard!
        outputSpreadDeltaT: 0.01,
      },
      {
        caseId: "fail1",
        dialect: "modelica",
        generatedSource: "model Broken end Wrong;",
        formalCert: FAIL_CERT,
        outputSpreadDeltaT: 0.02, // Also miscalibrated!
      },
    ]);
    assert.equal(hackedReport.promoted, false);
    assert.ok(hackedReport.rewardHackingRate > 0);
    assert.ok(hackedReport.failureReasons.length >= 2);
  });

  it("exports reproducible PyTorch/Triton + Slurm HPC bundle pinned to DiskANN and shard IDs", () => {
    const bundle = generatePyTorchSlurmRecipeExport({
      recipeName: "@ms/small-llm-cad-v1",
      recipeVersion: "1.2.0",
      shardIds: ["aabbccdd11223344", "556677889900aabb"],
      gpus: 8,
      partition: "a100",
    });

    const manifest = JSON.parse(bundle.manifestJson);
    assert.equal(manifest.memoryConfig.backend, "diskann");
    assert.equal(manifest.targetModel.parameterScale, "1.5B");
    assert.deepEqual(manifest.shards, ["aabbccdd11223344", "556677889900aabb"]);
    assert.match(bundle.slurmScript, /#SBATCH --gres=gpu:8/);
    assert.match(bundle.slurmScript, /--m-cap 32/);
    assert.match(bundle.slurmScript, /--diskann-url/);
  });
});
