// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyWorstCaseCornerToSource,
  computeClientEvalRegressionDiff,
  parseClientEvalReportJson,
  SAMPLE_EVAL_REPORT_AFTER,
  SAMPLE_EVAL_REPORT_BEFORE,
  type ClientFormalModelEvalReport,
} from "../src/workbench/util/worst-case-replay.js";

describe("applyWorstCaseCornerToSource (Live ξ* Corner Replay)", () => {
  it("perturbs Modelica parameter declarations without touching comments, strings, or comparisons", () => {
    const src = [
      "model RCFilter",
      "  // R = 999.0; should stay untouched",
      "  /* C = 1.0; block comment untouched */",
      '  parameter Real R = 100.0 "Nominal R = 50.0";',
      '  parameter Real C(min=0, unit="F") = 1e-6 "Capacitance";',
      "  parameter Integer N = 10;",
      "equation",
      '  assert(R == 100.0 or R > 0, "valid");',
      "end RCFilter;",
    ].join("\n");

    const res = applyWorstCaseCornerToSource(
      src,
      [
        { symbolName: "R", xiSign: 1 },
        { symbolName: "C", xiSign: -1 },
        { symbolName: "N", xiSign: 1 },
      ],
      0.05,
    );

    assert.equal(res.appliedMutations.length, 3);
    assert.deepEqual(res.appliedMutations[0], { symbolName: "R", before: 100, after: 105, xiSign: 1 });
    assert.deepEqual(res.appliedMutations[1], { symbolName: "C", before: 1e-6, after: 9.5e-7, xiSign: -1 });
    assert.deepEqual(res.appliedMutations[2], { symbolName: "N", before: 10, after: 11, xiSign: 1 });

    // Verify exact clean substitutions and preserved comments/strings/comparisons
    assert.ok(res.perturbedSource.includes("// R = 999.0; should stay untouched"));
    assert.ok(res.perturbedSource.includes("/* C = 1.0; block comment untouched */"));
    assert.ok(res.perturbedSource.includes('parameter Real R = 105.0 "Nominal R = 50.0";'));
    assert.ok(res.perturbedSource.includes('parameter Real C(min=0, unit="F") = 9.5e-7 "Capacitance";'));
    assert.ok(res.perturbedSource.includes("parameter Integer N = 11;"));
    assert.ok(res.perturbedSource.includes('assert(R == 100.0 or R > 0, "valid");'));
  });

  it("perturbs OpenSCAD assignments accurately (wall_thickness: 3.0 -> 3.15)", () => {
    const src = [
      "// Parametric enclosure",
      "wall_thickness = 3.0;",
      "outer_radius = 20.0; // mm",
      "total = wall_thickness + 1.0;",
      "difference() { cylinder(h=10, r=outer_radius); }",
    ].join("\n");

    const res = applyWorstCaseCornerToSource(
      src,
      [
        { symbolName: "wall_thickness", xiSign: 1 },
        { symbolName: "outer_radius", xiSign: -1 },
      ],
      0.05,
    );

    assert.deepEqual(res.appliedMutations, [
      { symbolName: "wall_thickness", before: 3, after: 3.15, xiSign: 1 },
      { symbolName: "outer_radius", before: 20, after: 19, xiSign: -1 },
    ]);
    assert.ok(res.perturbedSource.includes("wall_thickness = 3.15;"));
    assert.ok(res.perturbedSource.includes("outer_radius = 19.0; // mm"));
    assert.ok(res.perturbedSource.includes("total = wall_thickness + 1.0;"));
  });

  it("perturbs SysML2 attribute assignments including typed attributes and := bindings", () => {
    const src = [
      "part def PropulsionStage {",
      "  attribute mass = 12.5;",
      "  attribute thrust : Real = 400.0 [N];",
      "  attribute isp : Real default := 310.0;",
      "}",
    ].join("\n");

    const res = applyWorstCaseCornerToSource(
      src,
      [
        { symbolName: "mass", xiSign: -1 },
        { symbolName: "thrust", xiSign: 1 },
        { symbolName: "isp", xiSign: -1 },
      ],
      0.05,
    );

    assert.deepEqual(res.appliedMutations, [
      { symbolName: "mass", before: 12.5, after: 11.875, xiSign: -1 },
      { symbolName: "thrust", before: 400, after: 420, xiSign: 1 },
      { symbolName: "isp", before: 310, after: 294.5, xiSign: -1 },
    ]);
    assert.ok(res.perturbedSource.includes("attribute mass = 11.875;"));
    assert.ok(res.perturbedSource.includes("attribute thrust : Real = 420.0 [N];"));
    assert.ok(res.perturbedSource.includes("attribute isp : Real default := 294.5;"));
  });

  it("does not corrupt compound RHS expressions or substring-colliding symbols", () => {
    const src = ["R1 = 50.0;", "R = 1.0 + R1;", "offset = -10.0;", "zero_bias = 0.0;"].join("\n");

    const res = applyWorstCaseCornerToSource(
      src,
      [
        { symbolName: "R", xiSign: 1 },
        { symbolName: "offset", xiSign: 1 },
        { symbolName: "zero_bias", xiSign: -1 },
      ],
      0.1,
    );

    // R = 1.0 + R1 is a compound expression, so R is skipped and R1 is never confused with R
    assert.ok(res.perturbedSource.includes("R1 = 50.0;"));
    assert.ok(res.perturbedSource.includes("R = 1.0 + R1;"));
    assert.deepEqual(res.appliedMutations, [
      { symbolName: "offset", before: -10, after: -9, xiSign: 1 },
      { symbolName: "zero_bias", before: 0, after: -0.1, xiSign: -1 },
    ]);
    assert.ok(res.perturbedSource.includes("offset = -9.0;"));
    assert.ok(res.perturbedSource.includes("zero_bias = -0.1;"));
  });

  it("supports qualified symbol fallback when leaf identifier is declared locally", () => {
    const src = "parameter Real R = 100.0;";
    const res = applyWorstCaseCornerToSource(src, [{ symbolName: "resistor.R", xiSign: -1 }], 0.05);
    assert.deepEqual(res.appliedMutations, [{ symbolName: "R", before: 100, after: 95, xiSign: -1 }]);
    assert.equal(res.perturbedSource, "parameter Real R = 95.0;");
  });
});

