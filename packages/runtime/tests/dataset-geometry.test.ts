// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeGeometricCoverage,
  auditIsomorphicContamination,
  canonicalizeHypergraphSignature,
  extractNumericParameters,
  synthesizeConstrainedVariants,
} from "../src/ml/dataset-geometry.js";
import { compileRelationalHypergraph } from "../src/ml/hypergraph-compiler.js";
import { auditTrainEvalContamination } from "../src/ml/recipe-debugger.js";

describe("Set-Based Dataset Geometry (`dataset-geometry.ts`)", () => {
  describe("auditIsomorphicContamination — Renaming- & Rescaling-Invariant Decontamination", () => {
    it("catches a Modelica eval leak after renaming ALL variables and rescaling parameters", () => {
      const trainSource = `
model ThermalRC
  parameter Real R = 10.0;
  parameter Real C = 0.5;
  Real v;
  Real i;
equation
  v = R * i;
  C * der(v) = -i;
end ThermalRC;
`.trim();

      // Every single identifier renamed (R -> R_load, C -> cap_val, v -> voltage, i -> current, ThermalRC -> LoadFilter)
      // and every numeric parameter rescaled (10.0 -> 470.5, 0.5 -> 0.0025).
      const evalRenamedLeak = `
model LoadFilter
  parameter Real R_load = 470.5;
  parameter Real cap_val = 0.0025;
  Real voltage;
  Real current;
equation
  voltage = R_load * current;
  cap_val * der(voltage) = -current;
end LoadFilter;
`.trim();

      // Structurally different clean training model (2nd-order mechanical oscillator)
      const cleanTrainSource = `
model MassSpringDamper
  parameter Real m = 2.0;
  parameter Real k = 50.0;
  parameter Real d = 1.5;
  Real x;
  Real vel;
equation
  der(x) = vel;
  m * der(vel) = -k * x - d * vel;
end MassSpringDamper;
`.trim();

      // Confirm canonical signatures of the renamed/rescaled pair are identical
      const sigTrain = canonicalizeHypergraphSignature(
        compileRelationalHypergraph({ source: trainSource, uri: "train/rc.mo", dialect: "modelica" }),
      );
      const sigEval = canonicalizeHypergraphSignature(
        compileRelationalHypergraph({ source: evalRenamedLeak, uri: "eval/load.mo", dialect: "modelica" }),
      );
      assert.deepEqual(sigTrain.canonicalGroupSeq, sigEval.canonicalGroupSeq);
      assert.deepEqual(sigTrain.relTypeIds, sigEval.relTypeIds);
      assert.deepEqual(sigTrain.relSigns, sigEval.relSigns);
      assert.notEqual(sigTrain.exactTokenHash, sigEval.exactTokenHash);
      assert.equal(sigTrain.structuralHash, sigEval.structuralHash);

      // Confirm raw text 4-gram decontamination MISSES this renamed+rescaled leak
      const rawTextAudit = auditTrainEvalContamination(
        [{ exampleId: "tr_rc", uri: "train/rc.mo", dialect: "modelica", source: trainSource }],
        [{ exampleId: "ev_load", uri: "eval/load.mo", dialect: "modelica", source: evalRenamedLeak }],
        0.72,
      );
      assert.equal(rawTextAudit.contaminatedCount, 0);

      // Hypergraph-isomorphic decontamination MUST catch tr_rc and spare tr_msd
      const report = auditIsomorphicContamination(
        [
          { exampleId: "tr_rc", uri: "train/rc.mo", dialect: "modelica", source: trainSource },
          { exampleId: "tr_msd", uri: "train/msd.mo", dialect: "modelica", source: cleanTrainSource },
        ],
        [{ exampleId: "ev_load", uri: "eval/load.mo", dialect: "modelica", source: evalRenamedLeak }],
        0.85,
      );

      assert.equal(report.trainCount, 2);
      assert.equal(report.evalCount, 1);
      assert.equal(report.isomorphicLeakCount, 1);
      assert.equal(report.matches.length, 1);
      assert.equal(report.matches[0]!.trainExampleId, "tr_rc");
      assert.equal(report.matches[0]!.evalExampleId, "ev_load");
      assert.equal(report.matches[0]!.matchKind, "hypergraph-isomorphic");
      assert.equal(report.matches[0]!.similarity, 1.0);
      assert.deepEqual(report.recommendedQuarantineIds, ["tr_rc"]);
    });

    it("catches OpenSCAD renamed-variable leaks and classifies verbatim matches as exact-hash", () => {
      const scadTrain = `
wall_thickness = 2.0;
outer_radius = 15.0;
inner_radius = outer_radius - wall_thickness;
difference() {
  cylinder(r = outer_radius, h = 20.0);
  cylinder(r = inner_radius, h = 22.0);
}
`.trim();

      const scadRenamedEval = `
shell_thickness = 4.5;
casing_radius = 32.0;
bore_radius = casing_radius - shell_thickness;
difference() {
  cylinder(r = casing_radius, h = 40.0);
  cylinder(r = bore_radius, h = 44.0);
}
`.trim();

      const report = auditIsomorphicContamination(
        [
          { exampleId: "tr_scad_renamed", uri: "train/housing.scad", dialect: "scad", source: scadTrain },
          { exampleId: "tr_scad_exact", uri: "train/exact.scad", dialect: "scad", source: scadRenamedEval },
        ],
        [{ exampleId: "ev_scad", uri: "eval/casing.scad", dialect: "scad", source: scadRenamedEval }],
        0.85,
      );

      assert.equal(report.isomorphicLeakCount, 2);
      const renamedMatch = report.matches.find((m) => m.trainExampleId === "tr_scad_renamed");
      const exactMatch = report.matches.find((m) => m.trainExampleId === "tr_scad_exact");
      assert.ok(renamedMatch);
      assert.equal(renamedMatch.matchKind, "hypergraph-isomorphic");
      assert.equal(renamedMatch.similarity, 1.0);
      assert.ok(exactMatch);
      assert.equal(exactMatch.matchKind, "exact-hash");
      assert.equal(exactMatch.similarity, 1.0);
      assert.equal(report.recommendedQuarantineIds.length, 2);
    });
  });

  describe("analyzeGeometricCoverage — m_init Band & Parameter Manifold Hole Analysis", () => {
    it("detects empty/sparse m_init manifold holes and narrow parameter ranges", () => {
      const lowMModelA = `
model SimpleA
  parameter Real R = 10.0;
  Real v;
  Real i;
equation
  v = R * i;
end SimpleA;
`.trim();

      const lowMModelB = `
model SimpleB
  parameter Real R = 10.0;
  parameter Real C = 1.0;
  Real v;
  Real i;
equation
  v = R * i;
  C * der(v) = -i;
end SimpleB;
`.trim();

      const mediumMModel = `
model MediumNetwork
  parameter Real R1 = 10.0;
  parameter Real R2 = 25.0;
  parameter Real C1 = 0.2;
  parameter Real C2 = 0.8;
  parameter Real L1 = 0.05;
  Real v1;
  Real v2;
  Real i1;
  Real i2;
equation
  v1 = R1 * i1;
  v2 = R2 * i2;
  C1 * der(v1) = i1 - i2;
  C2 * der(v2) = i2;
  L1 * der(i1) = v1 - v2;
end MediumNetwork;
`.trim();

      const report = analyzeGeometricCoverage([
        { exampleId: "ex_a", uri: "a.mo", dialect: "modelica", source: lowMModelA },
        { exampleId: "ex_b", uri: "b.mo", dialect: "modelica", source: lowMModelB },
        { exampleId: "ex_m", uri: "m.mo", dialect: "modelica", source: mediumMModel },
      ]);

      assert.equal(report.totalExamples, 3);
      assert.equal(report.mInitBands.length, 5);
      assert.deepEqual(
        report.mInitBands.map((b) => b.band),
        ["[0..2]", "[3..6]", "[7..12]", "[13..24]", "[25+]"],
      );

      // Band [3..6] has ex_a (m=4) and ex_b (m=5); band [7..12] has ex_m (m=10)
      const band3to6 = report.mInitBands.find((b) => b.band === "[3..6]")!;
      const band7to12 = report.mInitBands.find((b) => b.band === "[7..12]")!;
      const band13to24 = report.mInitBands.find((b) => b.band === "[13..24]")!;
      const band25Plus = report.mInitBands.find((b) => b.band === "[25+]")!;

      assert.equal(band3to6.count, 2);
      assert.equal(band7to12.count, 1);
      assert.equal(band13to24.count, 0);
      assert.equal(band25Plus.count, 0);

      // Must detect empty m_init manifold holes for [0..2], [13..24], and [25+]
      const emptyBandTargets = report.manifoldHoles.filter((h) => h.kind === "empty-m-band").map((h) => h.target);
      assert.ok(emptyBandTargets.includes("[0..2]"));
      assert.ok(emptyBandTargets.includes("[13..24]"));
      assert.ok(emptyBandTargets.includes("[25+]"));

      // Parameter 'R' is constant (10.0) across ex_a and ex_b -> flagged as narrow parameter range hole
      assert.ok(report.parameterRanges.R);
      assert.equal(report.parameterRanges.R.count, 2);
      assert.equal(report.parameterRanges.R.narrow, true);
      assert.ok(report.manifoldHoles.some((h) => h.kind === "narrow-parameter-range" && h.target === "R"));

      assert.ok(report.coverageScore > 0 && report.coverageScore < 0.75);
    });
  });

  describe("synthesizeConstrainedVariants — ConstrainedZonotope Feasible Parameter Synthesis", () => {
    it("produces distinct, physically positive OpenSCAD variants respecting linear constraints", () => {
      const scadSource = `
wall_thickness = 2.0;
inner_radius = 7.0;
casing_height = 20.0;
difference() {
  cylinder(r = inner_radius + wall_thickness, h = casing_height);
  cylinder(r = inner_radius, h = casing_height + 2.0);
}
`.trim();

      const result = synthesizeConstrainedVariants(scadSource, "scad", {
        count: 6,
        relativePerturbation: 0.6, // wide ±60% box that WOULD violate bounds without constraints
        enforcePositivity: true,
        minPositiveValue: 0.5,
        linearConstraints: [
          // Outer radius constraint: wall_thickness + inner_radius <= 9.5
          { coefficients: { wall_thickness: 1, inner_radius: 1 }, rhs: 9.5, sense: "<=" },
          // Minimum printable wall thickness: wall_thickness >= 1.2
          { coefficients: { wall_thickness: 1 }, rhs: 1.2, sense: ">=" },
        ],
        seed: 2026,
      });

      assert.equal(result.feasible, true);
      assert.deepEqual(result.parameterNames, ["wall_thickness", "inner_radius", "casing_height"]);
      assert.equal(result.variants.length, 6);
      // ConstrainedZonotope should carry positivity + linear inequality constraints in C * xi <= d
      assert.ok(result.constrainedZonotope.C.length >= 5);

      const seenSources = new Set<string>();
      for (const v of result.variants) {
        seenSources.add(v.source);
        const wt = v.parameters.wall_thickness!;
        const ir = v.parameters.inner_radius!;
        const ch = v.parameters.casing_height!;

        // Physical positivity & user linear constraints strictly respected
        assert.ok(wt >= 1.2 - 1e-5, `Expected wall_thickness >= 1.2, got ${wt}`);
        assert.ok(ir >= 0.5 - 1e-5, `Expected inner_radius >= 0.5, got ${ir}`);
        assert.ok(ch >= 0.5 - 1e-5, `Expected casing_height >= 0.5, got ${ch}`);
        assert.ok(wt + ir <= 9.5 + 1e-5, `Expected wall_thickness + inner_radius <= 9.5, got ${wt + ir}`);

        // Generator factors xi strictly in [-1, 1] and satisfy C * xi <= d
        assert.equal(v.xi.length, 3);
        for (const xj of v.xi) {
          assert.ok(xj >= -1 - 1e-6 && xj <= 1 + 1e-6, `xi out of [-1, 1]: ${xj}`);
        }
        for (let r = 0; r < result.constrainedZonotope.C.length; r++) {
          const row = result.constrainedZonotope.C[r]!;
          const lhs = row.reduce((acc, cVal, j) => acc + cVal * v.xi[j]!, 0);
          assert.ok(
            lhs <= result.constrainedZonotope.d[r]! + 1e-4,
            `C*xi <= d violated at row ${r}: ${lhs} > ${result.constrainedZonotope.d[r]}`,
          );
        }

        // Source substitution matches parameters and compiles into a valid 4-column hypergraph
        assert.ok(v.hypergraph.tokenIds.length > 10);
        assert.ok(v.hypergraph.mInit >= 3);
        const reExtracted = extractNumericParameters(v.source, v.hypergraph.spans);
        const byName = Object.fromEntries(reExtracted.map((p) => [p.name, p.value]));
        assert.ok(Math.abs(byName.wall_thickness! - wt) < 1e-6);
        assert.ok(Math.abs(byName.inner_radius! - ir) < 1e-6);
        assert.ok(Math.abs(byName.casing_height! - ch) < 1e-6);
      }

      // All 6 sampled variants must be distinct
      assert.equal(seenSources.size, 6);
    });

    it("supports direct generator-space C * xi <= d constraints and detects infeasible constraints", () => {
      const modelicaSource = `
model ThermalRC
  parameter Real R(unit="Ohm") = 100.0;
  parameter Real C(unit="F") = 0.01;
  Real v;
  Real i;
equation
  v = R * i;
  C * der(v) = -i;
end ThermalRC;
`.trim();

      // Direct generator constraint: xi_0 + xi_1 <= 0.25 (anti-correlated R and C upper envelope)
      const res = synthesizeConstrainedVariants(modelicaSource, "modelica", {
        count: 4,
        relativePerturbation: 0.4,
        constraintsC: [[1, 1]],
        constraintsD: [0.25],
        seed: 77,
      });

      assert.equal(res.feasible, true);
      assert.equal(res.variants.length, 4);
      for (const v of res.variants) {
        assert.ok(v.parameters.R! > 0);
        assert.ok(v.parameters.C! > 0);
        assert.ok(v.xi[0]! + v.xi[1]! <= 0.25 + 1e-4);
        assert.ok(v.source.includes('parameter Real R(unit="Ohm") ='));
      }

      // Contradictory constraints: R >= 500 AND R <= 200 -> infeasible
      const infeasible = synthesizeConstrainedVariants(modelicaSource, "modelica", {
        count: 4,
        relativePerturbation: 0.2,
        linearConstraints: [
          { coefficients: { R: 1 }, rhs: 500, sense: ">=" },
          { coefficients: { R: 1 }, rhs: 200, sense: "<=" },
        ],
      });
      assert.equal(infeasible.feasible, false);
      assert.equal(infeasible.variants.length, 0);
    });
  });
});