describe("computeClientEvalRegressionDiff (Checkpoint Eval Diff)", () => {
  it("computes promotionChange, metric deltas, and PASS->FAIL / FAIL->PASS flips accurately", () => {
    const diff = computeClientEvalRegressionDiff(SAMPLE_EVAL_REPORT_BEFORE, SAMPLE_EVAL_REPORT_AFTER);

    assert.equal(diff.promotionChange, "promoted");
    assert.equal(diff.formalPassRateDelta, 0.2);
    assert.equal(diff.nonTrivialPassRateDelta, 0.2);
    assert.equal(diff.rewardHackingRateDelta, -0.2);
    assert.equal(diff.eceDelta, -0.17);
    assert.deepEqual(diff.flippedPassToFail, ["modelica/thermal_pid_loop"]);
    assert.deepEqual(diff.flippedFailToPass, ["scad/enclosure_wall_clearance", "sysml2/propulsion_mass_budget"]);
  });

  it("classifies regressed, unchanged-pass, and unchanged-fail promotion states", () => {
    const regressed = computeClientEvalRegressionDiff(SAMPLE_EVAL_REPORT_AFTER, SAMPLE_EVAL_REPORT_BEFORE);
    assert.equal(regressed.promotionChange, "regressed");
    assert.equal(regressed.formalPassRateDelta, -0.2);
    assert.equal(regressed.eceDelta, 0.17);

    const samePass = computeClientEvalRegressionDiff(SAMPLE_EVAL_REPORT_AFTER, SAMPLE_EVAL_REPORT_AFTER);
    assert.equal(samePass.promotionChange, "unchanged-pass");
    assert.deepEqual(samePass.flippedPassToFail, []);
    assert.deepEqual(samePass.flippedFailToPass, []);

    const sameFail = computeClientEvalRegressionDiff(SAMPLE_EVAL_REPORT_BEFORE, SAMPLE_EVAL_REPORT_BEFORE);
    assert.equal(sameFail.promotionChange, "unchanged-fail");
  });

  it("validates parsed FormalModelEvalReport JSON strings cleanly", () => {
    const validJson = JSON.stringify(SAMPLE_EVAL_REPORT_BEFORE);
    const ok = parseClientEvalReportJson(validJson);
    assert.equal(ok.error, null);
    assert.equal(ok.report?.totalCases, 5);

    const missingCal = parseClientEvalReportJson(
      JSON.stringify({
        promoted: true,
        formalGatePassRate: 1,
        nonTrivialPassRate: 1,
        perCase: [],
      } as unknown as ClientFormalModelEvalReport),
    );
    assert.equal(missingCal.report, null);
    assert.ok(missingCal.error?.includes("calibration.ece"));

    const invalid = parseClientEvalReportJson("{not valid json");
    assert.equal(invalid.report, null);
    assert.ok(invalid.error);
  });
});
